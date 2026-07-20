import path from "node:path";

import {
  ISamchonGraphDiagnostic,
  ISamchonGraphEdge,
  ISamchonGraphEvidence,
  ISamchonGraphNode,
} from "../../structures";
import { GraphEdgeKind, GraphLanguage } from "../../typings";
import { IGraphSemanticIdentity, semanticGraphNodeId } from "../semanticIdentity";
import { IScipIndex } from "./IScipIndex";
import { IScipSymbol, scipNodeKind, scipSymbol } from "./scipSymbol";

/**
 * The edge families a bare SCIP index can prove.
 *
 * Short on purpose. SCIP records where a symbol is defined, referenced, read,
 * and written, and which symbols it implements or is typed by. It does not
 * universally distinguish an invocation from a function value, a construction
 * from a type reference, or say what an annotation means — those are different
 * facts in different languages, and the schema has no common field for them.
 *
 * So `calls`, `instantiates`, `imports`, `overrides`, `decorates`, and `tests`
 * are absent here and stay absent unless a language enrichment proves them.
 * The alternative — reading the source at the occurrence and looking for a `(`
 * — is not a weaker version of proving a call; it is a different thing wearing
 * its name, and it is wrong on every function value, every macro, and every
 * language whose call syntax is not juxtaposition with parentheses.
 */
export const SCIP_EDGE_KINDS: readonly GraphEdgeKind[] = [
  "contains",
  "references",
  "accesses",
  "implements",
  "type_ref",
];

export interface IScipAdaptation {
  nodes: ISamchonGraphNode[];
  edges: ISamchonGraphEdge[];
  diagnostics: ISamchonGraphDiagnostic[];
  warnings: string[];

  /** Every document path the index attributed facts to, project-relative. */
  files: string[];
}

export interface IAdaptScipIndexProps {
  index: IScipIndex;
  root: string;

  /** Registry name, used only in warnings so a reader knows who to blame. */
  provider: string;

  /** The languages this session owns; a document outside them is a defect. */
  languages: readonly GraphLanguage[];

  /** Which file a document path belongs to, in the product's own vocabulary. */
  languageOf: (file: string) => GraphLanguage;
}

/**
 * Map one validated SCIP index onto a strict graph slice.
 *
 * Everything published here is something the index stated. A symbol whose kind
 * this graph does not model, a symbol string this parser cannot read, and an
 * occurrence whose enclosing definition is unknown are each dropped with a
 * warning rather than approximated, because a graph that is quietly wrong is
 * worse to reason about than one that is visibly incomplete.
 */
