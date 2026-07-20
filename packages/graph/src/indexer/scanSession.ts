import path from "node:path";
import {
  CsharpDeclarations,
  PhpDeclarations,
  RubyDeclarations,
  rustImplOwner,
} from "@samchon/graph-sitter";
import {
  DocumentSymbolResult,
  IDocumentSymbol,
  ILocation,
  isDocumentSymbol,
  ISymbolInformation,
  LspClient,
} from "../lsp";
import { isTestPath } from "../operations/isTestPath";
import {
  ISamchonGraphDiagnostic,
  ISamchonGraphEdge,
  ISamchonGraphEvidence,
  ISamchonGraphNode,
} from "../structures";
import { GraphLanguage, GraphNodeKind } from "../typings";
import { projectRelative } from "../utils/fs";
import { fileFromUri, fileUri, isSubPath } from "../utils/path";
import { appendAll } from "./appendAll";
import { decoratorsAbove } from "./decoratorsAbove";
import { IBuildGraphOptions } from "./IBuildGraphOptions";
import { ILspSession } from "./ILspSession";
import { resolveType } from "./resolveType";
import { supertypesOf } from "./supertypesOf";

const EXECUTABLE_NODE_KINDS = new Set<GraphNodeKind>([
  "function",
  "method",
  "constructor",
]);

