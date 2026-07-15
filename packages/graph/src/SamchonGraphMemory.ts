import {
  ISamchonGraphDiagnostic,
  ISamchonGraphDump,
  ISamchonGraphEdge,
  ISamchonGraphEvidence,
  ISamchonGraphNode,
  ISamchonGraphSpan,
} from "./structures";
import { GraphLanguage } from "./typings";
import { basename } from "./utils/path";

/**
 * The in-memory resident graph the MCP tools answer from.
 *
 * It loads one dump — the indexer-resolved fact graph — then synthesizes the
 * structural layer the dump deliberately leaves to this layer: `file` container
 * nodes and the `contains` ownership tree. Every tool call is then a lookup or a
 * traversal over the indexes built here; nothing re-indexes.
 */
export class SamchonGraphMemory {
  private readonly byId: Map<string, ISamchonGraphNode>;
  private readonly outEdges: Map<string, ISamchonGraphEdge[]>;
  private readonly inEdges: Map<string, ISamchonGraphEdge[]>;
  private readonly bySymbolIndex: Map<string, ISamchonGraphNode[]>;

  /** The absolute project root the dump was built for. */
  public readonly project: string;
  /** The source languages present in the dump. */
  public readonly languages: readonly string[];
  /** Which indexing strategy produced the graph. */
  public readonly indexer: ISamchonGraphDump["indexer"];
  /** Every node, raw plus synthesized (file containers). */
  public readonly nodes: readonly ISamchonGraphNode[];
  /** Every edge, raw plus synthesized (contains). */
  public readonly edges: readonly ISamchonGraphEdge[];
  /** Fused compiler and plugin diagnostics, when the build collected any. */
  public readonly diagnostics: readonly ISamchonGraphDiagnostic[];
  /** Non-fatal problems encountered while building the graph. */
  public readonly warnings: readonly string[];

  private constructor(
    dump: ISamchonGraphDump,
    nodes: ISamchonGraphNode[],
    edges: ISamchonGraphEdge[],
  ) {
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
    this.bySymbolIndex = new Map();

    for (const node of nodes) {
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
  }

  /** Build a model from a parsed dump, synthesizing structural relationships. */
  public static from(dump: ISamchonGraphDump): SamchonGraphMemory {
    const { nodes, edges } = synthesize(dump);
    return new SamchonGraphMemory(dump, nodes, edges);
  }

  /** The node with this id, or undefined. */
  public node(id: string): ISamchonGraphNode | undefined {
    return this.byId.get(id);
  }

  /** Edges leaving a node (the node is the `from`). */
  public outgoing(id: string): readonly ISamchonGraphEdge[] {
    return this.outEdges.get(id) ?? [];
  }

  /** Edges entering a node (the node is the `to`). */
  public incoming(id: string): readonly ISamchonGraphEdge[] {
    return this.inEdges.get(id) ?? [];
  }

  /** Every non-file node whose simple or owner-qualified symbol handle matches. */
  public symbols(handle: string): readonly ISamchonGraphNode[] {
    return this.bySymbolIndex.get(handle) ?? [];
  }

  /** Every workspace node on its module's export surface. */
  public exported(): ISamchonGraphNode[] {
    return this.nodes.filter((node) => node.exported && !node.external);
  }
}

/** Append value to the slice stored at key, creating the slice on first use. */
function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const bucket = map.get(key);
  if (bucket === undefined) map.set(key, [value]);
  else bucket.push(value);
}

/**
 * The within-file identity of a node: its owner-qualified name when it has one
 * (`Class.method`), else its simple name. Two nodes in one file never share a
 * key, so it is the handle the ownership synthesis looks owners up by.
 */
function keyOf(node: ISamchonGraphNode): string {
  return node.qualifiedName ?? node.name;
}

/** The owner key of a dotted key (`A.B.c` -> `A.B`), or "" for a top-level key. */
function ownerKey(key: string): string {
  const dot = key.lastIndexOf(".");
  return dot >= 0 ? key.slice(0, dot) : "";
}

/**
 * A wire span with its file put back: the one the indexer left out because the
 * reader has it, or the one it kept because it could not be derived (an
 * implementation in another file).
 */
