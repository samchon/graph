import path from "node:path";
import {
  ISamchonGraphEdge,
  ISamchonGraphEvidence,
  ISamchonGraphNode,
} from "../structures";
import { GraphLanguage, GraphNodeKind } from "../typings";
import { IGraphSitterOptions } from "./IGraphSitterOptions";
import { CppDeclarations } from "./CppDeclarations";
import { CsharpDeclarations } from "./CsharpDeclarations";
import { decoratorsAbove } from "./decoratorsAbove";
import { IStaticGraphParts } from "./IStaticGraphParts";
import { KotlinDeclarations } from "./KotlinDeclarations";
import { LuaDeclarations } from "./LuaDeclarations";
import { PhpDeclarations } from "./PhpDeclarations";
import { resolveType } from "./resolveType";
import { RubyDeclarations } from "./RubyDeclarations";
import { rustImplOwner } from "./rustImplOwner";
import { ScalaDeclarations } from "./ScalaDeclarations";
import { staticDependencyEdges } from "./staticDependencyEdges";
import { supertypesOf } from "./supertypesOf";
import { SwiftDeclarations } from "./SwiftDeclarations";
import { ZigDeclarations } from "./ZigDeclarations";

interface IDeclaration {
  node: ISamchonGraphNode;
  /**
   * The declaration's own head, joined across every line it spans. A later pass
   * that re-reads the head — supertypes, above all — must not assume it fits on
   * the start line, because the languages that most often split it (`interface
   * ChildResolver :` and its supertype a line below) are exactly the ones whose
   * inheritance the graph is asked about.
   */
  header: string;
  startIndex: number;
  endIndex: number;
  ownerId?: string;
  /** Transparent receiver whose declaration may occur later in the file. */
  ownerName?: string;
}

interface ISwiftExtension {
  file: string;
  receiverName: string;
  header: string;
  evidence: ISamchonGraphEvidence;
}

interface IParsedDeclaration {
  kind: GraphNodeKind;
  name: string;
  exported?: boolean;
  modifiers?: ISamchonGraphNode["modifiers"];
  ownerNames?: string[];
  /** Receiver of a declaration that extends a type instead of declaring one. */
  extensionOwner?: string;
}

/** A declaration a whole-file scan bounded itself, span included. */
interface IScannedDeclaration extends IParsedDeclaration {
  endIndex: number;
}

const EXTERNAL_MODULE_LIMIT = 1_500;

/**
 * The static parse of a project, with spans intact and the §4k derivation not
 * yet run: what a hybrid build merges into its language-server slice before
 * finalizing the two together, so the export surface is followed once across the
 * whole project rather than once per lane.
 */
export function graphSitterParts(
  options: IGraphSitterOptions,
): IStaticGraphParts {
  const root = path.resolve(options.root);
  const files = options.files.map((file) => file.absolutePath);
  const nodes: ISamchonGraphNode[] = [];
  const edges: ISamchonGraphEdge[] = [];
  const sources = new Map<string, string>();
  const declarationsByFile = new Map<string, IDeclaration[]>();
  const swiftExtensions: ISwiftExtension[] = [];
  const byName = new Map<string, ISamchonGraphNode[]>();
  const externalNodes = new Map<string, ISamchonGraphNode>();
  const absolutePathByRelativePath = new Map(
    options.files.map((file) => [file.relativePath, file.absolutePath]),
  );
  const languageByRelativePath = new Map(
    options.files.map((file) => [file.relativePath, file.language]),
  );
  const warnings: string[] = [];

  for (const input of options.files) {
    const file = input.absolutePath;
    const text = input.source;
    sources.set(file, text);
    const lines = text.split(/\r?\n/);
    const rel = input.relativePath;
    const language = input.language;
    const declarations = declarationsOf(
      rel,
      language,
      lines,
      swiftExtensions,
    );
    declarationsByFile.set(rel, declarations);
    for (const declaration of declarations) {
      nodes.push(declaration.node);
      push(byName, declaration.node.name, declaration.node);
      if (declaration.ownerId !== undefined) {
        edges.push({
          from: declaration.ownerId,
          to: declaration.node.id,
          kind: "contains",
          evidence: declaration.node.evidence,
        });
      }
    }
    for (const imported of importsOf(rel, language, lines)) {
      if (externalNodes.size >= EXTERNAL_MODULE_LIMIT) continue;
      const external = externalNode(language, imported, externalNodes);
      nodes.push(external);
      edges.push({
        from: rel,
        to: external.id,
        kind: "imports",
        evidence: imported.evidence,
      });
    }
  }

  connectProjectWideCppOwners(declarationsByFile, edges);
  connectProjectWideSwiftOwners(
    declarationsByFile,
    swiftExtensions,
    byName,
    edges,
  );

  for (const [rel, declarations] of declarationsByFile) {
    const abs = absolutePathByRelativePath.get(rel)!;
    const lines = sources.get(abs)!.split(/\r?\n/);
    // Index children by owner once per file instead of re-filtering every
    // declaration against every other (which is quadratic in a large file).
    const childrenByOwner = new Map<string, typeof declarations>();
    for (const child of declarations) {
      if (child.ownerId === undefined) continue;
      push(childrenByOwner, child.ownerId, child);
    }
    for (const declaration of declarations) {
      // Scan only the lines that belong to this declaration itself: lines inside
      // nested declarations are attributed to those declarations, and their
      // signature lines are definitions, not calls. Without this exclusion a
      // class "calls" every method it merely defines, and every call inside a
      // method body is double-attributed to the class.
      const nested = childrenByOwner.get(declaration.node.id) ?? [];
      const body = lines
        .slice(declaration.startIndex, Math.max(declaration.startIndex + 1, declaration.endIndex + 1))
        .map((text, offset) => {
          const index = declaration.startIndex + offset;
          // Preserve one line per source line even when a nested declaration is
          // excluded. Static edge evidence is an expression coordinate, and
          // removing these lines shifts every later call to the wrong site.
          return nested.some(
            (child) => index >= child.startIndex && index <= child.endIndex,
          )
            ? ""
            : text;
        })
        .join("\n");
      for (const edge of dependencyEdges(declaration.node, body, byName)) {
        edges.push(edge);
      }
      for (const edge of inheritanceEdges(
        declaration.node,
        declaration.header,
        byName,
      )) {
        edges.push(edge);
      }
      for (const name of decoratorNamesAbove(
        declaration.node.language,
        lines,
        declaration.startIndex,
      )) {
        const target = resolveType(name, declaration.node, byName);
        if (target === undefined) continue;
        edges.push({
          from: declaration.node.id,
          to: target.id,
          kind: "decorates",
          evidence: declaration.node.evidence,
        });
      }
    }
    // §2j: a call written at the top level of a module belongs to the module.
    // Without it, everything a module wires up at load — a router mounting its
    // handlers, a registry registering its providers — is attributed to nobody,
    // and an event-driven codebase reads back as a set of disconnected islands.
    for (const edge of moduleScopeEdges(
      rel,
      languageByRelativePath.get(rel)!,
      lines,
      declarations,
      byName,
    )) {
      edges.push(edge);
    }
  }

  if (files.length === 0) {
    warnings.push("No supported source files were found.");
  }

  return {
    root,
    files,
    sources,
    languages: [...new Set(options.files.map((file) => file.language))],
    nodes,
    edges,
    warnings,
  };
}

