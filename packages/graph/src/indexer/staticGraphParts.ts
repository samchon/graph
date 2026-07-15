import path from "node:path";
import {
  ISamchonGraphEdge,
  ISamchonGraphEvidence,
  ISamchonGraphNode,
} from "../structures";
import { GraphEdgeKind, GraphLanguage, GraphNodeKind } from "../typings";
import { projectRelative, readLines, walkSourceFiles } from "../utils/fs";
import { decoratorsAbove } from "./decoratorsAbove";
import { IBuildGraphOptions } from "./IBuildGraphOptions";
import { IStaticGraphParts } from "./IStaticGraphParts";
import { allExtensions, languageOf } from "./languages";
import { overrideEdges } from "./overrideEdges";
import { resolveType } from "./resolveType";
import { supertypesOf } from "./supertypesOf";

interface IDeclaration {
  node: ISamchonGraphNode;
  startIndex: number;
  endIndex: number;
  ownerId?: string;
}

const EXTERNAL_MODULE_LIMIT = 1_500;

/**
 * The static parse of a project, with spans intact and the §4k derivation not
 * yet run: what a hybrid build merges into its language-server slice before
 * finalizing the two together, so the export surface is followed once across the
 * whole project rather than once per lane.
 */
export function staticGraphParts(
  options: IBuildGraphOptions = {},
): IStaticGraphParts {
  const root = path.resolve(options.cwd ?? process.cwd());
  const files = walkSourceFiles(root, {
    extensions: allExtensions(options.languages),
    maxFiles: options.maxFiles,
  });
  const nodes: ISamchonGraphNode[] = [];
  const edges: ISamchonGraphEdge[] = [];
  const declarationsByFile = new Map<string, IDeclaration[]>();
  const byName = new Map<string, ISamchonGraphNode[]>();
  const externalNodes = new Map<string, ISamchonGraphNode>();
  const warnings: string[] = [];

  for (const file of files) {
    const lines = readLines(file);
    /* c8 ignore next */
    if (lines === undefined) continue;
    const rel = projectRelative(root, file);
    const language = languageOf(file);
    const declarations = declarationsOf(rel, language, lines);
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

  for (const [rel, declarations] of declarationsByFile) {
    const abs = path.join(root, rel);
    const lines = readLines(abs);
    /* c8 ignore next */
    if (lines === undefined) continue;
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
        .filter((_, offset) => {
          const index = declaration.startIndex + offset;
          return !nested.some((child) => index >= child.startIndex && index <= child.endIndex);
        })
        .join("\n");
      for (const edge of dependencyEdges(declaration.node, body, byName)) {
        edges.push(edge);
      }
      for (const edge of inheritanceEdges(
        declaration.node,
        lines[declaration.startIndex]!.trim(),
        byName,
      )) {
        edges.push(edge);
      }
      for (const name of decoratorsAbove(lines, declaration.startIndex)) {
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
    for (const edge of moduleScopeEdges(rel, lines, declarations, byName)) {
      edges.push(edge);
    }
  }

  edges.push(...overrideEdges(nodes, edges));

  if (files.length === 0) {
    warnings.push("No supported source files were found.");
  }

  return {
    root,
    files,
    languages: [...new Set(files.map(languageOf))],
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
  const out: ISamchonGraphEdge[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    if (covered.has(i)) continue;
    const text = lines[i]!;
    if (MODULE_IMPORT_LINE.test(text.trim())) continue;
    const source: ISamchonGraphNode = {
      id: file,
      kind: "file",
      language: "unknown",
      name: file,
      file,
      external: false,
      evidence: { file, startLine: i + 1, endLine: i + 1 },
    };
    for (const edge of dependencyEdges(source, text, byName)) {
      const key = `${edge.kind}\0${edge.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(edge);
    }
  }
  return out;
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
): IDeclaration[] {
  const declarations: IDeclaration[] = [];
  const ownerStack: Array<{ name: string; endIndex: number; id: string; kind: GraphNodeKind }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    while (ownerStack.length > 0 && i > ownerStack[ownerStack.length - 1]!.endIndex) {
      ownerStack.pop();
    }
    // Methods are only declared directly inside a type container. Detecting them
    // inside a function/method body turns bare call statements (`doThing(x)`
    // with no trailing `;`, as in Go and ASI JS/TS) into phantom method nodes.
    const parsed = parseDeclaration(
      language,
      line,
      isTypeContainer(ownerStack[ownerStack.length - 1]?.kind),
    );
    if (parsed !== undefined) {
      const endIndex = declarationEndIndex(lines, i);
      const owner = ownerStack.map((entry) => entry.name).join(".");
      const qualifiedName = owner === ""
        ? parsed.name
        : `${owner}.${parsed.name}`;
      const node: ISamchonGraphNode = {
        id: `${file}#${qualifiedName}:${parsed.kind}`,
        kind: parsed.kind,
        language,
        name: parsed.name,
        ...(qualifiedName !== parsed.name ? { qualifiedName } : {}),
        file,
        external: false,
        exported: parsed.exported,
        evidence: {
          file,
          startLine: i + 1,
          startCol: Math.max(1, line.indexOf(parsed.name) + 1),
          endLine: i + 1,
        },
      };
      declarations.push({
        node,
        startIndex: i,
        endIndex,
        ownerId: ownerStack[ownerStack.length - 1]?.id,
      });
      if (isContainer(parsed.kind) && endIndex > i) {
        ownerStack.push({
          name: parsed.name,
          endIndex,
          id: node.id,
          kind: parsed.kind,
        });
      }
    }
  }
  return declarations;
}

function parseDeclaration(
  language: GraphLanguage,
  line: string,
  inContainer: boolean,
): { kind: GraphNodeKind; name: string; exported?: boolean } | undefined {
  const text = line.trim();
  if (text === "" || text.startsWith("//") || text.startsWith("*")) return undefined;
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
  if (inContainer) {
    const method =
      /^(?:(?:public|private|protected|internal|static|abstract|final|open|override|async|pub|pub\(crate\))\s+)*([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*(?::|->|\{|$)/.exec(
        text,
      );
    if (method !== null && !CONTROL_WORDS.has(method[1]!)) {
      return { kind: "method", name: method[1]! };
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
    return {
      kind: kindOf(token),
      name,
      exported:
        /\b(export|public|pub)\b/.test(text) ||
        (language === "go" && isCapitalized(name)) ||
        (hasNoExportKeyword(language) && !name.startsWith("_")),
    };
  }
  if ((language === "c" || language === "cpp") && cppFunction !== null) {
    return { kind: "function", name: cppFunction[1]!, exported: true };
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
    } else {
      const match = /^(?:import|using|package)\s+([^;]+)/.exec(text);
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
// resolves to a class), otherwise a bare type reference; per target the call
// relation outranks a type reference, matching the previous "call-pattern
// first, else type" precedence exactly.
const IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]*/g;

function dependencyEdges(
  source: ISamchonGraphNode,
  body: string,
  byName: Map<string, ISamchonGraphNode[]>,
): ISamchonGraphEdge[] {
  const best = new Map<string, { target: ISamchonGraphNode; kind: GraphEdgeKind }>();
  IDENTIFIER.lastIndex = 0;
  for (let match = IDENTIFIER.exec(
    body,
  ); match !== null; match = IDENTIFIER.exec(body)) {
    const name = match[0];
    if (name === source.name) continue;
    const targets = byName.get(name);
    if (targets === undefined) continue;
    // `name` differs from `source.name` (skipped above), so `source` is never
    // among these targets and a non-self target always exists.
    const target = targets.find(
      (node) => node.file !== source.file || node.id !== source.id,
    );
    /* c8 ignore next */
    if (target === undefined) continue;
    // A `(` after any run of whitespace makes this occurrence a call site.
    let cursor = match.index + name.length;
    while (cursor < body.length && (body[cursor] === " " || body[cursor] === "\t")) cursor++;
    const isCall = body[cursor] === "(";
    const kind: GraphEdgeKind = isCall
      ? target.kind === "class"
        ? "instantiates"
        : "calls"
      : isHandOff(body, match.index, cursor, target)
        ? "calls"
        : "type_ref";
    const prev = best.get(target.id);
    if (prev === undefined || (prev.kind === "type_ref" && kind !== "type_ref")) {
      best.set(target.id, { target, kind });
    }
  }
  const out: ISamchonGraphEdge[] = [];
  for (const { target, kind } of best.values()) {
    out.push({
      from: source.id,
      to: target.id,
      kind,
      evidence: source.evidence,
    });
  }
  return out;
}

// §2j: a callable passed as a value — `app.use(handler)`, `queue.on("job", run)`
// — is how an event-driven codebase wires itself, and the call graph cannot see
// it: the name sits in an argument list with no `(` of its own, so it read as a
// type reference and `trace` returned an empty path between two symbols that
// plainly reach each other. The passing site invokes the passed function, so it
// gets the edge that says so.
//
// The shape is the whole test: the name is bounded by an argument list on both
// sides (`(name,` / `, name)` / `(name)`), and it resolves to something
// callable. A name in a type position or an object literal never matches it.
function isHandOff(
  body: string,
  start: number,
  afterName: number,
  target: ISamchonGraphNode,
): boolean {
  if (target.kind !== "function" && target.kind !== "method") return false;
  let before = start - 1;
  while (before >= 0 && (body[before] === " " || body[before] === "\t")) before--;
  const opens = body[before] === "(" || body[before] === ",";
  const closes = body[afterName] === ")" || body[afterName] === ",";
  return opens && closes;
}

function inheritanceEdges(
  source: ISamchonGraphNode,
  line: string,
  byName: Map<string, ISamchonGraphNode[]>,
): ISamchonGraphEdge[] {
  if (source.kind !== "class" && source.kind !== "interface") return [];
  const out: ISamchonGraphEdge[] = [];
  const seen = new Set<string>();
  for (const supertype of supertypesOf(line)) {
    const target = resolveType(supertype.name, source, byName);
    if (target === undefined) continue;
    const key = `${supertype.relation}\0${target.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      from: source.id,
      to: target.id,
      kind: supertype.relation,
      evidence: source.evidence,
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
