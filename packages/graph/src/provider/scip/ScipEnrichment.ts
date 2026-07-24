import {
  ISamchonGraphEdge,
  ISamchonGraphNode,
} from "../../structures";
import { GraphEdgeKind, GraphLanguage } from "../../typings";
import { IScipIndex } from "./IScipIndex";
import { adaptScipIndex } from "./adaptScipIndex";

/**
 * A language-owned fact family that a bare SCIP artifact cannot prove.
 *
 * The common adapter publishes only facts whose meaning SCIP standardizes.
 * An indexer that can prove a stronger language fact supplies one versioned
 * enrichment instead of teaching the common lane language syntax. Enrichment
 * is additive: it receives an immutable view of common facts and can publish
 * only declared, non-common edge families between nodes the common adapter
 * already accepted. It therefore cannot replace a common fact with a stronger
 * interpretation or manufacture an unowned endpoint.
 */
export namespace ScipEnrichment {
  export interface IContract {
    /** Stable, provider-visible identity for this language contract. */
    readonly name: string;

    /** Monotonic contract revision; changing semantics requires a new version. */
    readonly version: number;

    /** Exactly the language slice this enrichment is allowed to serve. */
    readonly languages: readonly GraphLanguage[];

    /** Strict fact families this enrichment, and no bare SCIP artifact, proves. */
    readonly facts: readonly GraphEdgeKind[];

    enrich(input: IProps): IResult;
  }

  export interface IProps {
    readonly index: Readonly<IScipIndex>;
    readonly root: string;
    readonly provider: string;
    readonly languages: readonly GraphLanguage[];

    /** Immutable, already-validated facts from the common SCIP adapter. */
    readonly common: {
      readonly nodes: readonly Readonly<ISamchonGraphNode>[];
      readonly edges: readonly Readonly<ISamchonGraphEdge>[];
      readonly files: readonly string[];
    };
  }

  export interface IResult {
    /** Additional, declared language facts only. */
    readonly edges: readonly ISamchonGraphEdge[];

    /** Capability limits or producer-specific omissions worth publishing. */
    readonly warnings?: readonly string[];
  }

  /** Validate one provider's declared language enrichment before it can run. */
  export function assert(
    enrichment: IContract,
    languages: readonly GraphLanguage[],
  ): void {
    if (!/^[a-z][a-z0-9-]*$/.test(enrichment.name)) {
      throw new TypeError(
        "@samchon/graph: a SCIP enrichment name must be lowercase kebab-case",
      );
    }
    if (
      !Number.isSafeInteger(enrichment.version) ||
      enrichment.version < 1
    ) {
      throw new TypeError(
        `@samchon/graph: SCIP enrichment ${enrichment.name} must have a positive safe-integer version`,
      );
    }
    if (
      enrichment.languages.length === 0 ||
      new Set(enrichment.languages).size !== enrichment.languages.length ||
      new Set(languages).size !== languages.length ||
      !sameSet(enrichment.languages, languages)
    ) {
      throw new TypeError(
        `@samchon/graph: SCIP enrichment ${enrichment.name} must declare exactly its provider languages`,
      );
    }
    if (
      typeof enrichment.enrich !== "function" ||
      enrichment.facts.length === 0 ||
      new Set(enrichment.facts).size !== enrichment.facts.length ||
      enrichment.facts.some((fact) => !GRAPH_EDGE_KIND_SET.has(fact))
    ) {
      throw new TypeError(
        `@samchon/graph: SCIP enrichment ${enrichment.name} must have a callable implementation and declare each valid added fact family exactly once`,
      );
    }
    for (const fact of enrichment.facts) {
      if (adaptScipIndex.EDGE_KINDS.includes(fact)) {
        throw new TypeError(
          `@samchon/graph: SCIP enrichment ${enrichment.name} cannot overwrite the common ${fact} fact family`,
        );
      }
    }
  }

  /**
   * Capture one immutable contract before a mutable caller can change its
   * registered facts, languages, version, or implementation behind a session.
   */
  export function normalize(
    enrichment: IContract,
    languages: readonly GraphLanguage[],
  ): IContract {
    assert(enrichment, languages);
    const enrich = enrichment.enrich.bind(enrichment);
    return Object.freeze({
      name: enrichment.name,
      version: enrichment.version,
      languages: Object.freeze([...enrichment.languages]),
      facts: Object.freeze([...enrichment.facts]),
      enrich: (input: IProps) => enrich(input),
    });
  }

  /** One provenance capability that names the enrichment contract exactly. */
  export function capability(
    enrichment: IContract,
  ): string {
    return `scip-enrichment:${enrichment.name}@${String(enrichment.version)}`;
  }

