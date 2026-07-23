// Reduce a raw `samchon-graph dump` to the payload the bundled 3D viewer renders.
// This mirrors website/src/components/graph/graphReduce.ts (the same pure
// transform); keep the two in sync. The CLI reduces in Node before serving, so
// the browser viewer only ever renders a ready `{ nodes, links }`.

import { fileOfNodeId } from "./utils/fileOfNodeId";

export interface RawNode {
  id: string;
  name: string;
  kind: string;
  file: string;
  external?: boolean;
  ignored?: boolean;
}

export interface RawEdge {
  from: string;
  to: string;
  kind: string;
}

export interface RawDump {
  project?: string;
  nodes: RawNode[];
  edges: RawEdge[];
}

export interface ViewerNode {
  id: string;
  name: string;
  kind: string;
  file: string;
  degree: number;
}

export interface ViewerLink {
  source: string;
  target: string;
  kind: string;
}

export interface ViewerPayload {
  project: string;
  counts: {
    rawNodes: number;
    rawEdges: number;
    nodes: number;
    links: number;
    droppedExternal: number;
    droppedIgnored: number;
    droppedByCap: number;
  };
  nodes: ViewerNode[];
  links: ViewerLink[];
}

function posix(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Absolute POSIX, Windows drive, or UNC path; relative dumps skip rerooting. */
function isAbsolute(p: string): boolean {
  return /^(?:[A-Za-z]:)?\//.test(posix(p));
}

function isWindowsPath(p: string): boolean {
  const normalized = posix(p);
  return /^[A-Za-z]:(?:\/|$)/.test(normalized) || normalized.startsWith("//");
}

function directoryOf(file: string): string {
  const normalized = posix(file).replace(/\/+$/, "");
  const slash = normalized.lastIndexOf("/");
  /* c8 ignore next -- callers pass absolute file identities, never a slashless value. */
  if (slash < 0) return "";
  return slash === 0 ? "/" : normalized.slice(0, slash);
}

function commonRoot(directories: string[]): string {
  /* c8 ignore start -- the only caller first proves that the first absolute
   * project file exists, so its mapped directory list cannot be empty. */
  if (directories.length === 0) return "";
  /* c8 ignore stop */
  let parts = posix(directories[0]!).split("/");
  const caseInsensitive = directories.every(isWindowsPath);
  for (const directory of directories.slice(1)) {
    const other = posix(directory).split("/");
    let i = 0;
    while (
      i < parts.length &&
      i < other.length &&
      (caseInsensitive
        ? parts[i]!.toLowerCase() === other[i]!.toLowerCase()
        : parts[i] === other[i])
    )
      i++;
    parts = parts.slice(0, i);
    if (parts.length === 0) break;
  }
  return parts.join("/");
}

// A null root means schema-v6 coordinates are already project-relative.
function relativize(file: string, root: string | null): string {
  const normalized = posix(file);
  if (root === null) return normalized;
  const normalizedRoot = posix(root);
  const r = normalizedRoot === "/" ? "/" : normalizedRoot.replace(/\/+$/, "");
  const caseInsensitive = isWindowsPath(normalized) && isWindowsPath(r);
  const comparedPath = caseInsensitive
    ? normalized.toLowerCase()
    : normalized;
  const comparedRoot = caseInsensitive ? r.toLowerCase() : r;
  if (
    comparedRoot &&
    (comparedRoot === "/" ||
      comparedPath === comparedRoot ||
      comparedPath.startsWith(comparedRoot + "/"))
  )
    return normalized.slice(r.length).replace(/^\/+/, "");
  const nodeModules = normalized.lastIndexOf("node_modules/");
  if (nodeModules >= 0) return normalized.slice(nodeModules);
  return normalized;
}

function rewriteId(id: string, root: string | null): string {
  // A semantic id (`@v2/…`, `@g2/…`) is an opaque provider-native key whose
  // pre-`#` region is a language + digest, not a path; relativizing it would
  // corrupt the key, so it ships verbatim.
  if (id.startsWith("@v2/") || id.startsWith("@g2/")) return id;
  const hash = fileOfNodeId.hash(id);
  if (hash < 0) return id;
  return (
    fileOfNodeId.escape(
      relativize(fileOfNodeId.unescape(id.slice(0, hash)), root),
    ) + id.slice(hash)
  );
}

function degreeOf(
  nodes: { id: string }[],
  edges: { from: string; to: string }[],
): Map<string, number> {
  const degree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  for (const e of edges) {
    if (degree.has(e.from)) degree.set(e.from, degree.get(e.from)! + 1);
    if (degree.has(e.to)) degree.set(e.to, degree.get(e.to)! + 1);
  }
  return degree;
}

/**
 * Collapse the fine-grained wire kinds `samchon-graph dump` emits (calls,
 * instantiates, renders, accesses, type_ref, extends, implements) into the
 * three display families the viewer colors and its legend name. An unknown kind
 * passes through and renders with the fallback color.
 */
const DISPLAY_KIND: Record<string, string> = {
  calls: "value-call",
  instantiates: "value-call",
  renders: "value-call",
  accesses: "value-call",
  type_ref: "type-ref",
  extends: "heritage",
  implements: "heritage",
  overrides: "heritage",
};

function displayKind(kind: string): string {
  return DISPLAY_KIND[kind] ?? kind;
}

export function reduce(
  raw: RawDump,
  {
    maxNodes = 1200,
    keepExternal = false,
    keepIgnored = false,
  }: {
    maxNodes?: number;
    keepExternal?: boolean;
    keepIgnored?: boolean;
  } = {},
): ViewerPayload {
  const keep = (node: RawNode): boolean =>
    (keepExternal || !node.external) && (keepIgnored || !node.ignored);
  const keptByBoundary = raw.nodes.filter(keep);
  // Reroot only a legacy dump whose first authored identity is absolute.
  // Schema-v6 coordinates are already relative and pass through intact.
  const projectFiles = raw.nodes
    .filter((n) => !n.external && !n.ignored)
    .map((n) => n.file);
  const root =
    projectFiles.length > 0 && isAbsolute(projectFiles[0]!)
      ? commonRoot(projectFiles.filter(isAbsolute).map(directoryOf))
      : null;

  const liveIds = new Set(keptByBoundary.map((n) => n.id));
  const liveEdges = raw.edges.filter(
    (e) => liveIds.has(e.from) && liveIds.has(e.to),
  );

  const degree = degreeOf(keptByBoundary, liveEdges);
  let kept = keptByBoundary;
  let droppedByCap = 0;
  if (kept.length > maxNodes) {
    kept = [...kept]
      // Every kept node populated `degree`; the fallback is defensive only.
      /* c8 ignore next */
      .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
      .slice(0, maxNodes);
    droppedByCap = keptByBoundary.length - kept.length;
  }

  const keptIds = new Set(kept.map((n) => n.id));
  const edges = liveEdges.filter(
    (e) => keptIds.has(e.from) && keptIds.has(e.to),
  );
  const finalDegree = degreeOf(kept, edges);

  const nodes: ViewerNode[] = kept
    // `degreeOf(kept, edges)` initializes every kept id before this lookup.
    /* c8 ignore next */
    .filter((n) => (finalDegree.get(n.id) ?? 0) > 0)
    .map((n) => ({
      id: rewriteId(n.id, root),
      name: n.name,
      kind: n.kind,
      file: relativize(n.file, root),
      // The same invariant holds while materializing the surviving node.
      /* c8 ignore next */
      degree: finalDegree.get(n.id) ?? 0,
    }));

  const nodeIds = new Set(nodes.map((n) => n.id));
  const links: ViewerLink[] = edges
    .map((e) => ({
      source: rewriteId(e.from, root),
      target: rewriteId(e.to, root),
      kind: displayKind(e.kind),
    }))
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

  return {
    project: raw.project ?? "",
    counts: {
      rawNodes: raw.nodes.length,
      rawEdges: raw.edges.length,
      nodes: nodes.length,
      links: links.length,
      droppedExternal: keepExternal
        ? 0
        : raw.nodes.filter((node) => node.external).length,
      droppedIgnored: keepIgnored
        ? 0
        : raw.nodes.filter((node) => node.ignored && !node.external).length,
      droppedByCap,
    },
    nodes,
    links,
  };
}