export async function scanSession(
  session: ILspSession,
  options: IBuildGraphOptions,
): Promise<{
  nodes: ISamchonGraphNode[];
  edges: ISamchonGraphEdge[];
  diagnostics: ISamchonGraphDiagnostic[];
  warnings: string[];
}> {
  const { client, root, language } = session;
  const opened = [...session.opened.entries()].map(([rel, entry]) => ({
    abs: entry.abs,
    rel,
    text: entry.text,
  }));
  const nodes: ISamchonGraphNode[] = [];
  const byFile = new Map<string, ISamchonGraphNode[]>();
  for (const openedFile of opened) {
    const symbols = await client.request<DocumentSymbolResult>(
      "textDocument/documentSymbol",
      { textDocument: { uri: fileUri(openedFile.abs) } },
      undefined,
      options.signal,
    );
    const converted = convertSymbols(
      language,
      openedFile.rel,
      symbols,
      openedFile.text,
    );
    byFile.set(openedFile.rel, converted);
    appendAll(nodes, converted);
  }

  const linesByFile = new Map<string, string[]>();
  for (const openedFile of opened) {
    linesByFile.set(openedFile.rel, openedFile.text.split(/\r?\n/));
  }

  const edges: ISamchonGraphEdge[] = [];
  const referenceLimit = options.lspReferenceLimit;
  // Undefined keeps the compiler-complete default. A caller that explicitly
  // sets a budget gets the historical product-code-first ordering.
  // JDT.LS reports an anonymous class as a document symbol named
  // `new Type() {...}`, but `textDocument/references` at that symbol does not
  // mean references to that anonymous-class identity. It returns every
  // construction of the anonymous class's nominal supertype. Querying each of
  // those synthetic containers therefore creates an N x N instantiation
  // cross-product. Keep the symbol and its children in the graph, but derive
  // references only from declarations whose identity the server can answer.
  const referenceCandidates = nodes.filter(
    (node) => !isJavaAnonymousClass(node),
  );
  const referenceTargets = referenceLimit === undefined
    ? referenceCandidates
    : [...referenceCandidates]
        .sort((a, b) => Number(isTestPath(a.file)) - Number(isTestPath(b.file)))
        .slice(0, referenceLimit);
  // Language servers build their cross-file reference index lazily — often on
  // the FIRST `textDocument/references` call, not during the initial
  // `$/progress` indexing wait above. So warm the index with one patient
  // request before firing the batch: once it exists, every later request is
  // served from the server's cache in milliseconds. Firing the whole batch
  // cold instead makes every request race the same one-time build and time
  // out (ruby-lsp on a fresh project is the pathological case). Results stay
  // indexed by target order to keep edge output deterministic.
  const referenceParams = (target: ISamchonGraphNode): unknown => {
    const evidence = target.evidence!;
    return {
      textDocument: { uri: fileUri(path.join(root, target.file)) },
      position: {
        line: evidence.startLine - 1,
        character: Math.max(0, evidence.startCol! - 1),
      },
      context: { includeDeclaration: false },
    };
  };
  const referenceResults: (ILocation[] | null)[] = new Array(
    referenceTargets.length,
  ).fill(null);
  // Warm the server's lazy cross-file index with one patient request before the
  // batch: the first `textDocument/references` often makes the server build its
  // reference index, after which later requests are cache-fast.
  let referencesUnavailable = false;
  if (referenceTargets.length > 0) {
    const progressFence = session.progressVersion?.();
    let warm = await safeReferences(
      client,
      referenceParams(referenceTargets[0]!),
      options.lspWarmupTimeoutMs,
      options.signal,
    );
    if (
      progressFence !== undefined &&
      session.waitForReady !== undefined &&
      session.progressVersion?.() !== progressFence
    ) {
      // Several servers defer their cross-file index until the first reference
      // query. The first answer can be a valid-but-incomplete empty array while
      // that query starts a work-done lifecycle. Wait for its end and ask once
      // more; the second answer is from the completed index.
      await session.waitForReady(progressFence, false, options.signal);
      warm = await safeReferences(
        client,
        referenceParams(referenceTargets[0]!),
        options.lspWarmupTimeoutMs,
        options.signal,
      );
    }
    if (warm === "timeout") referencesUnavailable = true;
    else referenceResults[0] = warm;
  }
  if (!referencesUnavailable && referenceTargets.length > 1) {
    const rest = await mapWithConcurrency(
      referenceTargets.slice(1),
      options.lspConcurrency ?? 16,
      async (target) => {
        const refs = await safeReferences(
          client,
          referenceParams(target),
          undefined,
          options.signal,
        );
        return refs === "timeout" ? null : refs;
      },
    );
    for (let index = 0; index < rest.length; index++) {
      referenceResults[index + 1] = rest[index]!;
    }
  }
  for (let index = 0; index < referenceTargets.length; index++) {
    const target = referenceTargets[index]!;
    const refs = referenceResults[index];
    for (const ref of refs ?? []) {
      const refFile = fileFromUri(ref.uri);
      if (!isSubPath(root, refFile)) continue;
      const rel = projectRelative(root, refFile);
      const owners = byFile.get(rel);
      if (owners === undefined) continue;
      const fileLines = linesByFile.get(rel);
      // The language server reports a reference range whose start is the AST
      // node's full-start (leading whitespace and comments included), not the
      // token's real start, so advance past that trivia — the same correction
      // @ttsc/graph's own dump applies (dump.go firstCodeOffset) before it uses
      // a node position. Without it the classifier reads the character before
      // the identifier (a space, `.`, `<`, ...) and the evidence points one
      // column early.
      const start = firstCodeAt(
        fileLines,
        ref.range.start.line,
        ref.range.start.character,
      );
      const startLineText = fileLines?.[start.line];
      // §2j: a reference no declaration encloses is a top-level statement, and
      // it belongs to the module — the file node every top-level declaration
      // already hangs off. Without it a module's own wiring (a router mounting
      // its handlers at load) is attributed to nobody, and the codebase reads
      // back as disconnected islands.
      //
      // Two references are not module scope. An import or a re-export names a
      // symbol in order to bring it in, which is not the module running it. And
      // a position past the end of the file is not a statement at all — a server
      // that reports one has told us nothing to attribute, so nothing is.
      const owner =
        ownerAt(owners, start.line + 1) ??
        (startLineText === undefined || isModuleImportLine(startLineText)
          ? undefined
          : moduleOwnerOf(rel, target.language));
      if (owner === undefined || owner.id === target.id) continue;
      const endLineText =
        ref.range.end.line === start.line
          ? startLineText
          : fileLines?.[ref.range.end.line];
      const accessText = accessExpressionAt(
        endLineText,
        ref.range.end.character,
      );
      // The text following the reference, as one string: the rest of the end
      // line plus a bounded run of following lines. A generic call whose
      // argument list opens several lines below the name (`fn<\n  T\n>(...)`)
      // needs the later `(` to classify as a call, and single-line uses only
      // read the immediate characters.
      const afterText = tailFrom(
        fileLines,
        ref.range.end.line,
        ref.range.end.character,
      );
      const kind = referenceKind(
        language,
        target.kind,
        startLineText,
        afterText,
        start.character,
        ref.range.end.line !== start.line,
        accessText,
      );
      // Coordinates, and nothing else. `accessText` is the classifier's hint —
      // `referenceKind` reads it, and the dotted-JSX check below reads it — and
      // it stays a local: evidence is what a reader cites, and a source snippet
      // on every edge is the redundant payload §6b exists to keep off the wire.
      // The graph does not carry the text inside a span; it carries the span.
      const evidence: ISamchonGraphEvidence = {
        file: rel,
        startLine: start.line + 1,
        startCol: start.character + 1,
        endLine: ref.range.end.line + 1,
        endCol: ref.range.end.character + 1,
      };
      const emit = (kindToEmit: ISamchonGraphEdge["kind"]): void => {
        edges.push({
          from: owner.id,
          to: target.id,
          kind: kindToEmit,
          evidence,
        });
        // A non-method class/interface member (a property or an arrow-
        // function-valued field) attributes its body's references to both
        // itself AND the enclosing class/interface, not one or the other --
        // confirmed against @ttsc/graph's own fact-builder (forEachMember
        // walks a property member's subtree once for the member, once for its
        // container). A local variable is different: Python servers expose
        // locals as document symbols, and a call in `response = dispatch()` is
        // first owned by `response`. Attribute that edge to the nearest
        // executable too, or the method's runtime flow loses every assigned
        // call. A class-level variable has no executable owner and retains the
        // existing class/interface attribution.
        if (owner.kind === "property" || owner.kind === "field" || owner.kind === "variable") {
          const container =
            owner.kind === "variable"
              ? owner.closure === true
                ? undefined
                : executableAt(owners, start.line + 1, owner.id) ??
                  containerAt(owners, start.line + 1)
              : containerAt(owners, start.line + 1);
          if (
            container !== undefined &&
            container.id !== owner.id &&
            container.id !== target.id
          ) {
            edges.push({
              from: container.id,
              to: target.id,
              kind: kindToEmit,
              evidence,
            });
          }
        }
      };
      emit(kind);
      // A namespaced JSX tag (`<A.B.C />`) is both a render and a member-
      // access chain reaching the component, so @ttsc/graph's AST walk emits
      // a render AND an access edge to the same target; mirror the extra
      // access when the render's tag name is dotted.
      if (kind === "renders" && accessText !== undefined && accessText.includes(
        ".",
      )) {
        emit("accesses");
      }
    }
  }

  // Make the document-symbol hierarchy explicit: every nested symbol is
  // contained by its owner. The owner is the node whose path is this node's
  // qualified name without its last segment.
  const nodeByPath = new Map<string, ISamchonGraphNode>();
  for (const node of nodes) {
    nodeByPath.set(`${node.file}\0${node.qualifiedName ?? node.name}`, node);
  }
  for (const node of nodes) {
    if (node.qualifiedName === undefined) continue;
    const parent = nodeByPath.get(
      `${node.file}\0${node.qualifiedName.slice(0, node.qualifiedName.lastIndexOf("."))}`,
    );
    if (parent === undefined) continue;
    edges.push({
      from: parent.id,
      to: node.id,
      kind: "contains",
      evidence: node.evidence,
    });
  }

  // Inheritance: language servers do not report supertypes uniformly, so parse the
  // declaration line the same way the static indexer does and resolve the
  // supertypes against the symbols the server did report.
  const byName = new Map<string, ISamchonGraphNode[]>();
  for (const node of nodes) {
    const list = byName.get(node.name);
    if (list === undefined) byName.set(node.name, [node]);
    else list.push(node);
  }
  for (const node of nodes) {
    if (node.kind !== "class" && node.kind !== "interface") continue;
    const line = linesByFile.get(node.file)![node.evidence!.startLine - 1]!.trim();
    const seen = new Set<string>();
    for (const supertype of supertypesOf(line)) {
      const target = resolveType(supertype.name, node, byName);
      if (target === undefined) continue;
      const relation =
        node.language === "csharp"
          ? CsharpDeclarations.csharpInheritanceRelation(
              node.kind,
              target.kind,
              supertype.relation,
            )
          : supertype.relation;
      const key = `${relation}\0${target.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        from: node.id,
        to: target.id,
        kind: relation,
        evidence: node.evidence,
      });
    }
  }
  // Decorators sit on the lines directly above a declaration; link the
  // decorated symbol to the decorator it names.
  for (const node of nodes) {
    const fileLines = linesByFile.get(node.file)!;
    for (const name of decoratorsAbove(
      fileLines,
      node.evidence!.startLine - 1,
    )) {
      const target = resolveType(name, node, byName);
      if (target === undefined) continue;
      edges.push({
        from: node.id,
        to: target.id,
        kind: "decorates",
        evidence: node.evidence,
      });
    }
  }
  return {
    nodes,
    edges,
    // What the server currently says about the files that currently exist, in a
    // stable order: two builds of one unedited checkout must agree (§6a), and a
    // language server publishes its notifications in whatever order it pleases.
    // By file, then by line; a sort is stable, so two findings on one line keep
    // the order the server gave them for that document.
    diagnostics: [...session.diagnostics.keys()]
      .sort((a, b) => Number(a > b) - Number(a < b))
      .flatMap((file) =>
        [...session.diagnostics.get(file)!].sort((a, b) => a.line - b.line),
      ),
    warnings: [
      ...(referenceLimit !== undefined && nodes.length > referenceLimit
        ? [`${language}: reference collection capped at ${referenceLimit} symbols.`]
        : []),
      ...(referencesUnavailable
        ? [`${language}: server did not answer references within the warmup budget; kept structural edges only.`]
        : []),
    ],
  };
}

// Advance a (line, character) position past leading trivia — whitespace, `//`
// line comments, and `/* */` block comments — to the first code character at
// or after it, crossing line boundaries. Ports @ttsc/graph's dump.go
// firstCodeOffset: the language server reports a reference's start as the AST
// node full-start (trivia included), so this recovers the token's real start.
function firstCodeAt(
  lines: readonly string[] | undefined,
  line: number,
  character: number,
): { line: number; character: number } {
  // Every caller passes the file's own cached lines, so this is defensive.
  /* c8 ignore next */
  if (lines === undefined) return { line, character };
  let l = line;
  let c = character;
  let inBlock = false;
  while (l < lines.length) {
    const text = lines[l]!;
    while (c < text.length) {
      if (inBlock) {
        if (text[c] === "*" && text[c + 1] === "/") {
          inBlock = false;
          c += 2;
        } else c++;
        continue;
      }
      const ch = text[c]!;
      if (ch === " " || ch === "\t" || ch === "\r") {
        c++;
      } else if (ch === "/" && text[c + 1] === "/") {
        c = text.length; // rest of line is a comment
      } else if (ch === "/" && text[c + 1] === "*") {
        inBlock = true;
        c += 2;
      } else {
        return { line: l, character: c };
      }
    }
    // Ran off the end of the line (or a `//` comment consumed it); the trivia
    // continues on the next line.
    /* c8 ignore next */
    if (l + 1 >= lines.length) break;
    l++;
    c = 0;
  }
  return { line, character };
}

// The source text following a reference: the rest of its end line, plus a
// bounded run of the lines below when the classification may continue there —
// the name sits at the end of its line, or a generic `<` opens on it. Those
// are the only shapes whose invocation `(` can appear on a later line
// (`fn<\n  T\n>(...)`); every other tail is settled by the end line alone.
function tailFrom(
  lines: readonly string[] | undefined,
  endLine: number,
  endCol: number,
): string {
  // Every caller passes the file's own cached lines, so this is defensive.
  /* c8 ignore next */
  if (lines === undefined) return "";
  const here = lines[endLine]?.slice(endCol) ?? "";
  const trimmed = here.trimStart();
  if (trimmed !== "" && !trimmed.startsWith("<")) return here;
  let text = here;
  for (let k = endLine + 1; k <= endLine + 16 && k < lines.length; k++) {
    text += `\n${lines[k]!}`;
  }
  return text;
}

// The dotted access expression ending exactly at a reference's end column
// (e.g. `this._internals.foo` for a reference to `foo`), when the reference sits
// at the end of one. It is a classification hint and stays one: `referenceKind`
// reads it to tell a member read (`obj.method`) from a bare reference, and the
// dotted-JSX check reads it to know a namespaced tag is also an access. It never
// reaches an edge — the graph carries the span, not the text inside it.
function accessExpressionAt(
  line: string | undefined,
  endCol: number,
): string | undefined {
  if (line === undefined) return undefined;
  const match = /[A-Za-z_$][\w$]*(?:\?\.[A-Za-z_$][\w$]*|\.[A-Za-z_$][\w$]*)*$/.exec(
    line.slice(0, endCol),
  );
  return match?.[0];
}

// Classify a reference the same way the static indexer does, but with the
// language server's exact position: a JSX element use (`<Component ...`) is a
// render; an identifier immediately followed by `(` — skipping over a generic
// argument list, so `new Map<K, V>()` and `myFunc<T>()` still count — is an
// invocation (a class becomes an instantiation, anything else a call);
// otherwise the target's kind decides between a type reference, a member
// access, and a generic reference.
//
// `afterText` is the source that follows the reference — the rest of its end
// line plus a bounded run of the lines below it — so a generic argument list
// (`fn<...>`) that only closes several lines down still reveals the `(` that
// makes the reference a call.
function referenceKind(
  language: GraphLanguage,
  targetKind: GraphNodeKind,
  startLine: string | undefined,
  afterText: string,
  startCol: number,
  multiline: boolean,
  accessText: string | undefined,
): ISamchonGraphEdge["kind"] {
  // The text before the reference (its start already advanced past leading
  // trivia to the real token), trimmed of the whitespace that separates the
  // keyword from the name.
  const before = (
    startLine === undefined ? "" : startLine.slice(0, startCol)
  ).replace(/\s+$/, "");
  // A `new X` expression instantiates X even when a generic argument list
  // (`new Map<K, V>(...)`) pushes the `(` onto a later line the end-line check
  // below can't see; the `new` keyword right before the name is the reliable
  // signal @ttsc/graph reads from its AST NewExpression.
  if (/\bnew$/.test(before)) return "instantiates";
  // A `typeof X` type query depends on X's type — @ttsc/graph records it as a
  // type reference, not the value access X's own kind would otherwise imply.
  // The token alone is insufficient: runtime `typeof` is a value access.
  if (/\btypeof$/.test(before)) {
    if (language !== "typescript") return "type_ref";
    return isTypeScriptTypeQuery(before) ? "type_ref" : "accesses";
  }
  // A JSX tag name never spans lines, so only consider it on a single-line
  // reference: a multi-line reference's start column can land on an unrelated
  // trailing `<` (a comparison / generic on the receiver line) and be misread
  // as a tag.
  if (!multiline && isJsxElementUse(startLine, startCol)) return "renders";
  let after = afterGenericArgs(afterText.trimStart());
  // An optional call `fn?.()` invokes fn; the `?.` sits between the name and
  // the argument list. (A `?.member` without a following `(` is an access,
  // handled below, so only strip the `?.` when it leads into a call.)
  if (after.startsWith("?.")) after = after.slice(2).trimStart();
  if (after.startsWith("(")) {
    return targetKind === "class" || targetKind === "constructor"
      ? "instantiates"
      : "calls";
  }
  // A callable passed as a value (`app.use(handler)`) is how an event-driven
  // codebase wires itself. It is a value access, not a call: this expression
  // hands the callable to `use`, but does not invoke `handler` here. This is the
  // exact distinction @ttsc/graph's handedOffValues collector preserves.
  if (
    (targetKind === "function" || targetKind === "method") &&
    isArgumentPosition(before, after)
  ) {
    return "accesses";
  }
  switch (targetKind) {
    case "class":
    case "interface":
    case "type":
    case "enum":
      return "type_ref";
    case "property":
    case "field":
    case "variable":
      return "accesses";
    case "constructor":
    case "external_symbol":
    case "file":
    case "function":
    case "method":
    case "module":
    case "namespace":
    case "package":
    case "parameter":
      // A bare non-call reference resolves by the target's kind above; a
      // callable (method/function/constructor) reached through a member
      // access (`obj.method` without a following `(`, so `accessText` carries
      // the receiver `.member` chain) is a property read, the same
      // value-access @ttsc/graph records, not a generic reference.
      return accessText !== undefined && accessText.includes(".")
        ? "accesses"
        : "references";
  }
}

function isTypeScriptTypeQuery(before: string): boolean {
  const prefix = before.replace(/\btypeof$/, "").trimEnd();
  if (/\b(?:as|satisfies|keyof|infer)\s*$/.test(prefix)) return true;

  // A type alias keeps the whole right-hand side in type space, including
  // parenthesized, union, and intersection forms before a nested `typeof`.
  const statement = prefix.slice(
    Math.max(prefix.lastIndexOf(";"), prefix.lastIndexOf("{")) + 1,
  );
  if (/\btype\s+[A-Za-z_$][\w$]*(?:\s*<[^>]*>)?\s*=/.test(statement)) {
    return true;
  }

  // Declaration annotations: variable/property/parameter types and callable
  // return types. Requiring the declaration-shaped prefix avoids treating a
  // ternary's `: typeof value` runtime branch as a type query.
  if (
    /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\??\s*:\s*$/.test(prefix) ||
    /(?:^|[(,])\s*(?:public|private|protected|readonly)?\s*[A-Za-z_$][\w$]*\??\s*:\s*$/.test(
      prefix,
    ) ||
    /\)\s*:\s*$/.test(prefix) ||
    /^\s*(?:(?:public|private|protected|static|readonly|declare|abstract)\s+)*[A-Za-z_$][\w$]*\??\s*:\s*$/.test(
      prefix,
    )
  ) {
    return true;
  }

  // Generic type arguments such as `ReturnType<typeof fn>` are unambiguously
  // in type space when the unmatched `<` belongs directly to a type name.
  return /\b[A-Za-z_$][\w$.]*\s*<\s*$/.test(prefix);
}

// The name is bounded by an argument list on both sides — `(name,`, `, name)`,
// `(name)` — which is what a value handed to a call looks like, and what a name
// in a type position or an object literal never looks like.
function isArgumentPosition(before: string, after: string): boolean {
  const opens = before.endsWith("(") || before.endsWith(",");
  const closes = after.startsWith(")") || after.startsWith(",");
  return opens && closes;
}

// The module a top-level statement belongs to: the file container node every
// top-level declaration already hangs off, named by the file's own path.
function moduleOwnerOf(
  file: string,
  language: GraphLanguage,
): ISamchonGraphNode {
  return {
    id: file,
    kind: "file",
    language,
    name: file,
    file,
    external: false,
  };
}

// An import or a re-export names a symbol in order to bring it in, which is not
// the module running it.
//
// Every one of these keywords is followed by whitespace, never by `(`. That
// distinction is the whole point: `use(handler)` is a module wiring itself up —
// the case §2j exists for — and `use crate::order` is Rust bringing a name in.
const MODULE_IMPORT_LINE =
  /^(?:import\b|export\s+(?:\*|\{)|from\s|use\s|using\s|#include\b|package\s|require\s)/;

function isModuleImportLine(line: string | undefined): boolean {
  return line !== undefined && MODULE_IMPORT_LINE.test(line.trim());
}

// A JSX element name immediately follows `<` (opening) or `</` (closing), and
// that `<` is not itself part of a generic/comparison expression (`Array<`,
// `x < y`), which puts an identifier character directly before it.
function isJsxElementUse(
  refLine: string | undefined,
  startCol: number,
): boolean {
  if (refLine === undefined) return false;
  const before = refLine.slice(0, startCol);
  const match = /<\/?$/.exec(before);
  if (match === null) return false;
  const beforeAngle = before[match.index - 1];
  return beforeAngle === undefined || !/[A-Za-z0-9_$]/.test(beforeAngle);
}

// Skip a leading balanced `<...>` generic argument list (`<K, V>` in
// `new Map<K, V>()`), so the invocation check right after can still see the
// `(`. Unmatched (no closing `>` on this line) returns the text unchanged, so
// the caller's `startsWith("(")` check simply fails as it did before.
function afterGenericArgs(text: string): string {
  if (!text.startsWith("<")) return text;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "<") depth++;
    else if (text[i] === ">") {
      depth--;
      if (depth === 0) return text.slice(i + 1).trimStart();
    }
  }
  return text;
}

// Language servers such as rust-analyzer answer requests made during indexing
// with a `ContentModified` error; letting that reject would drop the whole
// language to the static fallback. Retry those fast rejections a few times,
// then treat this target as having no references rather than failing the
// language. A TIMEOUT is different: it already burned the full request timeout,
// so retrying triples the damage — report it so the caller can stop asking.
async function safeReferences(
  client: LspClient,
  params: unknown,
  timeoutMs?: number,
  signal?: AbortSignal,
): Promise<ILocation[] | null | "timeout"> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await client.request<ILocation[] | null>(
        "textDocument/references",
        params,
        timeoutMs,
        signal,
      );
    } catch (error) {
      if ((error as Error).name === "AbortError") throw error;
      if ((error as Error).message.startsWith("LSP request timed out")) {
        return "timeout";
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
    }
  }
  return null;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const run = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!);
    }
  };
  const lanes = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: lanes }, run));
  return results;
}