function spanIn(span: ISamchonGraphSpan, file: string): ISamchonGraphEvidence {
  return { ...span, file: span.file ?? file };
}

/**
 * The source file a node id names. An id is `path#Qualified.Name:kind`, and a
 * file node's id is the path itself.
 */
function fileOfNodeId(id: string): string {
  const hash = id.indexOf("#");
  return hash === -1 ? id : id.slice(0, hash);
}

/**
 * Derive the structural layer from a dump's faithful facts: put back the file
 * the indexer left out of every span, add a `file` node per workspace source,
 * and connect the `contains` ownership tree.
 *
 * `exports` edges are not synthesized here. The indexer resolves them from the
 * project's own export syntax and follows them through its barrels (§4k), so
 * they say which module puts a symbol on the wire. Deriving them from the
 * `exported` flag instead would say only that the declaring file made it public,
 * which is the fact that cannot tell a package's front door from its legacy
 * subpath.
 */
function synthesize(dump: ISamchonGraphDump): {
  nodes: ISamchonGraphNode[];
  edges: ISamchonGraphEdge[];
} {
  // Clone nodes so the ownership synthesis does not mutate the caller's dump,
  // and put back the file the indexer left out of every span: a node's span is
  // in the node's file, an edge's span is in the file its `from` id names. The
  // indexer omits both because they are exactly reconstructible and they are
  // not small — the two copies are 17% of the document, 55 MB of VS Code's 323
  // MB, paid again in the encode, the pipe, the parse and the validation.
  // Nothing downstream of this line sees a span without its file.
  const nodes: ISamchonGraphNode[] = dump.nodes.map((node) => {
    const { evidence, implementation, ...rest } = node;
    return {
      ...rest,
      ...(evidence !== undefined
        ? { evidence: spanIn(evidence, node.file) }
        : {}),
      ...(implementation !== undefined
        ? { implementation: spanIn(implementation, node.file) }
        : {}),
    };
  });
  const edges: ISamchonGraphEdge[] = dump.edges.map((edge) => {
    const { evidence, ...rest } = edge;
    return {
      ...rest,
      ...(evidence !== undefined
        ? { evidence: spanIn(evidence, fileOfNodeId(edge.from)) }
        : {}),
    };
  });

  // Index workspace nodes by (file, within-file key) so ownership can resolve a
  // member to its declaring class/namespace.
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const byFileKey = new Map<string, ISamchonGraphNode>();
  for (const node of nodes) {
    if (!node.external) byFileKey.set(`${node.file}\0${keyOf(node)}`, node);
  }

  // One file container node per distinct workspace source file, plus every file
  // the dump saw an export surface on — a barrel declares nothing, so its only
  // trace in the dump is the `exports` edges leaving it, and it is exactly the
  // file a consumer imports the package from.
  const files = new Map<string, ISamchonGraphNode>();
  const addFileNode = (file: string, language: GraphLanguage): void => {
    if (file === "" || files.has(file)) return;
    files.set(file, {
      id: file,
      kind: "file",
      language,
      name: basename(file),
      file,
      external: false,
    });
  };
  for (const node of nodes) {
    if (node.external) continue;
    addFileNode(node.file, node.language);
  }
  for (const edge of edges) {
    if (edge.kind !== "exports") continue;
    addFileNode(edge.from, byId.get(edge.to)?.language ?? "unknown");
  }

  const edgeKeys = new Set(
    edges.map((edge) => `${edge.kind}\0${edge.from}\0${edge.to}`),
  );
  const structural: ISamchonGraphEdge[] = [];
  for (const node of nodes) {
    if (node.external || node.file === "") continue;
    const parentKey = ownerKey(keyOf(node));
    const parent =
      parentKey === ""
        ? undefined
        : byFileKey.get(`${node.file}\0${parentKey}`);
    const container = parent?.id ?? node.file;
    const key = `contains\0${container}\0${node.id}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    structural.push({
      from: container,
      to: node.id,
      kind: "contains",
    });
  }

  return {
    nodes: [...nodes, ...files.values()],
    edges: [...edges, ...structural],
  };
}