export function adaptScipIndex(
  props: IAdaptScipIndexProps,
): IScipAdaptation {
  const owned = new Set(props.languages);
  const nodes = new Map<string, ISamchonGraphNode>();
  const edges: ISamchonGraphEdge[] = [];
  const diagnostics: ISamchonGraphDiagnostic[] = [];
  const warnings: string[] = [];
  const files: string[] = [];

  // Every definition in the index, so a reference in one document can resolve
  // to a declaration in another. Built before any edge is emitted: an endpoint
  // that does not exist yet is indistinguishable from one that never will.
  const definitions = new Map<string, IDefinition>();
  for (const document of props.index.documents) {
    const file = normalizeFile(document.relativePath);
    const language = props.languageOf(file);
    if (!owned.has(language)) {
      warnings.push(
        `${props.provider}: ignoring ${file}, whose ${language} facts this provider does not own`,
      );
      continue;
    }
    files.push(file);
    for (const symbol of document.symbols ?? []) {
      const parsed = scipSymbol(symbol.symbol);
      if (parsed === undefined) {
        warnings.push(
          `${props.provider}: ${file} declares a symbol this index cannot name: ${symbol.symbol}`,
        );
        continue;
      }
      const kind = scipNodeKind(symbol.kind, parsed.descriptor);
      if (kind === undefined) continue;
      const displayName = symbol.displayName ?? parsed.displayName;
      if (displayName === "") continue;
      const id = semanticGraphNodeId(
        identityOf(parsed, language, kind, file),
        displayName,
      );
      const definition = definitions.get(parsed.key);
      if (definition !== undefined) {
        warnings.push(
          `${props.provider}: ${parsed.key} is defined in both ${definition.file} and ${file}; keeping the first`,
        );
        continue;
      }
      const node: ISamchonGraphNode = {
        id,
        kind,
        language,
        name: displayName,
        file,
        external: false,
      };
      nodes.set(id, node);
      definitions.set(parsed.key, {
        id,
        file,
        node,
        enclosingSymbol: symbol.enclosingSymbol,
        relationships: symbol.relationships ?? [],
      });
    }
  }

  // External symbols are dependency-boundary leaves: named endpoints the
  // workspace references but does not declare. They exist so a reference edge
  // has somewhere to land instead of dangling.
  for (const symbol of props.index.externalSymbols ?? []) {
    const parsed = scipSymbol(symbol.symbol);
    if (parsed === undefined || definitions.has(parsed.key)) continue;
    const displayName = symbol.displayName ?? parsed.displayName;
    if (displayName === "") continue;
    const language = props.languages[0]!;
    const id = semanticGraphNodeId(
      identityOf(parsed, language, "external_symbol", ""),
      displayName,
    );
    if (nodes.has(id)) continue;
    const node: ISamchonGraphNode = {
      id,
      kind: "external_symbol",
      language,
      name: displayName,
      file: "",
      external: true,
    };
    nodes.set(id, node);
    definitions.set(parsed.key, {
      id,
      file: "",
      node,
      relationships: [],
    });
  }

  for (const document of props.index.documents) {
    const file = normalizeFile(document.relativePath);
    if (!files.includes(file)) continue;
    const occurrences = document.occurrences ?? [];

    // A definition occurrence carries the span the declaration occupies, and
    // its `enclosingRange` bounds the whole declaration body. Both are
    // attached before references are attributed, because attribution asks
    // which enclosing range contains an occurrence.
    const scopes: IScope[] = [];
    for (const occurrence of occurrences) {
      if (!hasRole(occurrence, IScipIndex.SymbolRole.Definition)) continue;
      const parsed = scipSymbol(occurrence.symbol);
      const definition =
        parsed === undefined ? undefined : definitions.get(parsed.key);
      if (definition === undefined) continue;
      definition.node.evidence = spanOf(file, occurrence.range);
      if (occurrence.enclosingRange !== undefined) {
        scopes.push({
          id: definition.id,
          range: occurrence.enclosingRange,
        });
      }
    }
    // Innermost first: a method's body is inside its class's, and a reference
    // inside the method belongs to the method.
    scopes.sort((left, right) => rangeSize(left.range) - rangeSize(right.range));

    for (const occurrence of occurrences) {
      if (hasRole(occurrence, IScipIndex.SymbolRole.Definition)) continue;
      const parsed = scipSymbol(occurrence.symbol);
      if (parsed === undefined) continue;
      const target = definitions.get(parsed.key);
      if (target === undefined) continue;
      const owner = scopes.find((scope) => contains(scope.range, occurrence.range));
      if (owner === undefined) continue;
      if (owner.id === target.id) continue;
      // Read and write roles are the one access distinction SCIP states
      // universally, so they map; everything else is a reference and says only
      // that the name appeared, which is exactly what the index proved.
      const kind: GraphEdgeKind =
        hasRole(occurrence, IScipIndex.SymbolRole.ReadAccess) ||
        hasRole(occurrence, IScipIndex.SymbolRole.WriteAccess)
          ? "accesses"
          : "references";
      edges.push({
        kind,
        from: owner.id,
        to: target.id,
        evidence: spanOf(file, occurrence.range),
      });
    }

    for (const diagnostic of document.diagnostics ?? []) {
      diagnostics.push({
        file,
        line: 1,
        column: 1,
        code: diagnostic.code ?? diagnostic.source ?? "unknown",
        message: diagnostic.message,
        ...severityOf(diagnostic.severity),
      });
    }
  }

  // Containment and typed relationships come last, once every endpoint exists.
  for (const definition of definitions.values()) {
    if (definition.enclosingSymbol !== undefined) {
      const parsed = scipSymbol(definition.enclosingSymbol);
      const owner =
        parsed === undefined ? undefined : definitions.get(parsed.key);
      if (owner !== undefined && owner.id !== definition.id) {
        edges.push({ kind: "contains", from: owner.id, to: definition.id });
      }
    }
    for (const relationship of definition.relationships) {
      const parsed = scipSymbol(relationship.symbol);
      const target =
        parsed === undefined ? undefined : definitions.get(parsed.key);
      if (target === undefined || target.id === definition.id) continue;
      // Each flag is its own claim; a relationship can be both an
      // implementation and a type definition, and checking them as if they
      // were alternatives drops whichever was tested second.
      if (relationship.isImplementation === true) {
        edges.push({
          kind: "implements",
          from: definition.id,
          to: target.id,
        });
      }
      if (relationship.isTypeDefinition === true) {
        edges.push({ kind: "type_ref", from: definition.id, to: target.id });
      }
    }
  }

  return {
    nodes: [...nodes.values()],
    edges,
    diagnostics,
    warnings,
    files,
  };
}

