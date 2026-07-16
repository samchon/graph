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
 * nodes and the `contains` ownership tree, plus member implementation edges and
 * class-member property refinement. Every tool call is then a lookup or a
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
  /** Every edge, raw plus synthesized (contains and member relations). */
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
 * Derive the structural layer from a dump's faithful facts: refine class-member
 * variables to properties, put back the file the indexer left out of every
 * span, add a `file` node per workspace source, and connect the `contains`
 * ownership tree and member implementation relations.
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

  // Index workspace declarations by (file, within-file key) so ownership can
  // resolve a member to its declaring class/namespace. A strict provider may
  // already carry canonical file nodes for compiler modules; those are
  // containers, never symbol owners.
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const byFileKey = new Map<string, ISamchonGraphNode>();
  for (const node of nodes) {
    if (!node.external && node.kind !== "file") {
      byFileKey.set(`${node.file}\0${keyOf(node)}`, node);
    }
  }
  const owner = (node: ISamchonGraphNode): ISamchonGraphNode | undefined => {
    const parentKey = ownerKey(keyOf(node));
    return parentKey === ""
      ? undefined
      : byFileKey.get(`${node.file}\0${parentKey}`);
  };

  // Refine: a `variable` whose owner is a class or interface is a property.
  // This deliberately changes only the cloned resident node. The raw ttsc id
  // stays position-invariant and the caller's wire dump remains untouched.
  for (const node of nodes) {
    if (node.kind !== "variable" || node.external) continue;
    const parent = owner(node);
    if (parent?.kind === "class" || parent?.kind === "interface") {
      node.kind = "property";
    }
  }

  // One file container node per distinct workspace source file, plus every bare
  // file id an edge leaves from. A module-scope edge is already folded onto its
  // file id by the indexer, and that may be the file's only trace in the dump: a
  // declaration-free bootstrap calls into the program, an import-only file names
  // only a dependency, and a barrel only exports. Keeping the folded endpoint
  // here means every such edge remains traversable without inventing a symbol.
  const files = new Map<string, ISamchonGraphNode>();
  const addFileNode = (file: string, language: GraphLanguage): void => {
    if (file === "" || byId.has(file) || files.has(file)) return;
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
    if (node.external || node.kind === "file") continue;
    addFileNode(node.file, node.language);
  }
  for (const edge of edges) {
    if (byId.has(edge.from) || fileOfNodeId(edge.from) !== edge.from) continue;
    addFileNode(edge.from, byId.get(edge.to)?.language ?? "unknown");
  }

  const edgeKeys = new Set(
    edges.map((edge) => `${edge.kind}\0${edge.from}\0${edge.to}`),
  );
  const structural: ISamchonGraphEdge[] = [];
  const membersByOwner = new Map<string, ISamchonGraphNode[]>();
  for (const node of nodes) {
    if (node.external || node.file === "" || node.kind === "file") continue;
    const parent = owner(node);
    if (parent !== undefined) push(membersByOwner, parent.id, node);
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

  const synthesized = [...edges, ...structural];
  for (const edge of edges) {
    const kind: ISamchonGraphEdge["kind"] | undefined =
      edge.kind === "implements"
        ? "implements"
        : edge.kind === "extends"
          ? "overrides"
          : undefined;
    if (kind === undefined) continue;
    const derived = byId.get(edge.from);
    const base = byId.get(edge.to);
    if (derived === undefined || base === undefined) continue;
    const derivedMembers = membersByOwner.get(derived.id) ?? [];
    const baseMembers = membersByOwner.get(base.id) ?? [];
    for (const baseMember of baseMembers) {
      const derivedMember = derivedMembers.find(
        (member) =>
          member.name === baseMember.name &&
          IMPLEMENTATION_MEMBER_KINDS.has(member.kind) &&
          IMPLEMENTATION_MEMBER_KINDS.has(baseMember.kind),
      );
      if (derivedMember === undefined) continue;
      const key = `${kind}\0${derivedMember.id}\0${baseMember.id}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      synthesized.push({
        from: derivedMember.id,
        to: baseMember.id,
        kind,
        evidence: derivedMember.implementation ?? derivedMember.evidence,
      });
    }
  }

  return {
    nodes: [...nodes, ...files.values()],
    edges: synthesized,
  };
}

// Canonical ttsc emits methods and refines class-owned variables to properties.
// Other supported language servers may already distinguish a field, which has
// the same member-satisfaction semantics. Constructors are intentionally absent:
// declaring a subclass constructor does not override its base constructor.
const IMPLEMENTATION_MEMBER_KINDS = new Set(["method", "property", "field"]);