  /**
   * Run and fence one language enrichment around an already-adapted SCIP slice.
   *
   * A bad enrichment rejects the candidate before BatchGraphSession can replace
   * its previous generation. Returning only additional edges makes a common fact
   * immutable by construction; duplicate or conflicting observations fail rather
   * than silently choosing which producer statement should win.
   */
  export function apply(props: IApplyProps): IApplyResult {
    const enrichment = props.enrichment;
    if (enrichment === undefined) {
      return { edges: props.common.edges, warnings: [] };
    }
    const nodes = new Set<string>();
    for (const node of props.common.nodes) {
      if (nodes.has(node.id)) {
        throw new Error(
          `@samchon/graph: the common SCIP slice duplicated node ${node.id}`,
        );
      }
      nodes.add(node.id);
    }
    const files = new Set<string>();
    for (const file of props.common.files) {
      if (files.has(file)) {
        throw new Error(
          `@samchon/graph: the common SCIP slice duplicated file ${file}`,
        );
      }
      files.add(file);
    }
    const commonEdges = new Set<string>();
    for (const edge of props.common.edges) {
      if (!adaptScipIndex.EDGE_KINDS.includes(edge.kind)) {
        throw new Error(
          `@samchon/graph: the common SCIP slice published non-common ${edge.kind} facts`,
        );
      }
      if (
        (!nodes.has(edge.from) && !files.has(edge.from)) ||
        (!nodes.has(edge.to) && !files.has(edge.to))
      ) {
        throw new Error(
          `@samchon/graph: the common SCIP slice published an absent endpoint: ${edge.from} -> ${edge.to}`,
        );
      }
      const key = edgeKey(edge);
      if (commonEdges.has(key)) {
        throw new Error(
          `@samchon/graph: the common SCIP slice duplicated an edge: ${edge.from} -> ${edge.to} (${edge.kind})`,
        );
      }
      commonEdges.add(key);
    }
    assert(enrichment, props.languages);
    // These are session-owned, already-validated trees. Freezing them in place
    // gives the language contract a genuinely immutable view without retaining
    // one Proxy (and one cache entry) for every object it reads from a large
    // index. The parser and common adapter produce bounded-depth acyclic trees,
    // so this walk has constant auxiliary space rather than a second graph.
    const index = freezeTree(props.index);
    const languages = freezeTree([...props.languages]);
    const common = freezeTree({
      nodes: props.common.nodes,
      edges: props.common.edges,
      files: props.common.files,
    });
    const result = enrichment.enrich({
      index,
      root: props.root,
      provider: props.provider,
      languages,
      common,
    });
    if (
      result === null ||
      typeof result !== "object" ||
      !Array.isArray(result.edges)
    ) {
      throw new TypeError(
        `@samchon/graph: SCIP enrichment ${enrichment.name} returned no edge array`,
      );
    }
    if (result.warnings !== undefined && !Array.isArray(result.warnings)) {
      throw new TypeError(
        `@samchon/graph: SCIP enrichment ${enrichment.name} returned non-array warnings`,
      );
    }

    const additions = new Map<string, ISamchonGraphEdge>();
    for (const edge of result.edges) {
      if (edge === null || typeof edge !== "object") {
        throw new TypeError(
          `@samchon/graph: SCIP enrichment ${enrichment.name} returned a non-object edge`,
        );
      }
      if (!enrichment.facts.includes(edge.kind)) {
        throw new Error(
          `@samchon/graph: SCIP enrichment ${enrichment.name} published undeclared ${edge.kind} facts`,
        );
      }
      if (
        (!nodes.has(edge.from) && !files.has(edge.from)) ||
        (!nodes.has(edge.to) && !files.has(edge.to))
      ) {
        throw new Error(
          `@samchon/graph: SCIP enrichment ${enrichment.name} published an endpoint absent from the common slice: ${edge.from} -> ${edge.to}`,
        );
      }
      const key = edgeKey(edge);
      if (additions.has(key)) {
        throw new Error(
          `@samchon/graph: SCIP enrichment ${enrichment.name} duplicated an edge: ${edge.from} -> ${edge.to} (${edge.kind})`,
        );
      }
      additions.set(key, copyEdge(edge));
    }
    const warnings = (result.warnings ?? []).map((warning) => {
      if (typeof warning !== "string" || warning.trim() === "") {
        throw new TypeError(
          `@samchon/graph: SCIP enrichment ${enrichment.name} returned an empty or non-string warning`,
        );
      }
      return warning;
    });
    return {
      edges: [
        ...props.common.edges,
        ...[...additions.values()].sort((left, right) =>
          compareOrdinal(edgeKey(left), edgeKey(right)),
        ),
      ],
      warnings: [...new Set(warnings)].sort(compareOrdinal),
    };
  }

  export interface IApplyProps {
    readonly enrichment?: IContract;
    readonly index: IScipIndex;
    readonly root: string;
    readonly provider: string;
    readonly languages: readonly GraphLanguage[];
    readonly common: adaptScipIndex.IResult;
  }

  export interface IApplyResult {
    readonly edges: ISamchonGraphEdge[];
    readonly warnings: readonly string[];
  }
}

function sameSet<T>(left: readonly T[], right: readonly T[]): boolean {
  return (
    left.length === right.length &&
    left.every((value) => right.includes(value))
  );
}

function edgeKey(edge: Pick<ISamchonGraphEdge, "kind" | "from" | "to">): string {
  return `${edge.kind}\0${edge.from}\0${edge.to}`;
}

function copyEdge(edge: ISamchonGraphEdge): ISamchonGraphEdge {
  return structuredClone(edge);
}

function freezeTree<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    Object.freeze(value);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined) continue;
      if (!("value" in descriptor)) {
        throw new TypeError(
          "@samchon/graph: a SCIP enrichment input cannot contain accessors",
        );
      }
      freezeTree(descriptor.value);
    }
    return value;
  }
  const keys = Object.keys(value);
  Object.freeze(value);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor)) {
      throw new TypeError(
        "@samchon/graph: a SCIP enrichment input cannot contain accessors",
      );
    }
    freezeTree(descriptor.value);
  }
  return value;
}

function compareOrdinal(left: string, right: string): number {
  /* c8 ignore next 2 -- distinct sorted keys cannot compare equal. */
  return left < right ? -1 : left > right ? 1 : 0;
}

const GRAPH_EDGE_KIND_SET = new Set<GraphEdgeKind>([
  "contains",
  "exports",
  "imports",
  "calls",
  "accesses",
  "instantiates",
  "type_ref",
  "extends",
  "implements",
  "overrides",
  "dispatches",
  "decorates",
  "renders",
  "tests",
  "references",
]);
