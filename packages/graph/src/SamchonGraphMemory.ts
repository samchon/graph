import {
  ISamchonGraphDiagnostic,
  ISamchonGraphDump,
  ISamchonGraphEdge,
  ISamchonGraphNode,
} from "./structures";
import { GraphEdgeKind } from "./typings";
import { basename } from "./utils/path";

export class SamchonGraphMemory {
  private readonly byId: Map<string, ISamchonGraphNode>;
  private readonly outEdges: Map<string, ISamchonGraphEdge[]>;
  private readonly inEdges: Map<string, ISamchonGraphEdge[]>;
  private readonly byNameIndex: Map<string, ISamchonGraphNode[]>;
  private readonly bySymbolIndex: Map<string, ISamchonGraphNode[]>;
  private readonly diagnosticsByFile: Map<string, ISamchonGraphDiagnostic[]>;

  public readonly project: string;
  public readonly languages: readonly string[];
  public readonly indexer: ISamchonGraphDump["indexer"];
  public readonly nodes: readonly ISamchonGraphNode[];
  public readonly edges: readonly ISamchonGraphEdge[];
  public readonly diagnostics: readonly ISamchonGraphDiagnostic[];
  public readonly warnings: readonly string[];

  private constructor(dump: ISamchonGraphDump, nodes: ISamchonGraphNode[], edges: ISamchonGraphEdge[]) {
    this.project = dump.project;
    this.languages = dump.languages;
    this.indexer = dump.indexer;
    this.nodes = nodes;
    this.edges = edges;
    this.diagnostics = dump.diagnostics ?? [];
    this.warnings = dump.warnings ?? [];

    this.byId = new Map(nodes.map((node) => [node.id, node]));
    this.outEdges = new Map();
    this.inEdges = new Map();
    this.byNameIndex = new Map();
    this.bySymbolIndex = new Map();
    this.diagnosticsByFile = new Map();

    for (const node of nodes) {
      push(this.byNameIndex, node.name, node);
      if (node.kind !== "file") {
        push(this.bySymbolIndex, node.name, node);
        if (node.qualifiedName !== undefined) {
          push(this.bySymbolIndex, node.qualifiedName, node);
        }
      }
    }
    for (const edge of edges) {
      push(this.outEdges, edge.from, edge);
      push(this.inEdges, edge.to, edge);
    }
    for (const diagnostic of this.diagnostics) {
      push(this.diagnosticsByFile, diagnostic.file, diagnostic);
    }
  }

  public static from(dump: ISamchonGraphDump): SamchonGraphMemory {
    const { nodes, edges } = synthesize(dump.nodes, dump.edges);
    return new SamchonGraphMemory(dump, nodes, edges);
  }

  public node(id: string): ISamchonGraphNode | undefined {
    return this.byId.get(id);
  }

  public outgoing(id: string): readonly ISamchonGraphEdge[] {
    return this.outEdges.get(id) ?? [];
  }

  public incoming(id: string): readonly ISamchonGraphEdge[] {
    return this.inEdges.get(id) ?? [];
  }

  public named(name: string): readonly ISamchonGraphNode[] {
    return this.byNameIndex.get(name) ?? [];
  }

  public symbols(handle: string): readonly ISamchonGraphNode[] {
    return this.bySymbolIndex.get(handle) ?? [];
  }

  public exported(): ISamchonGraphNode[] {
    return this.nodes.filter((node) => node.exported && !node.external);
  }

  public diagnosticsFor(file: string): readonly ISamchonGraphDiagnostic[] {
    return this.diagnosticsByFile.get(file) ?? [];
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const bucket = map.get(key);
  if (bucket === undefined) map.set(key, [value]);
  else bucket.push(value);
}

function keyOf(node: ISamchonGraphNode): string {
  return node.qualifiedName ?? node.name;
}

function ownerKey(key: string): string {
  const dot = key.lastIndexOf(".");
  return dot >= 0 ? key.slice(0, dot) : "";
}

function synthesize(
  rawNodes: readonly ISamchonGraphNode[],
  rawEdges: readonly ISamchonGraphEdge[],
): { nodes: ISamchonGraphNode[]; edges: ISamchonGraphEdge[] } {
  const nodes = rawNodes.map((node) => ({ ...node }));
  const edges = rawEdges.map((edge) => ({ ...edge }));
  const byFileKey = new Map<string, ISamchonGraphNode>();
  const files = new Map<string, ISamchonGraphNode>();

  for (const node of nodes) {
    if (!node.external) byFileKey.set(`${node.file}\0${keyOf(node)}`, node);
    if (!node.external && node.file !== "" && !files.has(node.file)) {
      files.set(node.file, {
        id: node.file,
        kind: "file",
        language: node.language,
        name: basename(node.file),
        file: node.file,
        external: false,
      });
    }
  }

  const edgeKeys = new Set(
    edges.map((edge) => `${edge.kind}\0${edge.from}\0${edge.to}`),
  );
  const addEdge = (edge: ISamchonGraphEdge): void => {
    const key = `${edge.kind}\0${edge.from}\0${edge.to}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push(edge);
  };

  for (const node of nodes) {
    if (node.external || node.file === "") continue;
    const parentKey = ownerKey(keyOf(node));
    const parent =
      parentKey === ""
        ? undefined
        : byFileKey.get(`${node.file}\0${parentKey}`);
    addEdge({
      from: parent?.id ?? node.file,
      to: node.id,
      kind: "contains",
    });
    if (node.exported) {
      addEdge({
        from: node.file,
        to: node.id,
        kind: "exports" satisfies GraphEdgeKind,
      });
    }
  }

  return {
    nodes: [...nodes, ...files.values()],
    edges,
  };
}