interface IDefinition {
  id: string;
  file: string;
  node: ISamchonGraphNode;
  enclosingSymbol?: string;
  relationships: readonly IScipIndex.IRelationship[];
}

interface IScope {
  id: string;
  range: number[];
}

/**
 * The identity a SCIP symbol contributes to its node id.
 *
 * A global symbol is persistent: the indexer derived it from the declaration's
 * package, path, and descriptors, so it survives edits elsewhere in the file. A
 * `local N` symbol is not, and is scoped to its document and generation, so an
 * unrelated edit above it renames nothing.
 */
function identityOf(
  symbol: IScipSymbol,
  language: GraphLanguage,
  role: ISamchonGraphNode["kind"],
  file: string,
): IGraphSemanticIdentity {
  return {
    version: 2,
    language,
    symbol: symbol.key,
    role,
    native: { key: symbol.key, stability: "semantic" },
    stability: symbol.stability,
    ...(symbol.stability === "generation"
      ? { scope: { document: file }, generation: file }
      : {}),
  };
}

function spanOf(file: string, range: number[]): ISamchonGraphEvidence {
  const [startLine, startCharacter] = range as [number, number, ...number[]];
  const endLine = range.length === 3 ? startLine : range[2]!;
  const endCharacter = range.length === 3 ? range[2]! : range[3]!;
  return {
    file,
    startLine: startLine + 1,
    startCol: startCharacter + 1,
    endLine: endLine + 1,
    endCol: endCharacter + 1,
  };
}

function hasRole(
  occurrence: IScipIndex.IOccurrence,
  role: IScipIndex.SymbolRole,
): boolean {
  return ((occurrence.symbolRoles ?? 0) & role) !== 0;
}

function contains(outer: number[], inner: number[]): boolean {
  const outerStart = position(outer, "start");
  const outerEnd = position(outer, "end");
  const innerStart = position(inner, "start");
  const innerEnd = position(inner, "end");
  return (
    compare(outerStart, innerStart) <= 0 && compare(outerEnd, innerEnd) >= 0
  );
}

function rangeSize(range: number[]): number {
  const start = position(range, "start");
  const end = position(range, "end");
  return (end[0] - start[0]) * 1_000_000 + (end[1] - start[1]);
}

function position(range: number[], edge: "start" | "end"): [number, number] {
  if (edge === "start") return [range[0]!, range[1]!];
  return range.length === 3
    ? [range[0]!, range[2]!]
    : [range[2]!, range[3]!];
}

function compare(left: [number, number], right: [number, number]): number {
  if (left[0] !== right[0]) return left[0] - right[0];
  return left[1] - right[1];
}

function severityOf(
  severity: string | undefined,
): { severity?: ISamchonGraphDiagnostic["severity"] } {
  switch (severity) {
    case "Error":
      return { severity: "error" };
    case "Warning":
      return { severity: "warning" };
    case "Information":
      return { severity: "info" };
    case "Hint":
      return { severity: "hint" };
    // `Unspecified`, an absent field, and a severity name this client has not
    // heard of are all the same fact: the indexer did not say. The diagnostic
    // is kept without one rather than defaulted to `error`, which would invent
    // a severity the producer never claimed.
    case undefined:
    default:
      return {};
  }
}

/** Graph file identities are forward-slashed and project-relative. */
function normalizeFile(relativePath: string): string {
  return relativePath.split(path.win32.sep).join("/");
}
