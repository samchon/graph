import {
  type GraphEdgeKind,
  type GraphLanguage,
  type GraphProviderAuthority,
  type IBulkGraphSession,
  type IGraphProvider,
  type ISamchonGraphDiagnostic,
  type ISamchonGraphEdge,
  type ISamchonGraphNode,
} from "@samchon/graph";

/**
 * Deterministic strict providers, sessions, and snapshots.
 *
 * Every bulk-provider test used to build its own snapshot literal. Each copy
 * then had to be edited whenever the envelope grew a field, and each copy could
 * disagree with the contract in its own way — a fake that publishes an edge
 * family its provider never claimed is not a stricter test, it is a test of
 * behaviour no real provider can produce. One factory keeps the fakes honest by
 * construction, and gives the conformance harness a provider it can make
 * deliberately wrong, one property at a time.
 */
export namespace ProviderFixtures {
  export const DEFAULT_FACTS: readonly GraphEdgeKind[] = [
    "exports",
    "calls",
    "references",
  ];

  export interface ISnapshotProps {
    languages?: GraphLanguage[];
    nodes?: ISamchonGraphNode[];
    edges?: ISamchonGraphEdge[];
    diagnostics?: ISamchonGraphDiagnostic[];
    sources?: Map<string, IBulkGraphSession.ISourceDigest>;
    warnings?: string[];
    provider?: string;
    authority?: GraphProviderAuthority;
    facts?: readonly GraphEdgeKind[];
    universe?: string;
    capabilities?: string[];
  }

  /** One valid snapshot, with every envelope field the contract requires. */
  export function snapshot(
    props: ISnapshotProps = {},
  ): IBulkGraphSession.ISnapshot {
    const languages = props.languages ?? ["typescript"];
    return {
      languages,
      nodes: props.nodes ?? [],
      edges: props.edges ?? [],
      diagnostics: props.diagnostics ?? [],
      sources: props.sources ?? new Map(),
      provenance: {
        provider: props.provider ?? "fake",
        authority: props.authority ?? "compiler",
        facts: [...(props.facts ?? DEFAULT_FACTS)],
        schemaVersion: 5,
        tool: "fake-provider",
        toolVersion: "1.0.0",
        compilerVersion: "1.0.0",
        protocolVersion: 1,
        universe: props.universe ?? "universe-1",
        capabilities: props.capabilities ?? [],
      },
      warnings: props.warnings ?? [],
    };
  }

  export interface ISessionProps {
    root: string;
    languages?: GraphLanguage[];

    /**
     * One snapshot per `refresh`, in order.
     *
     * The last entry repeats once the list is exhausted, so a test that cares
     * only about the first two generations does not have to describe every
     * later poll a resident source happens to make.
     */
    snapshots?: IBulkGraphSession.ISnapshot[];

    modes?: IBulkGraphSession.Mode[];
    onRefresh?: () => void | Promise<void>;
    onClose?: () => void | Promise<void>;
  }

  /** A resident bulk session that replays a scripted sequence of snapshots. */
  export function session(props: ISessionProps): IBulkGraphSession {
    const languages = props.languages ?? ["typescript"];
    const scripted = props.snapshots ?? [snapshot({ languages })];
    let generation = 0;
    let current: IBulkGraphSession.ISnapshot | undefined;
    return {
      kind: "bulk",
      languages,
      root: props.root,
      get generation() {
        return generation;
      },
      get current() {
        return current;
      },
      refresh: async () => {
        await props.onRefresh?.();
        const index = Math.min(generation, scripted.length - 1);
        const next = scripted[index]!;
        const changed = next !== current;
        if (changed) generation += 1;
        current = next;
        return {
          changed,
          generation,
          mode:
            props.modes?.[index] ?? (generation === 1 ? "initial" : "unchanged"),
          snapshot: next,
        };
      },
      close: async () => {
        await props.onClose?.();
      },
    };
  }

  export interface IProviderProps {
    name?: string;
    languages?: GraphLanguage[];
    authority?: GraphProviderAuthority;
    facts?: readonly GraphEdgeKind[];
    buildInputs?: readonly string[];
    refuse?: IGraphProvider["refuse"];
    resolve?: IGraphProvider["resolve"];
    prepare?: IGraphProvider["prepare"];
    open?: IGraphProvider["open"];
  }

  /** A registry entry that resolves without touching the filesystem. */
  export function provider(props: IProviderProps = {}): IGraphProvider {
    const name = props.name ?? "fake";
    const languages = props.languages ?? ["typescript"];
    return {
      name,
      languages,
      authority: props.authority ?? "compiler",
      facts: props.facts ?? DEFAULT_FACTS,
      ...(props.buildInputs === undefined
        ? {}
        : { buildInputs: props.buildInputs }),
      refuse: props.refuse ?? (() => undefined),
      resolve: props.resolve ?? (() => ({ command: "fake", args: [] })),
      ...(props.prepare === undefined ? {} : { prepare: props.prepare }),
      open:
        props.open ??
        ((open) =>
          session({
            root: open.root,
            languages: [...open.languages],
            snapshots: [
              snapshot({
                languages: [...open.languages],
                provider: name,
                authority: props.authority ?? "compiler",
                facts: props.facts ?? DEFAULT_FACTS,
              }),
            ],
          })),
    };
  }
}