// The identifiers a module names in its own top-level statements, attributed to
// the module (file) node — the container every top-level declaration already
// hangs off. Import and re-export lines are excluded: naming a symbol in order
// to import it is not the module running it.
function moduleScopeEdges(
  file: string,
  language: GraphLanguage,
  lines: readonly string[],
  declarations: readonly IDeclaration[],
  byName: Map<string, ISamchonGraphNode[]>,
): ISamchonGraphEdge[] {
  const covered = new Set<number>();
  for (const declaration of declarations) {
    if (declaration.ownerId !== undefined) continue;
    for (let i = declaration.startIndex; i <= declaration.endIndex; i++) {
      covered.add(i);
    }
  }
  const body = lines
    .map((text, index) =>
      covered.has(index) || MODULE_IMPORT_LINE.test(text.trim()) ? "" : text,
    )
    .join("\n");
  const source: ISamchonGraphNode = {
    id: file,
    kind: "file",
    language,
    name: file,
    file,
    external: false,
    evidence: { file, startLine: 1, endLine: 1 },
  };
  return dependencyEdges(source, body, byName);
}

// Every one of these keywords is followed by whitespace, never by `(`. That
// distinction is the whole point: `use(handler)` is a module wiring itself up —
// the case §2j exists for — and `use crate::order` is Rust bringing a name in.
const MODULE_IMPORT_LINE =
  /^(?:import\b|export\s+(?:\*|\{)|from\s|use\s|using\s|#include\b|package\s|require\s)/;

function declarationsOf(
  file: string,
  language: GraphLanguage,
  lines: readonly string[],
  swiftExtensions: ISwiftExtension[],
): IDeclaration[] {
  const declarations: IDeclaration[] = [];
  // Owners that a whole-file scan names rather than nests, indexed by the
  // qualified spelling a child writes, so resolving one is not a scan of every
  // declaration emitted so far.
  const byQualifiedName = new Map<string, IDeclaration[]>();
  const ownerStack: Array<{
    name: string;
    endIndex: number;
    id?: string;
    kind: GraphNodeKind;
  }> = [];
  const rustTypes = new Map<
    string,
    { name: string; id: string; kind: GraphNodeKind }
  >();
  const swiftTypes = new Map<
    string,
    { name: string; id: string; kind: GraphNodeKind }
  >();
  const scan = declarationScan(language, lines);
  // Kotlin is the one language whose declaration rules cannot read the raw
  // lines: its block comments nest and its raw strings run over line ends, so
  // the lexical state that says whether `fun ghost()` is code arrives from
  // earlier lines. The per-line masking every other language does inside its
  // own parser cannot see that state. `kotlinLexicalLines` preserves every line
  // and column, so spans, owners, and evidence columns stay exact.
  const lexicalLines =
    language === "kotlin" ? KotlinDeclarations.kotlinLexicalLines(lines) : lines;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    while (ownerStack.length > 0 && i > ownerStack[ownerStack.length - 1]!.endIndex) {
      ownerStack.pop();
    }
    if (language === "rust") {
      const implName = rustImplOwner(
        line.trim().replace(/\s*\{\s*$/, ""),
        new Set(rustTypes.keys()),
      );
      const owner = implName === undefined ? undefined : rustTypes.get(implName);
      if (implName !== undefined) {
        const endIndex = declarationEndIndex(lines, i);
        if (endIndex > i) {
          ownerStack.push({
            name: owner?.name ?? implName,
            endIndex,
            ...(owner === undefined ? {} : { id: owner.id }),
            kind: owner?.kind ?? "class",
          });
          continue;
        }
      }
    }
    // Methods are only declared directly inside a type container. Detecting them
    // inside a function/method body turns bare call statements (`doThing(x)`
    // with no trailing `;`, as in Go and ASI JS/TS) into phantom method nodes.
    const directOwner = ownerStack[ownerStack.length - 1];
    const scanned = scan?.get(i);
    const header = declarationHeader(language, lexicalLines, i);
    const parsed: IParsedDeclaration | undefined =
      scan === undefined
        ? parseDeclaration(
            language,
            header,
            isTypeContainer(directOwner?.kind),
            directOwner?.name,
            directOwner?.kind,
          )
        : scanned;
    if (parsed !== undefined) {
      // A Swift `extension` declares no type: it adds members to one that may
      // be written later in the file, in another file, or in another module
      // entirely. Emitting a node for it would publish a second `Array` beside
      // the real one, so it becomes a transparent owner exactly as a Rust
      // `impl` block does, resolved below once the file has been scanned.
      if (parsed.extensionOwner !== undefined) {
        const endIndex = declarationEndIndexOf(language, lexicalLines, i);
        swiftExtensions.push({
          file,
          receiverName: parsed.extensionOwner,
          header: header.trim(),
          evidence: {
            file,
            startLine: i + 1,
            startCol: Math.max(1, line.indexOf(parsed.extensionOwner) + 1),
            endLine: i + 1,
          },
        });
        if (endIndex > i) {
          const owner = swiftTypes.get(parsed.extensionOwner);
          ownerStack.push({
            name: owner?.name ?? parsed.extensionOwner,
            endIndex,
            ...(owner === undefined ? {} : { id: owner.id }),
            kind: owner?.kind ?? "class",
          });
        }
        continue;
      }
      if (language === "php" && parsed.kind === "namespace") {
        while (ownerStack.at(-1)?.kind === "namespace") ownerStack.pop();
      }
      const endIndex =
        scanned?.endIndex ??
        ((language === "csharp" || language === "php") &&
          parsed.kind === "namespace" &&
          /;\s*$/.test(line)
          ? lines.length - 1
          : declarationEndIndexOf(language, lexicalLines, i));
      // Owners the declaration itself names win over the enclosing braces. A
      // scan reports them precisely when the lexical stack cannot see them —
      // Lua writes its owner in the head (`function M.draw()`) and a table
      // literal is no scope, Scala's `extension` region is transparent and its
      // scopes are indentation, and Zig attributes an anonymous `return struct`
      // to the factory that returned it. Ruby reports none because Ruby's
      // owners are exactly its nesting, which the stack already has.
      const ownerNames =
        language === "cpp"
          ? cppQualifiedOwners(
              ownerStack.map((entry) => entry.name),
              parsed.ownerNames ?? [],
            )
          : parsed.ownerNames ?? ownerStack.map((entry) => entry.name);
      const requestedOwner = ownerNames.join(".");
      const qualifiedOwnerName =
        language === "cpp" && parsed.ownerNames?.length
          ? requestedOwner
          : undefined;
      const qualifiedOwner =
        qualifiedOwnerName === undefined
          ? undefined
          : cppQualifiedOwner(declarations, qualifiedOwnerName);
      const owner =
        qualifiedOwner === undefined
          ? requestedOwner
          : qualifiedOwner.node.qualifiedName ?? qualifiedOwner.node.name;
      const qualifiedName = owner === ""
        ? parsed.name
        : `${owner}.${parsed.name}`;
      const ownerId =
        qualifiedOwnerName !== undefined
          ? qualifiedOwner?.node.id
          : parsed.ownerNames === undefined
            ? ownerStack[ownerStack.length - 1]?.id
            : enclosingOwnerId(byQualifiedName, requestedOwner, i);
      const node: ISamchonGraphNode = {
        id: `${file}#${qualifiedName}:${parsed.kind}`,
        kind: parsed.kind,
        language,
        name: parsed.name,
        ...(qualifiedName !== parsed.name ? { qualifiedName } : {}),
        file,
        external: false,
        exported:
          language === "csharp" && ownerStack.some((entry) =>
            isTypeContainer(entry.kind),
          )
            ? undefined
            : language === "php" && ownerStack.some((entry) =>
                entry.kind === "class" ||
                entry.kind === "interface" ||
                entry.kind === "enum",
              )
              ? undefined
            : language === "cpp" &&
                  owner.split(".").includes("(anonymous namespace)")
                ? false
                : parsed.exported,
        ...(parsed.modifiers !== undefined && parsed.modifiers.length > 0
          ? { modifiers: parsed.modifiers }
          : {}),
        evidence: {
          file,
          startLine: i + 1,
          startCol: Math.max(1, line.indexOf(parsed.name) + 1),
          endLine: i + 1,
        },
      };
      const declaration: IDeclaration = {
        node,
        header: header.trim(),
        startIndex: i,
        endIndex,
        ownerId,
        ...(ownerId === undefined && qualifiedOwnerName !== undefined
          ? { ownerName: qualifiedOwnerName }
          : ownerStack[ownerStack.length - 1]?.id === undefined &&
              ownerStack[ownerStack.length - 1] !== undefined
            ? { ownerName: ownerStack[ownerStack.length - 1]!.name }
          : {}),
      };
      declarations.push(declaration);
      push(byQualifiedName, qualifiedName, declaration);
      if (
        language === "rust" &&
        (parsed.kind === "class" ||
          parsed.kind === "interface" ||
          parsed.kind === "type" ||
          parsed.kind === "enum")
      ) {
        rustTypes.set(parsed.name, {
          name: parsed.name,
          id: node.id,
          kind: parsed.kind,
        });
      }
      if (language === "swift" && isSwiftExtendable(parsed.kind)) {
        swiftTypes.set(qualifiedName, {
          name: qualifiedName,
          id: node.id,
          kind: parsed.kind,
        });
      }
      if (
        (isContainer(parsed.kind) ||
          (language === "csharp" && parsed.kind === "property") ||
          // An enum body that declares members rather than only constants. The
          // PHP, Kotlin, and Swift parsers each report an enum's methods and
          // properties, so the enum has to own what is written inside it;
          // without that, `fun cached()` inside `enum class Lifetime` is filed
          // as a top-level function of the file.
          (parsed.kind === "enum" && hasEnumMembers(language))) &&
        endIndex > i
      ) {
        ownerStack.push({
          name:
            language === "cpp" && parsed.ownerNames?.length
              ? [...parsed.ownerNames, parsed.name].join(".")
              : parsed.name,
          endIndex,
          id: node.id,
          kind: parsed.kind,
        });
      }
    }
  }
  if (language === "rust") {
    reconnectRustImplOwners(file, declarations);
  } else if (language === "cpp") {
    reconnectQualifiedOwners(declarations, isTypeContainer);
  } else if (language === "swift") {
    reconnectQualifiedOwners(declarations, isSwiftExtendable);
  }
  return declarations;
}

/**
 * The languages whose declarations come from one lexical pass over the whole
 * file instead of the shared line-by-line rules: `end`-delimited bodies (Ruby,
 * Lua), significant indentation and transparent `extension` regions (Scala),
 * and value-declared containers (Zig) are none of them recoverable from a brace
 * count. A scan owns its file's declaration list end to end, and the shared
 * regex must not run beside it: the scan masks comments and long strings out
 * precisely so `object GhostFromComment:` cannot become a node, and a second
 * pass over the raw lines would hand it back.
 */
function declarationScan(
  language: GraphLanguage,
  lines: readonly string[],
): ReadonlyMap<number, IScannedDeclaration> | undefined {
  if (language === "lua") return LuaDeclarations.scan(lines);
  if (language === "ruby") return RubyDeclarations.scan(lines);
  if (language === "scala") return ScalaDeclarations.scan(lines);
  if (language === "zig") return ZigDeclarations.scan(lines);
  return undefined;
}

/**
 * Join the declaration head that begins on `start`. A language whose head never
 * spans lines answers with the line itself; the rest hand back the bounded head
 * their own parser was written against, because reading only the first line
 * loses exactly the declarations a static fallback exists to recover.
 */
function declarationHeader(
  language: GraphLanguage,
  lines: readonly string[],
  start: number,
): string {
  if (language === "cpp") return CppDeclarations.cppDeclarationHeader(lines, start);
  if (language === "csharp")
    return CsharpDeclarations.csharpDeclarationHeader(lines, start);
  if (language === "java") return javaDeclarationHeader(lines, start);
  if (language === "kotlin")
    return KotlinDeclarations.kotlinDeclarationHeader(lines, start);
  if (language === "php") return PhpDeclarations.phpDeclarationHeader(lines, start);
  if (language === "scala")
    return ScalaDeclarations.scalaDeclarationHeader(lines, start);
  if (language === "swift")
    return SwiftDeclarations.swiftDeclarationHeader(lines, start);
  return lines[start]!;
}

/**
 * Bound the declaration that begins on `start`. The shared brace walk assumes
 * that a declaration without a body of its own owns the next `{}` it finds,
 * which is true for C-shaped members and false for a bodyless Kotlin or Swift
 * requirement: `fun clear()` would take the following `class Scope`'s braces,
 * become a container, and misqualify every declaration after it.
 */
function declarationEndIndexOf(
  language: GraphLanguage,
  lines: readonly string[],
  start: number,
): number {
  if (language === "kotlin")
    return KotlinDeclarations.kotlinDeclarationEndIndex(lines, start);
  if (language === "swift")
    return SwiftDeclarations.swiftDeclarationEndIndex(lines, start);
  return declarationEndIndex(lines, start);
}

/**
 * The decorators written above a declaration. Swift needs its own recovery
 * because a Swift attribute may span lines: the shared scan walks upward line
 * by line and stops at the `)` closing a multiline `@available(...)`, which is
 * every stacked attribute the graph is asked to attach.
 */
function decoratorNamesAbove(
  language: GraphLanguage,
  lines: readonly string[],
  index: number,
): string[] {
  return language === "swift"
    ? SwiftDeclarations.swiftDecoratorsAbove(lines, index)
    : decoratorsAbove(lines, index);
}

/**
 * The languages whose enum body is a member surface rather than a constant
 * list. Each of their declaration parsers reports an enum's methods and
 * properties, which only makes sense if the enum owns them; the shared regex
 * lane has no enum-member rule for the other languages, so an enum there would
 * own nothing and only qualify its constants under a scope they do not have.
 */
function hasEnumMembers(language: GraphLanguage): boolean {
  return language === "kotlin" || language === "php" || language === "swift";
}

/**
 * The Swift declarations an `extension` can extend. Broader than the shared
 * type-container test on purpose: Swift extends an `enum` and a `typealias`
 * with the same syntax it extends a `class` with, and an extension that fails
 * to find its type manufactures a duplicate of it.
 */
function isSwiftExtendable(kind: GraphNodeKind): boolean {
  return (
    kind === "class" ||
    kind === "interface" ||
    kind === "enum" ||
    kind === "type"
  );
}

/**
 * The node a scanned owner name refers to at `index`. One qualified name can be
 * written twice in a file — Scala's `opaque type UserId` and the `object UserId`
 * beside it — so the owner is the one whose own range still encloses the child,
 * not merely the last one declared.
 */
function enclosingOwnerId(
  byQualifiedName: ReadonlyMap<string, IDeclaration[]>,
  owner: string,
  index: number,
): string | undefined {
  const candidates = byQualifiedName.get(owner);
  if (candidates === undefined) return undefined;
  for (let i = candidates.length - 1; i >= 0; i--) {
    if (candidates[i]!.endIndex >= index) return candidates[i]!.node.id;
  }
  return undefined;
}

/** Connect a C++ source definition to a type declared in another file. */
function connectProjectWideCppOwners(
  declarationsByFile: ReadonlyMap<string, IDeclaration[]>,
  edges: ISamchonGraphEdge[],
): void {
  const declarations = [...declarationsByFile.values()]
    .flat()
    .filter((declaration) => declaration.node.language === "cpp");
  const types = declarations.filter((declaration) =>
    isTypeContainer(declaration.node.kind),
  );
  const qualified = (declaration: IDeclaration) =>
    declaration.node.qualifiedName ?? declaration.node.name;
  const exact = new Map<string, IDeclaration[]>();
  const aliases = new Map<string, IDeclaration[]>();
  for (const declaration of types) {
    push(exact, qualified(declaration), declaration);
    const alias = qualified(declaration)
      .split(".")
      .filter((name) => name !== "(anonymous namespace)")
      .join(".");
    if (alias !== qualified(declaration)) push(aliases, alias, declaration);
  }
  const choose = (candidates: readonly IDeclaration[]) =>
    [...candidates].sort(
      (a, b) =>
        Number(b.endIndex > b.startIndex) - Number(a.endIndex > a.startIndex) ||
        Number(b.node.exported === true) - Number(a.node.exported === true) ||
        a.node.id.localeCompare(b.node.id),
    )[0];
  for (const declaration of declarations) {
    if (declaration.ownerId !== undefined || declaration.ownerName === undefined)
      continue;
    const owner = choose(
      exact.get(declaration.ownerName) ?? aliases.get(declaration.ownerName) ?? [],
    );
    if (owner === undefined) continue;
    declaration.ownerId = owner.node.id;
    edges.push({
      from: owner.node.id,
      to: declaration.node.id,
      kind: "contains",
      evidence: declaration.node.evidence,
    });
  }
}

/**
 * Connect Swift extension members and conformance headers to one resolved
 * receiver. A same-file declaration is authoritative when unique there;
 * otherwise the qualified receiver must be unique across the project.
 */
function connectProjectWideSwiftOwners(
  declarationsByFile: ReadonlyMap<string, IDeclaration[]>,
  extensions: readonly ISwiftExtension[],
  byName: Map<string, ISamchonGraphNode[]>,
  edges: ISamchonGraphEdge[],
): void {
  const declarations = [...declarationsByFile.values()]
    .flat()
    .filter((declaration) => declaration.node.language === "swift");
  const types = new Map<string, IDeclaration[]>();
  for (const declaration of declarations) {
    if (!isSwiftExtendable(declaration.node.kind)) continue;
    push(
      types,
      declaration.node.qualifiedName ?? declaration.node.name,
      declaration,
    );
  }
  for (const declaration of declarations) {
    if (declaration.ownerId !== undefined || declaration.ownerName === undefined)
      continue;
    const candidates = types.get(declaration.ownerName);
    if (candidates?.length !== 1) continue;
    const owner = candidates[0]!;
    declaration.ownerId = owner.node.id;
    edges.push({
      from: owner.node.id,
      to: declaration.node.id,
      kind: "contains",
      evidence: declaration.node.evidence,
    });
  }
  for (const extension of extensions) {
    const candidates = types.get(extension.receiverName) ?? [];
    const local = candidates.filter(
      (candidate) => candidate.node.file === extension.file,
    );
    const owner =
      local.length === 1
        ? local[0]
        : local.length === 0 && candidates.length === 1
          ? candidates[0]
          : undefined;
    if (owner === undefined) continue;
    edges.push(
      ...inheritanceEdges(
        owner.node,
        extension.header,
        byName,
        extension.evidence,
      ),
    );
  }
}

function cppQualifiedOwners(
  lexical: readonly string[],
  explicit: readonly string[],
): string[] {
  let overlap = Math.min(lexical.length, explicit.length);
  while (
    overlap > 0 &&
    !lexical.slice(-overlap).every((name, index) => name === explicit[index])
  ) {
    overlap--;
  }
  return [...lexical, ...explicit.slice(overlap)];
}

function cppQualifiedOwner(
  declarations: readonly IDeclaration[],
  requested: string,
): IDeclaration | undefined {
  const types = declarations.filter((declaration) =>
    isTypeContainer(declaration.node.kind),
  );
  const qualified = (declaration: IDeclaration) =>
    declaration.node.qualifiedName ?? declaration.node.name;
  return (
    types.find((declaration) => qualified(declaration) === requested) ??
    types.find(
      (declaration) =>
        qualified(declaration)
          .split(".")
          .filter((name) => name !== "(anonymous namespace)")
          .join(".") === requested,
    )
  );
}

/**
 * Attach every declaration whose owner was written by name to the node that
 * owner turned out to be. A C++ out-of-line definition and a Swift `extension`
 * both name a type the file may declare after them, so the link is made once
 * the whole file has been scanned; one that names a type this file never
 * declares stays a transparent owner rather than inventing a node for it.
 */
function reconnectQualifiedOwners(
  declarations: IDeclaration[],
  owns: (kind: GraphNodeKind) => boolean,
): void {
  const types = new Map(
    declarations
      .filter((declaration) => owns(declaration.node.kind))
      .map(
        (declaration) => [
          declaration.node.qualifiedName ?? declaration.node.name,
          declaration.node.id,
        ] as const,
      ),
  );
  for (const declaration of declarations) {
    if (declaration.ownerId !== undefined || declaration.ownerName === undefined)
      continue;
    declaration.ownerId = types.get(declaration.ownerName);
  }
}

/**
 * Rust items are order-independent. A static scan can therefore see
 * `impl Late` before `struct Late`, while an impl for an external or unit type
 * has no declaration node at all. Reconnect the former after the file has been
 * scanned and leave the latter as a qualified, transparent owner.
 */
function reconnectRustImplOwners(
  file: string,
  declarations: IDeclaration[],
): void {
  const types = new Map(
    declarations
      .filter(
        (declaration) =>
          declaration.ownerId === undefined &&
          declaration.ownerName === undefined &&
          (declaration.node.kind === "class" ||
            declaration.node.kind === "interface" ||
            declaration.node.kind === "type" ||
            declaration.node.kind === "enum"),
      )
      .map((declaration) => [declaration.node.name, declaration.node] as const),
  );
  const names = new Set(types.keys());
  const resolvedOwners = new Map<
    string,
    { name: string; node: ISamchonGraphNode }
  >();
  for (const declaration of declarations) {
    if (declaration.ownerId !== undefined || declaration.ownerName === undefined)
      continue;
    // `rustImplOwner` cannot return undefined for an `impl <name>` we build from
    // a receiver that is already a resolved type spelling: its own two
    // undefined paths are unreachable (see rustImplOwner.ts) and the prefix
    // always matches, so the `?? declaration.ownerName` fallback is dead.
    /* c8 ignore next 3 -- rustImplOwner never returns undefined for this input */
    const ownerName =
      rustImplOwner(`impl ${declaration.ownerName}`, names) ??
      declaration.ownerName;
    const owner = types.get(ownerName);
    if (owner === undefined) continue;
    resolvedOwners.set(declaration.ownerName, { name: ownerName, node: owner });
    declaration.ownerId = owner.id;
  }

  // If the receiver was initially retained as `Arc<Late>` and later resolved
  // to the declared `Late`, normalize the whole declaration subtree, not only
  // the method. A multiline method may contain local declarations whose
  // `ownerId` points at the method's original id; update those links after all
  // ids have been renamed so no dangling `contains` edge can be emitted.
  const renamedIds = new Map<string, string>();
  for (const [original, resolved] of resolvedOwners) {
    if (original === resolved.name) continue;
    const prefix = `${original}.`;
    for (const declaration of declarations) {
      const qualifiedName = declaration.node.qualifiedName;
      if (qualifiedName?.startsWith(prefix) !== true) continue;
      const normalized = `${resolved.name}.${qualifiedName.slice(prefix.length)}`;
      const previousId = declaration.node.id;
      declaration.node.qualifiedName = normalized;
      declaration.node.id = `${file}#${normalized}:${declaration.node.kind}`;
      renamedIds.set(previousId, declaration.node.id);
    }
  }
  for (const declaration of declarations) {
    if (declaration.ownerId === undefined) continue;
    const renamed = renamedIds.get(declaration.ownerId);
    if (renamed !== undefined) {
      declaration.ownerId = renamed;
    }
  }
}

/**
 * Join a bounded Java declaration header before parsing it. Java commonly
 * splits type parameters, return types, parameter lists, and `throws` across
 * lines; reading only the first line loses precisely the public methods a
 * static fallback needs. Annotation-only lines stay separate so the existing
 * decorator pass can attach them to the declaration beginning below.
 */
function javaDeclarationHeader(
  lines: readonly string[],
  start: number,
): string {
  const first = lines[start]!.trim();
  if (
    first === "" ||
    first.startsWith("@") ||
    first.startsWith("//") ||
    first.startsWith("/*") ||
    first.startsWith("*")
  )
    return lines[start]!;
  const out: string[] = [];
  let parentheses = 0;
  for (let index = start; index < Math.min(lines.length, start + 32); index++) {
    const raw = lines[index]!;
    const lexical = stripStringsAndComments(raw);
    out.push(raw.trim());
    for (const char of lexical) {
      if (char === "(") parentheses++;
      else if (char === ")") parentheses = Math.max(0, parentheses - 1);
    }
    if (parentheses === 0 && /[;{]/.test(lexical)) break;
  }
  return out.join(" ");
}

/**
 * Parse a Java member structurally around its parameter list. A method has a
 * return type before its declared name; a constructor has the direct owner's
 * name and no return type. This avoids the old regex's inversion, where every
 * normal method disappeared and constructors were emitted as methods.
 */
function parseJavaMember(
  source: string,
  ownerName: string,
): IParsedDeclaration | undefined {
  const clean = eraseJavaAnnotations(
    source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/.*$/gm, " ")
      .trim(),
  );
  const declarationOpen = clean.indexOf("(");
  const modifiers = javaGraphModifiersOf(
    declarationOpen === -1 ? clean : clean.slice(0, declarationOpen),
  );
  let declaration = clean;
  for (;;) {
    const modifier = /^(?:public|private|protected|abstract|static|final|synchronized|native|strictfp|default)\b\s*/.exec(
      declaration,
    );
    if (modifier === null) break;
    declaration = declaration.slice(modifier[0].length).trimStart();
  }

  const open = declaration.indexOf("(");
  if (open === -1) return undefined;
  const before = declaration.slice(0, open).trim();
  if (before === "" || /[=;{}]/.test(before)) return undefined;
  const nameMatch = /([A-Za-z_$][\w$]*)\s*$/.exec(before);
  if (nameMatch === null) return undefined;
  const name = nameMatch[1]!;
  if (CONTROL_WORDS.has(name)) return undefined;

  let type = before.slice(0, nameMatch.index).trim();
  if (type.startsWith("<")) {
    const end = matchingAngleEnd(type);
    if (end === -1) return undefined;
    type = type.slice(end + 1).trim();
  }
  const constructor = name === ownerName && type === "";
  if (!constructor && !isJavaReturnType(type)) return undefined;

  const close = matchingParenthesisEnd(declaration, open);
  if (close === -1) return undefined;
  const tail = declaration.slice(close + 1).trim();
  if (!isJavaMemberTail(tail)) return undefined;
  return {
    kind: constructor ? "constructor" : "method",
    name,
    ...(modifiers.length > 0 ? { modifiers } : {}),
  };
}

function isJavaReturnType(type: string): boolean {
  if (
    type === "" ||
    !/^[A-Za-z_$][\w$.\s<>,?&[\]]*$/.test(type) ||
    !/[\w$>\]]$/.test(type) ||
    /\.\s*</.test(type)
  )
    return false;
  // The guard above only lets a `type` beginning with an identifier character
  // through, so this match always finds at least that identifier; the `?? []`
  // fallback is unreachable defensive code.
  /* c8 ignore next -- guard above forces a non-null match, so `?? []` is dead */
  const words = type.match(/[A-Za-z_$][\w$]*/g) ?? [];
  return !words.some((word) => JAVA_STATEMENT_WORDS.has(word));
}

function isJavaMemberTail(tail: string): boolean {
  const withoutLegacyArrays = tail.replace(/^(?:\[\s*\]\s*)+/, "");
  if (/^(?:\{|;|$)/.test(withoutLegacyArrays)) return true;
  if (/^default\b[\s\S]*;/.test(withoutLegacyArrays)) return true;
  return /^throws\s+[A-Za-z_$][\w$.\s<>,?&[\]]*(?:\{|;|$)/.test(
    withoutLegacyArrays,
  );
}

function matchingAngleEnd(text: string): number {
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "<") depth++;
    else if (text[index] === ">" && --depth === 0) return index;
  }
  return -1;
}

function matchingParenthesisEnd(text: string, start: number): number {
  let depth = 0;
  for (let index = start; index < text.length; index++) {
    if (text[index] === "(") depth++;
    else if (text[index] === ")" && --depth === 0) return index;
  }
  return -1;
}

function javaGraphModifiersOf(
  source: string,
): NonNullable<ISamchonGraphNode["modifiers"]> {
  const clean = eraseJavaAnnotations(source);
  const out: NonNullable<ISamchonGraphNode["modifiers"]> = [];
  for (const match of clean.matchAll(
    /\b(public|private|protected|static|abstract)\b/g,
  )) {
    const modifier = match[1] as NonNullable<
      ISamchonGraphNode["modifiers"]
    >[number];
    if (!out.includes(modifier)) out.push(modifier);
  }
  return out;
}

function eraseJavaAnnotations(source: string): string {
  let out = "";
  for (let index = 0; index < source.length; ) {
    if (source[index] !== "@") {
      out += source[index++]!;
      continue;
    }
    index++;
    while (index < source.length && /[\w$.]/.test(source[index]!)) index++;
    while (index < source.length && /\s/.test(source[index]!)) index++;
    if (source[index] === "(") {
      let depth = 0;
      let quote: string | undefined;
      for (; index < source.length; index++) {
        const char = source[index]!;
        if (quote !== undefined) {
          if (char === "\\") index++;
          else if (char === quote) quote = undefined;
        } else if (char === '"' || char === "'") quote = char;
        else if (char === "(") depth++;
        else if (char === ")" && --depth === 0) {
          index++;
          break;
        }
      }
    }
    out += " ";
  }
  return out;
}

function parseDeclaration(
  language: GraphLanguage,
  line: string,
  inContainer: boolean,
  ownerName?: string,
  ownerKind?: GraphNodeKind,
): IParsedDeclaration | undefined {
  const text = line.trim();
  if (text === "" || text.startsWith("//") || text.startsWith("*")) return undefined;
  if (language === "csharp") {
    return CsharpDeclarations.parseCSharpDeclaration(text, ownerName, ownerKind);
  }
  if (language === "php") {
    return PhpDeclarations.parsePhpDeclaration(text, ownerName, ownerKind);
  }
  if (language === "cpp") {
    return CppDeclarations.parseCppDeclaration(
      text,
      ownerName,
      ownerKind,
    );
  }
  // Swift is answered before the package rule, not after it: `package` is an
  // access modifier in Swift, so `package actor Loader` reaching the rule below
  // would index a package named `actor`.
  if (language === "swift") {
    return SwiftDeclarations.parseSwiftDeclaration(text, ownerName, ownerKind);
  }
  const packageDeclaration = /^package\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*;?/.exec(
    text,
  );
  if (packageDeclaration !== null) {
    return {
      kind: "package",
      name: packageDeclaration[1]!,
      exported: true,
    };
  }
  // Kotlin is answered after it: a Kotlin package clause is the same JVM
  // package the rule above already recognizes, and KotlinDeclarations parses
  // declarations only, so reaching it first would drop the clause entirely.
  if (language === "kotlin") {
    return KotlinDeclarations.parseKotlinDeclaration(text, ownerName, ownerKind);
  }
  if (inContainer) {
    if (language === "java" && ownerName !== undefined) {
      const javaMember = parseJavaMember(text, ownerName);
      if (javaMember !== undefined) return javaMember;
    }
    if (language === "rust") {
      const rustMethod =
        /^(?:pub(?:\([^)]*\))?\s+)?(?:(?:async|const|unsafe|extern(?:\s+"[^"]*")?)\s+)*fn\s+([A-Za-z_][\w]*)/.exec(
          text,
        );
      if (rustMethod !== null) {
        return { kind: "method", name: rustMethod[1]! };
      }
    }
    if (language !== "java") {
      const method =
        /^(?:(?:public|private|protected|internal|static|abstract|final|open|override|async|pub|pub\(crate\))\s+)*([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*(?::|->|\{|$)/.exec(
          text,
        );
      if (method !== null && !CONTROL_WORDS.has(method[1]!)) {
        return { kind: "method", name: method[1]! };
      }
    }
  }
  if (language === "rust") {
    const rustDeclaration =
      /^(?:pub(?:\([^)]*\))?\s+)?(?:(?:async|const|unsafe|extern(?:\s+"[^"]*")?)\s+)*(fn|struct|enum|trait|type|mod|static(?:\s+mut)?|const|union)\s+([A-Za-z_][\w]*)/.exec(
        text,
      );
    if (rustDeclaration !== null) {
      const token = rustDeclaration[1]!;
      return {
        kind: kindOf(token === "union" ? "struct" : token),
        name: rustDeclaration[2]!,
        exported: /^pub\s/.test(text) || undefined,
      };
    }
  }
  const generic = /^(?:export\s+)?(?:(?:public|private|protected|internal|static|abstract|final|open|override|async|pub|pub\(crate\))\s+)*(class|interface|struct|enum|trait|type|namespace|module|object|protocol|extension|func|fn|function|def|fun|method|const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(
    text,
  );
  const cppFunction = /^(?:[\w:<>,~*&\s]+)\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:const\s*)?\{?\s*$/.exec(
    text,
  );
  const goFunc = /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/.exec(text);
  const goType = /^type\s+([A-Za-z_]\w*)\s+(struct|interface|\w+)/.exec(text);
  const tsVariable = /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::|=|\()/ .exec(
    text,
  );

  if (language === "go" && goFunc !== null) {
    return {
      kind: "function",
      name: goFunc[1]!,
      exported: isCapitalized(goFunc[1]!),
    };
  }
  if (language === "go" && goType !== null) {
    return {
      kind: goType[2] === "interface" ? "interface" : "class",
      name: goType[1]!,
      exported: isCapitalized(goType[1]!),
    };
  }
  if (language === "typescript" && tsVariable !== null) {
    return {
      kind: "variable",
      name: tsVariable[1]!,
      exported: text.startsWith("export "),
    };
  }
  if (generic !== null) {
    const token = generic[1]!;
    const name = generic[2]!;
    const javaModifiers =
      language === "java" ? javaGraphModifiersOf(generic[0]) : undefined;
    return {
      kind: kindOf(token),
      name,
      ...(javaModifiers !== undefined && javaModifiers.length > 0
        ? { modifiers: javaModifiers }
        : {}),
      exported:
        language === "java"
          ? ownerName === undefined && javaModifiers?.includes("public")
            ? true
            : undefined
          : language === "rust"
          ? /^pub\s/.test(text) || undefined
          : /\b(export|public|pub)\b/.test(text) ||
            (language === "go" && isCapitalized(name)) ||
            (hasNoExportKeyword(language) && !name.startsWith("_")),
    };
  }
  if (language === "c" && cppFunction !== null) {
    const name = cppFunction[1]!;
    if (CONTROL_WORDS.has(name)) return undefined;
    const fileLocal = language === "c" && /\bstatic\b/.test(text);
    return {
      kind: "function",
      name,
      exported: !fileLocal,
      ...(fileLocal ? { modifiers: ["static"] } : {}),
    };
  }
  return undefined;
}

function kindOf(token: string): GraphNodeKind {
  switch (token) {
    case "class":
    case "struct":
    case "object":
    case "extension":
      return "class";
    case "interface":
    case "trait":
    case "protocol":
      return "interface";
    case "type":
      return "type";
    case "enum":
      return "enum";
    case "namespace":
      return "namespace";
    case "module":
    case "mod":
      return "module";
    case "func":
    case "fn":
    case "function":
    case "def":
    case "fun":
    case "method":
      return "function";
    default:
      return "variable";
  }
}

function importsOf(
  file: string,
  language: GraphLanguage,
  lines: readonly string[],
): Array<{ name: string; evidence: ISamchonGraphEvidence }> {
  const out: Array<{ name: string; evidence: ISamchonGraphEvidence }> = [];
  let goImportBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!.trim();
    const names: string[] = [];
    if (language === "typescript") {
      for (const match of text.matchAll(
        /\bfrom\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|^import\s+["']([^"']+)["']/g,
      )) {
        names.push((match[1] ?? match[2] ?? match[3])!);
      }
    } else if (language === "go") {
      if (goImportBlock) {
        if (text.startsWith(")")) {
          goImportBlock = false;
        } else {
          const match = /^(?:(?:[._]|\w+)\s+)?["`]([^"`]+)["`]/.exec(text);
          if (match !== null) names.push(match[1]!);
        }
      } else if (/^import\s*\(/.test(text)) {
        goImportBlock = true;
      } else {
        const match = /^import\s+(?:(?:[._]|\w+)\s+)?["`]([^"`]+)["`]/.exec(
          text,
        );
        if (match !== null) names.push(match[1]!);
      }
    } else if (language === "rust") {
      const match = /^use\s+([^;]+);?/.exec(text);
      if (match !== null) names.push(match[1]!);
    } else if (language === "cpp" || language === "c") {
      const match = /^#include\s+[<"]([^>"]+)[>"]/.exec(text);
      if (match !== null) names.push(match[1]!);
    } else if (language === "swift") {
      // Swift's declaration-scoped forms (`import struct Foundation.URL`) and
      // its access-control attributes both sit where the shared rule expects a
      // module path, so the import is read by Swift's own rule.
      const imported = SwiftDeclarations.parseSwiftImport(text);
      if (imported !== undefined) names.push(imported.name);
    } else if (language === "zig") {
      // Zig has no import statement at all: a module arrives as an ordinary
      // `const std = @import("std");`, which no keyword-led rule can see.
      for (const imported of ZigDeclarations.zigImportsOf(text)) {
        names.push(imported.name);
      }
    } else {
      // A `package` clause is not an import. It says where the file's own
      // declarations live, and the declaration lane already indexes it as one
      // of them — as the shared package rule for Java and Kotlin, and as
      // `ScalaDeclarations` reports it for Scala. Reading it here as well hung
      // an external module off the very file that declares it, so `demo` was
      // both `demo` and a dependency named `demo`. Go never had the bug because
      // it has a rule of its own above.
      const match = /^(?:import|using)\s+([^;]+)/.exec(text);
      if (match !== null) names.push(match[1]!.trim());
    }
    for (const name of names.filter((value) => value !== "")) {
      out.push({
        name,
        evidence: { file, startLine: i + 1, endLine: i + 1 },
      });
    }
  }
  return out;
}

// Scan the body ONCE for identifier occurrences and resolve each against the
// name index — O(body length), not O(all names) with a regex per name. An
// identifier immediately followed by `(` is a call (an instantiation when it
// resolves to a class), otherwise a bare type reference. Relations are kept by
// `(from, target, kind)`, so distinct uses of the same target remain distinct.
// Dependency occurrence masking and conservative resolution live in
// staticDependencyEdges so every static language shares one ambiguity policy.

// A callable passed as a value — `app.use(handler)`, `queue.on("job", run)` — is
// a value access. The passing expression hands the callable to another function;
// it does not invoke the argument at that source position.
//
// The shape is the whole test: the name is bounded by an argument list on both
// sides (`(name,` / `, name)` / `(name)`), and it resolves to something
// callable. A name in a type position or an object literal never matches it.
function dependencyEdges(
  source: ISamchonGraphNode,
  body: string,
  byName: Map<string, ISamchonGraphNode[]>,
): ISamchonGraphEdge[] {
  return staticDependencyEdges(source, body, byName);
}

// Swift writes inheritance and protocol conformance as one `:` list, so the
// head names no relation of its own: `class Child: Base, Sendable` extends the
// first and conforms to the second with identical syntax. The relation carried
// here is therefore provisional; only the target's kind settles it, which is
// what `swiftInheritanceRelation` decides below.
function swiftSupertypesOf(
  header: string,
): Array<{ name: string; relation: "extends" | "implements" }> {
  return SwiftDeclarations.swiftInheritedTypes(header).map((name) => ({
    name,
    relation: "extends" as const,
  }));
}

function inheritanceEdges(
  source: ISamchonGraphNode,
  header: string,
  byName: Map<string, ISamchonGraphNode[]>,
  evidence: ISamchonGraphEvidence | undefined = source.evidence,
): ISamchonGraphEdge[] {
  if (
    source.kind !== "class" &&
    source.kind !== "interface" &&
    !(source.language === "swift" && source.kind === "enum")
  )
    return [];
  const out: ISamchonGraphEdge[] = [];
  const seen = new Set<string>();
  for (const supertype of source.language === "swift"
    ? swiftSupertypesOf(header)
    : supertypesOf(header)) {
    const target = resolveType(supertype.name, source, byName);
    if (target === undefined) continue;
    const relation =
      source.language === "csharp"
        ? CsharpDeclarations.csharpInheritanceRelation(
            source.kind,
            target.kind,
            supertype.relation,
          )
        : source.language === "swift"
          ? SwiftDeclarations.swiftInheritanceRelation(source.kind, target.kind)
          : supertype.relation;
    const key = `${relation}\0${target.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      from: source.id,
      to: target.id,
      kind: relation,
      evidence,
    });
  }
  return out;
}

function externalNode(
  language: GraphLanguage,
  imported: { name: string; evidence: ISamchonGraphEvidence },
  cache: Map<string, ISamchonGraphNode>,
): ISamchonGraphNode {
  const key = `external:${language}:${imported.name}`;
  let node = cache.get(key);
  if (node !== undefined) return node;
  node = {
    id: key,
    kind: "external_symbol",
    language,
    name: imported.name,
    file: "",
    external: true,
  };
  cache.set(key, node);
  return node;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const bucket = map.get(key);
  if (bucket === undefined) map.set(key, [value]);
  else bucket.push(value);
}

// A container whose direct children can be methods (unlike a function body).
// A method nested under a namespace/module still resolves because its direct
// owner is the class, not the namespace.
function isTypeContainer(kind: GraphNodeKind | undefined): boolean {
  return kind === "class" || kind === "interface";
}

function isContainer(kind: GraphNodeKind): boolean {
  return (
    kind === "class" ||
    kind === "interface" ||
    kind === "namespace" ||
    kind === "module" ||
    kind === "function" ||
    kind === "method" ||
    kind === "constructor"
  );
}

function declarationEndIndex(lines: readonly string[], start: number): number {
  let depth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let entered = false;
  for (let i = start; i < lines.length; i++) {
    const text = stripStringsAndComments(lines[i]!);
    for (const char of text) {
      if (char === "(") {
        parenDepth++;
      } else if (char === ")") {
        parenDepth = Math.max(0, parenDepth - 1);
      } else if (char === "[") {
        bracketDepth++;
      } else if (char === "]") {
        bracketDepth = Math.max(0, bracketDepth - 1);
      } else if (char === "{" && parenDepth === 0 && bracketDepth === 0) {
        depth++;
        entered = true;
      } else if (char === "}" && parenDepth === 0 && bracketDepth === 0) {
        depth = Math.max(0, depth - 1);
      }
    }
    if (entered && depth === 0) return i;
    if (!entered && text.trimEnd().endsWith(";")) return i;
  }
  return start;
}

function stripStringsAndComments(line: string): string {
  return line.replace(/\/\/.*$/, "").replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "");
}

function isCapitalized(name: string): boolean {
  return /^[A-Z]/.test(name);
}

// A language whose module surface has no keyword at all: everything a module
// declares is on its wire, and privacy is a leading underscore. That is
// punctuation, not vocabulary — it means the same thing in a codebase whose
// symbols are named in Japanese — which is exactly why it is the one naming
// convention the graph is willing to read. Degrade per language, not per tour.
const NO_EXPORT_KEYWORD = new Set<GraphLanguage>([
  "python",
  "ruby",
  "lua",
  "dart",
]);

function hasNoExportKeyword(language: GraphLanguage): boolean {
  return NO_EXPORT_KEYWORD.has(language);
}

const CONTROL_WORDS = new Set([
  "for",
  "if",
  "switch",
  "while",
  "catch",
  "return",
]);

const JAVA_STATEMENT_WORDS = new Set([
  ...CONTROL_WORDS,
  "assert",
  "case",
  "do",
  "else",
  "finally",
  "new",
  "this",
  "throw",
  "try",
]);