function convertSymbols(
  language: GraphLanguage,
  file: string,
  symbols: DocumentSymbolResult,
  text: string,
): ISamchonGraphNode[] {
  const out: ISamchonGraphNode[] = [];
  const lines = text.split(/\r?\n/);
  const rubyDeclarations =
    language === "ruby" ? RubyDeclarations.scan(lines) : undefined;
  const phpNamespaces =
    language === "php" ? PhpDeclarations.indexPhpNamespaces(text) : undefined;
  const csharpFlatOwnerKinds =
    language === "csharp"
      ? csharpOwnerKindsOf(
          (symbols ?? []).filter(
            (symbol): symbol is ISymbolInformation => !isDocumentSymbol(symbol),
          ),
        )
      : undefined;
  const declaredRustTypes = new Set(
    (symbols ?? [])
      .filter(isDocumentSymbol)
      .filter((symbol) => {
        const kind = kindOf(symbol.kind);
        return (
          kind === "class" ||
          kind === "interface" ||
          kind === "type" ||
          kind === "enum"
        );
      })
      .map((symbol) => symbol.name),
  );
  // ttsc marks a node exported only when its symbol is in the source file's
  // module export table (exports.go/markExports): a class member is never a
  // module export, and a top-level declaration is exported only when the file
  // actually exports it. Go has no export table or keyword: its specification
  // makes the first rune of the declared identifier the package boundary, so
  // preserve that fact directly instead of promoting every LSP symbol.
  const exportedNames = exportedTopLevelNames(language, text);
  const isExported = (
    name: string,
    topLevel: boolean,
    modifiers?: ISamchonGraphNode["modifiers"],
  ): boolean => {
    if (!topLevel) return false;
    if (language === "go") return isGoExportedName(name);
    // A file-scope C declaration is externally visible unless it has
    // `static` linkage. clangd reports both forms as ordinary top-level
    // symbols, so the source prefix is the only place that distinction lives.
    if (language === "c") return modifiers?.includes("static") !== true;
    // A Java compilation unit exposes only public top-level types. Package-
    // private declarations remain addressable inside the project, but are not
    // consumer API and must not seed an exported-surface tour.
    if (language === "java") return modifiers?.includes("public") === true;
    if (exportedNames === undefined) return true;
    return exportedNames.has(name);
  };
  const visitDocument = (
    symbol: IDocumentSymbol,
    owners: string[],
    ownerKinds: GraphNodeKind[],
    insideClosure: boolean,
  ): void => {
    const rawKind = kindOf(symbol.kind);
    const kind = ownedVariableKind(
      language,
      rawKind,
      ownerKinds.at(-1),
      owners.at(-1),
      lines[symbol.selectionRange.start.line] ?? "",
    );
    const genericIdentity = symbolIdentity(language, symbol.name, owners);
    const phpNamespace =
      phpNamespaces === undefined
        ? undefined
        : PhpDeclarations.phpNamespaceAt(
            phpNamespaces,
            symbol.selectionRange.start.line,
            symbol.selectionRange.start.character,
          );
    const identity =
      language === "csharp"
        ? CsharpDeclarations.csharpDocumentIdentity(
            genericIdentity.name,
            genericIdentity.owners,
            kind,
            lines[symbol.selectionRange.start.line] ?? "",
          )
        : language === "php"
          ? PhpDeclarations.phpSymbolIdentity(
              genericIdentity.name,
              genericIdentity.owners,
              kind,
              phpNamespace,
            )
          : genericIdentity;
    const transparentOwner =
      rawKind === undefined && language === "rust"
        ? rustImplOwner(symbol.name, declaredRustTypes)
        : undefined;
    const callableLocal =
      language === "python" &&
      rawKind === "variable" &&
      EXECUTABLE_NODE_KINDS.has(ownerKinds.at(-1)!) &&
      pythonVariableBindsLambda(symbol, lines);
    const anonymousClass =
      language === "java" &&
      kind === "class" &&
      isJavaAnonymousClassName(symbol.name);
    const closure = insideClosure || callableLocal || anonymousClass;
    const rubyDeclaration = rubyDeclarations?.get(
      symbol.selectionRange.start.line,
    );
    const modifiers =
      language === "ruby"
        ? rubyDeclaration?.modifiers
        : language === "java"
          ? javaModifiersOf(symbol, lines)
          : language === "csharp"
            ? csharpModifiersOf(symbol, lines, kind, ownerKinds.at(-1))
            : language === "php"
              ? phpModifiersOf(symbol, lines, kind, ownerKinds.at(-1))
              : language === "c"
                ? cGraphModifiersOf(symbol, lines)
                : undefined;
    // Pyright reports every parameter and ordinary local assignment as a
    // DocumentSymbol. The compiler-native reference graph deliberately does
    // not: local values are not places code runs, and recording them makes the
    // graph drown in value temporaries. Keep module/class variables and the one
    // executable local form Python can bind directly, a lambda closure.
    const included =
      kind !== undefined &&
      !(
        language === "python" &&
        rawKind === "variable" &&
        EXECUTABLE_NODE_KINDS.has(ownerKinds.at(-1)!) &&
        !callableLocal
      );
    if (included) {
      const qualifiedName = [...identity.owners, identity.name].join(".");
      out.push({
        id: `${file}#${qualifiedName}:${kind}`,
        kind,
        language,
        name: identity.name,
        ...(identity.owners.length > 0 ? { qualifiedName } : {}),
        file,
        external: false,
        ...(closure ? { closure: true } : {}),
        ...(modifiers !== undefined && modifiers.length > 0
          ? { modifiers }
          : {}),
        ...(language === "go" && identity.owners.length > 0
          ? {
              modifiers: [
                isGoExportedName(identity.name) ? "public" : "private",
              ],
            }
          : {}),
        ...((language === "ruby"
          ? rubyDeclaration?.exported === true
          : language === "csharp"
            ? CsharpDeclarations.isCSharpPublishedType(
                kind,
                ownerKinds,
                modifiers,
              )
            : language === "php"
              ? PhpDeclarations.isPhpPublishedDeclaration(kind, ownerKinds)
              : isExported(
                  identity.name,
                  identity.owners.length === 0,
                  modifiers,
                ))
          ? { exported: true }
          : {}),
        evidence: {
          file,
          startLine: symbol.selectionRange.start.line + 1,
          startCol: symbol.selectionRange.start.character + 1,
          endLine: symbol.range.end.line + 1,
          endCol: symbol.range.end.character + 1,
        },
      });
    }
    for (const child of symbol.children ?? []) {
      visitDocument(
        child,
        !included
          ? transparentOwner === undefined
            ? identity.owners
            : [...identity.owners, transparentOwner]
          : [...identity.owners, identity.name],
        !included ? ownerKinds : [...ownerKinds, kind],
        closure,
      );
    }
  };
  for (const symbol of symbols ?? []) {
    if (isDocumentSymbol(symbol)) visitDocument(symbol, [], [], false);
    else
      out.push(
        convertSymbolInformation(
          language,
          file,
          symbol,
          lines,
          rubyDeclarations,
          phpNamespaces,
          csharpFlatOwnerKinds?.get(symbol),
        ),
      );
  }
  return out;
}

/** Recover file-linkage modifiers from the declaration prefix clangd owns. */
function cGraphModifiersOf(
  symbol: IDocumentSymbol,
  lines: readonly string[],
): NonNullable<ISamchonGraphNode["modifiers"]> {
  const start = symbol.range.start;
  const end = symbol.selectionRange.start;
  if (end.line < start.line) return [];
  const source: string[] = [];
  for (let line = start.line; line <= end.line; line++) {
    const text = lines[line] ?? "";
    const from = line === start.line ? start.character : 0;
    const to = line === end.line ? end.character : text.length;
    source.push(text.slice(from, to));
  }
  return cStaticModifierOf(source.join("\n"));
}

function cStaticModifierOf(
  source: string,
): NonNullable<ISamchonGraphNode["modifiers"]> {
  const lexical = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/(["'])(?:\\.|(?!\1)[\s\S])*?\1/g, " ");
  return /\bstatic\b/.test(lexical) ? ["static"] : [];
}

/** True only for a Python local whose value is directly a lambda expression. */
function pythonVariableBindsLambda(
  symbol: IDocumentSymbol,
  lines: readonly string[],
): boolean {
  const line = symbol.selectionRange.end.line;
  const tail = [
    lines[line]!.slice(symbol.selectionRange.end.character),
    ...lines.slice(line + 1, Math.min(symbol.range.end.line + 1, line + 4)),
  ].join("\n");
  return /^\s*(?::[^=\n]+)?=\s*\(*\s*lambda\b/.test(tail);
}

/** Recover modifiers from the declaration prefix csharp-ls does not expose. */
function csharpModifiersOf(
  symbol: IDocumentSymbol,
  lines: readonly string[],
  kind: GraphNodeKind | undefined,
  ownerKind: GraphNodeKind | undefined,
): NonNullable<ISamchonGraphNode["modifiers"]> {
  const start = symbol.range.start;
  const end = symbol.selectionRange.start;
  if (end.line < start.line) return [];
  const source: string[] = [];
  for (let line = start.line; line <= end.line; line++) {
    const text = lines[line] ?? "";
    const to = line === end.line ? end.character : text.length;
    // csharp-ls starts some field ranges at the identifier rather than at the
    // declaration modifiers. Read from the physical line start so `readonly`
    // and explicit visibility are not lost; comments/attributes are erased by
    // the shared lexical modifier parser.
    source.push(text.slice(0, to));
  }
  return CsharpDeclarations.csharpGraphModifiersOf(
    source.join("\n"),
    kind,
    ownerKind,
  );
}

/** Recover PHP visibility and shape omitted from Intelephense symbols. */
function phpModifiersOf(
  symbol: IDocumentSymbol,
  lines: readonly string[],
  kind: GraphNodeKind | undefined,
  ownerKind: GraphNodeKind | undefined,
): NonNullable<ISamchonGraphNode["modifiers"]> {
  const start = symbol.range.start;
  const end = symbol.selectionRange.start;
  if (end.line < start.line) return [];
  const source: string[] = [];
  for (let line = start.line; line <= end.line; line++) {
    const text = lines[line] ?? "";
    const to = line === end.line ? end.character : text.length;
    // Intelephense may begin a member range at `function` or the identifier,
    // after its visibility token. Read from the physical line start; the PHP
    // lexical helper erases comments and strings before matching modifiers.
    source.push(text.slice(0, to));
  }
  return PhpDeclarations.phpGraphModifiersOf(
    source.join("\n"),
    kind,
    ownerKind,
  );
}

/** JDT.LS's synthetic identity for a Java anonymous-class body. */
function isJavaAnonymousClass(node: ISamchonGraphNode): boolean {
  return (
    node.language === "java" &&
    node.kind === "class" &&
    isJavaAnonymousClassName(node.name)
  );
}

function isJavaAnonymousClassName(name: string): boolean {
  return /^new\s+[\s\S]+\{\.\.\.\}$/.test(name.trim());
}

/**
 * Recover the Java declaration modifiers JDT.LS omits from DocumentSymbol.
 * Its range starts at the declaration (occasionally at its Javadoc) and its
 * selection starts at the declared identifier, so that exact prefix is the
 * only source slice inspected. Comments and annotations — argument strings and
 * all — are erased before matching to avoid turning metadata text into
 * visibility facts.
 */
function javaModifiersOf(
  symbol: IDocumentSymbol,
  lines: readonly string[],
): NonNullable<ISamchonGraphNode["modifiers"]> {
  const start = symbol.range.start;
  const end = symbol.selectionRange.start;
  if (end.line < start.line) return [];
  const source: string[] = [];
  for (let line = start.line; line <= end.line; line++) {
    const text = lines[line] ?? "";
    const from = line === start.line ? start.character : 0;
    const to = line === end.line ? end.character : text.length;
    source.push(text.slice(from, to));
  }
  return javaGraphModifiersOf(source.join("\n"));
}

/** Best-effort modifier recovery for the legacy flat SymbolInformation shape. */
function javaModifiersOnLine(
  line: string,
  symbolName: string,
): NonNullable<ISamchonGraphNode["modifiers"]> {
  const declaredName = symbolName.slice(0, symbolName.indexOf("(") === -1
    ? symbolName.length
    : symbolName.indexOf("("));
  const position = line.indexOf(declaredName);
  return javaGraphModifiersOf(position === -1 ? "" : line.slice(0, position));
}

function javaGraphModifiersOf(
  source: string,
): NonNullable<ISamchonGraphNode["modifiers"]> {
  // Only comments are neutralized before the eraser runs; the eraser itself
  // tracks quotes inside an annotation's argument list, so a separate string
  // pre-strip would be redundant and, by consuming every complete string first,
  // would keep the eraser's own close-quote handling from ever executing.
  const clean = eraseJavaAnnotations(
    source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/.*$/gm, " "),
  );
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

/** Replace Java annotations, including balanced argument lists, with spaces. */
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

// The top-level names a TypeScript/JavaScript source file exports, or
// undefined for a language whose export surface we have not modeled (there,
// every symbol keeps the prior exported=true default). Covers the three
// module-export forms an editor's document symbols alone cannot see: an inline
// `export` modifier, a separate `export { a, b as c }` list, and an
// `export default Name`. A cross-file re-export (`export { X } from "./x"`) is
// not resolved here — that would need the whole-program view ttsc's checker
// has — so only names a re-export's own file also declares are caught.
function exportedTopLevelNames(
  language: GraphLanguage,
  text: string,
): Set<string> | undefined {
  if (language === "rust") {
    const names = new Set<string>();
    // Only unrestricted `pub` is consumer API. `pub(crate)`, `pub(super)`,
    // and `pub(in ...)` deliberately do not match because `pub` is followed
    // by `(` rather than whitespace. Accept the qualifiers Rust permits before
    // a function declaration while keeping the declared-name capture lexical.
    const declaration =
      /^\s*pub\s+(?:(?:async|const|unsafe|extern(?:\s+"[^"]*")?)\s+)*(?:fn|struct|enum|trait|type|mod|static(?:\s+mut)?|const|union)\s+([A-Za-z_][\w]*)/gm;
    for (let match = declaration.exec(text); match !== null; match = declaration.exec(text)) {
      names.add(match[1]!);
    }
    return names;
  }
  if (language !== "typescript") return undefined;
  const names = new Set<string>();
  const inline =
    /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:declare\s+)?(?:const|let|var|function\*?|class|interface|type|enum|namespace|module)\s+([A-Za-z_$][\w$]*)/gm;
  for (let m = inline.exec(text); m !== null; m = inline.exec(text)) {
    names.add(m[1]!);
  }
  const list = /export\s+(?:type\s+)?\{([^}]*)\}/g;
  for (let m = list.exec(text); m !== null; m = list.exec(text)) {
    for (const entry of m[1]!.split(",")) {
      const local = entry.trim().split(/\s+as\s+/)[0]?.trim();
      if (local !== undefined && /^[A-Za-z_$][\w$]*$/.test(local)) {
        names.add(local);
      }
    }
  }
  const def = /export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/gm;
  for (let m = def.exec(text); m !== null; m = def.exec(text)) {
    names.add(m[1]!);
  }
  return names;
}

function convertSymbolInformation(
  language: GraphLanguage,
  file: string,
  symbol: ISymbolInformation,
  lines: readonly string[],
  rubyDeclarations?: ReadonlyMap<number, RubyDeclarations.IRubyDeclaration>,
  phpNamespaces?: PhpDeclarations.IPhpNamespaceIndex,
  csharpOwnerKind?: GraphNodeKind,
): ISamchonGraphNode {
  const rawKind = kindOf(symbol.kind) ?? "external_symbol";
  const owners =
    symbol.containerName === undefined || symbol.containerName === ""
      ? []
      : [symbol.containerName];
  const genericIdentity = symbolIdentity(language, symbol.name, owners);
  const declarationLine = lines[symbol.location.range.start.line] ?? "";
  // `ownedVariableKind` is handed `rawKind`, which is always defined, and only
  // ever returns undefined when its own `kind` argument is undefined; the
  // `?? rawKind` fallback is therefore unreachable for this caller.
  /* c8 ignore next 8 -- ownedVariableKind never returns undefined for a defined kind */
  const kind =
    ownedVariableKind(
      language,
      rawKind,
      csharpOwnerKind,
      genericIdentity.owners.at(-1),
      declarationLine,
    ) ?? rawKind;
  const phpNamespace =
    phpNamespaces === undefined
      ? undefined
      : PhpDeclarations.phpNamespaceAt(
          phpNamespaces,
          symbol.location.range.start.line,
          symbol.location.range.start.character,
        );
  const identity =
    language === "csharp"
      ? CsharpDeclarations.csharpDocumentIdentity(
          genericIdentity.name,
          genericIdentity.owners,
          kind,
          declarationLine,
        )
      : language === "php"
        ? PhpDeclarations.phpSymbolIdentity(
            genericIdentity.name,
            genericIdentity.owners,
            kind,
            phpNamespace,
          )
        : genericIdentity;
  const qualifiedName = [...identity.owners, identity.name].join(".");
  const rubyDeclaration = rubyDeclarations?.get(
    symbol.location.range.start.line,
  );
  const javaModifiers =
    language === "java"
      ? javaModifiersOnLine(
          lines[symbol.location.range.start.line] ?? "",
          identity.name,
        )
      : undefined;
  const csharpModifiers =
    language === "csharp"
      ? CsharpDeclarations.csharpGraphModifiersOf(
          declarationLine,
          kind,
          csharpOwnerKind,
        )
      : undefined;
  const cModifiers =
    language === "c"
      ? cStaticModifierOf(
          declarationLine.slice(0, declarationLine.indexOf(identity.name)),
        )
      : undefined;
  const phpOwnerKind =
    language === "php" &&
    (kind === "method" ||
      kind === "constructor" ||
      kind === "property" ||
      kind === "field")
      ? "class"
      : undefined;
  const phpModifiers =
    language === "php"
      ? PhpDeclarations.phpGraphModifiersOf(
          declarationLine.slice(0, declarationLine.indexOf(identity.name)),
          kind,
          phpOwnerKind,
        )
      : undefined;
  return {
    id: `${file}#${qualifiedName}:${kind}`,
    kind,
    language,
    name: identity.name,
    ...(identity.owners.length > 0 ? { qualifiedName } : {}),
    file,
    external: false,
    ...(language === "java" &&
    kind === "class" &&
    isJavaAnonymousClassName(identity.name)
      ? { closure: true }
      : {}),
    ...(javaModifiers !== undefined && javaModifiers.length > 0
      ? { modifiers: javaModifiers }
      : {}),
    ...(csharpModifiers !== undefined && csharpModifiers.length > 0
      ? { modifiers: csharpModifiers }
      : {}),
    ...(cModifiers !== undefined && cModifiers.length > 0
      ? { modifiers: cModifiers }
      : {}),
    ...(phpModifiers !== undefined && phpModifiers.length > 0
      ? { modifiers: phpModifiers }
      : {}),
    ...(rubyDeclaration?.modifiers !== undefined &&
    rubyDeclaration.modifiers.length > 0
      ? { modifiers: rubyDeclaration.modifiers }
      : {}),
    ...(language === "go" && identity.owners.length > 0
      ? {
          modifiers: [
            isGoExportedName(identity.name) ? "public" : "private",
          ],
        }
      : {}),
    // The flat SymbolInformation fallback carries no source text to resolve a
    // real export surface; a contained symbol is still never a module export.
    // Go needs no source parse because capitalization is the language's export
    // rule, so it keeps the same answer in both LSP symbol result shapes.
    ...((language === "ruby"
      ? rubyDeclaration?.exported === true
      : language === "csharp"
        ? CsharpDeclarations.isCSharpPublishedType(
            kind,
            csharpOwnerKind === undefined ? [] : [csharpOwnerKind],
            csharpModifiers,
          )
        : language === "php"
          ? PhpDeclarations.isPhpPublishedDeclaration(
              kind,
              phpOwnerKind === undefined ? [] : [phpOwnerKind],
            )
          : identity.owners.length === 0 &&
            (language === "java"
              ? javaModifiers?.includes("public") === true
              : language === "c"
                ? cModifiers?.includes("static") !== true
                : language !== "go" || isGoExportedName(identity.name)))
      ? { exported: true }
      : {}),
    evidence: {
      file,
      startLine: symbol.location.range.start.line + 1,
      startCol: symbol.location.range.start.character + 1,
      endLine: symbol.location.range.end.line + 1,
      endCol: symbol.location.range.end.character + 1,
    },
  };
}

/**
 * Normalize the member shape a server lost before the node id is formed.
 * Class/interface variables are declaration members, not local values. C# can
 * recover the sharper field/property distinction from the declaration line;
 * other servers that use SymbolKind.Variable for a member recover `property`.
 */
function ownedVariableKind(
  language: GraphLanguage,
  kind: GraphNodeKind | undefined,
  ownerKind: GraphNodeKind | undefined,
  ownerName: string | undefined,
  declarationLine: string,
): GraphNodeKind | undefined {
  if (
    kind !== "variable" ||
    (ownerKind !== "class" && ownerKind !== "interface")
  )
    return kind;
  if (language === "csharp") {
    const parsed = CsharpDeclarations.parseCSharpDeclaration(
      declarationLine,
      ownerName,
      ownerKind,
    );
    if (parsed?.kind === "field" || parsed?.kind === "property") {
      return parsed.kind;
    }
  }
  return "property";
}

/** Resolve the owner kind omitted by the legacy flat SymbolInformation form. */
function csharpOwnerKindsOf(
  symbols: readonly ISymbolInformation[],
): Map<ISymbolInformation, GraphNodeKind> {
  const containers = new Map<string, GraphNodeKind>();
  const simple = new Map<string, GraphNodeKind | null>();
  for (const symbol of symbols) {
    const kind = kindOf(symbol.kind);
    if (
      kind !== "namespace" &&
      kind !== "class" &&
      kind !== "interface" &&
      kind !== "enum"
    )
      continue;
    const name = csharpContainerName(symbol.name);
    const owner = csharpContainerName(symbol.containerName ?? "");
    const full = owner === "" ? name : `${owner}.${name}`;
    containers.set(full, kind);
    simple.set(name, simple.has(name) ? null : kind);
  }
  const out = new Map<ISymbolInformation, GraphNodeKind>();
  for (const symbol of symbols) {
    const owner = csharpContainerName(symbol.containerName ?? "");
    if (owner === "") continue;
    const exact = containers.get(owner);
    const fallback = simple.get(owner.slice(owner.lastIndexOf(".") + 1));
    const kind = exact ?? fallback ?? undefined;
    if (kind !== undefined) out.set(symbol, kind);
  }
  return out;
}

function csharpContainerName(name: string): string {
  return name
    .replace(/\\|::/g, ".")
    .replace(/\([^)]*\)$/, "")
    .replace(/^\.+|\.+$/g, "");
}

/** The declared part of `(*Engine).ServeHTTP` is `ServeHTTP`. */
function isGoExportedName(name: string): boolean {
  const declared = name.slice(name.lastIndexOf(".") + 1);
  return /^\p{Lu}/u.test(declared);
}

/**
 * gopls reports receiver methods as flat document symbols such as
 * `(*Engine).ServeHTTP`, beside `Engine` rather than beneath it. Recover the
 * ownership that a compiler-native symbol tree carries so exports, handles,
 * containment, and centrality all see one `Engine.ServeHTTP` member.
 */
function symbolIdentity(
  language: GraphLanguage,
  name: string,
  owners: readonly string[],
): { name: string; owners: string[] } {
  if (language !== "go" || owners.length !== 0) {
    return { name, owners: [...owners] };
  }
  const match = /^\(\*?([^)]+)\)\.([^\s.]+)$/.exec(name);
  if (match === null) return { name, owners: [] };
  const generic = match[1]!.indexOf("[");
  const receiver = generic === -1 ? match[1]! : match[1]!.slice(0, generic);
  return { name: match[2]!, owners: [receiver] };
}

function kindOf(symbolKind: number): GraphNodeKind | undefined {
  switch (symbolKind) {
    case 2:
      return "module";
    case 3:
      return "namespace";
    case 5:
      return "class";
    case 6:
      return "method";
    case 7:
      return "property";
    case 8:
      return "field";
    case 9:
      return "constructor";
    case 10:
      return "enum";
    case 11:
      return "interface";
    case 12:
      return "function";
    case 13:
    case 14:
      return "variable";
    case 23:
      return "type";
    default:
      return undefined;
  }
}

function ownerAt(nodes: readonly ISamchonGraphNode[], line: number): ISamchonGraphNode | undefined {
  return nodes
    .filter(
      (node) =>
        node.evidence !== undefined &&
        node.evidence.startLine <= line &&
        node.evidence.endLine! >= line,
    )
    .sort(
      (a, b) => {
        const start = b.evidence!.startLine - a.evidence!.startLine;
        if (start !== 0) return start;
        /* c8 ignore next */
        return a.evidence!.endLine! - b.evidence!.endLine!;
      },
    )[0];
}

// The innermost enclosing class/interface at `line`, regardless of whether a
// narrower non-container owner (a method, a property) also covers it. Used
// to find a property/field owner's *own* container, since ttsc attributes a
// non-method member's references to both.
function containerAt(
  nodes: readonly ISamchonGraphNode[],
  line: number,
): ISamchonGraphNode | undefined {
  return nodes
    .filter(
      (node) =>
        (node.kind === "class" || node.kind === "interface") &&
        node.evidence !== undefined &&
        node.evidence.startLine <= line &&
        node.evidence.endLine! >= line,
    )
    .sort((a, b) => b.evidence!.startLine - a.evidence!.startLine)[0];
}

/** The innermost callable enclosing a local symbol at `line`. */
function executableAt(
  nodes: readonly ISamchonGraphNode[],
  line: number,
  excluded: string,
): ISamchonGraphNode | undefined {
  return nodes
    .filter(
      (node) =>
        node.id !== excluded &&
        (node.kind === "function" ||
          node.kind === "method" ||
          node.kind === "constructor") &&
        node.evidence !== undefined &&
        node.evidence.startLine <= line &&
        node.evidence.endLine! >= line,
    )
    .sort(
      (a, b) => b.evidence!.startLine - a.evidence!.startLine,
    )[0];
}
