import { semanticMemberKey } from "../provider/semanticIdentity";
import { ISamchonGraphEdge, ISamchonGraphNode } from "../structures";
import { GraphEdgeKind } from "../typings";

// Members whose declaration a subtype can re-declare: a method, and a
// function-valued property or field (`onClick = () => ...`), which is how a
// class satisfies an interface member without writing a method.
const IMPLEMENTATION_MEMBER_KINDS = new Set<string>([
  "method",
  "property",
  "field",
]);

/**
 * Link a member to the supertype member it re-declares, given a graph that
 * already carries `contains` (owner -> member) and `extends`/`implements`
 * (subtype -> supertype) edges.
 *
 * The member-level edge mirrors the type-level relation it came from: a class
 * that `implements` an interface *implements* its members, one that `extends` a
 * base *overrides* them. That distinction is what `details` reports back under
 * `implementedBy`, and together the two kinds are what a forward trace
 * dispatches through when a call lands on a declaration with no body.
 *
 * @deprecated This heuristic is retained only for compatibility with the
 * released root API. Core indexing uses compiler- or language-server-owned
 * override facts and must not add the result of this function automatically.
 */
export function overrideEdges(
  nodes: readonly ISamchonGraphNode[],
  edges: readonly ISamchonGraphEdge[],
): ISamchonGraphEdge[] {
  const byId = new Map<string, ISamchonGraphNode[]>();
  for (const node of nodes) push(byId, node.id, node);
  const membersByOwner = new Map<string, Map<string, ISamchonGraphNode[]>>();
  for (const edge of edges) {
    if (edge.kind !== "contains") continue;
    const candidates = byId.get(edge.to);
    if (candidates === undefined) continue;
    let members = membersByOwner.get(edge.from);
    if (members === undefined) {
      members = new Map();
      membersByOwner.set(edge.from, members);
    }
    for (const member of candidates) {
      if (!IMPLEMENTATION_MEMBER_KINDS.has(member.kind)) continue;
      const key = semanticMemberKey(member);
      const group = members.get(key);
      if (group === undefined) members.set(key, [member]);
      else if (!group.includes(member)) group.push(member);
    }
  }

  const out: ISamchonGraphEdge[] = [];
  for (const edge of edges) {
    const kind: GraphEdgeKind | undefined =
      edge.kind === "implements"
        ? "implements"
        : edge.kind === "extends"
          ? "overrides"
          : undefined;
    if (kind === undefined) continue;
    const subMembers = membersByOwner.get(edge.from);
    const superMembers = membersByOwner.get(edge.to);
    if (subMembers === undefined || superMembers === undefined) continue;
    for (const [key, subGroup] of subMembers) {
      const superGroup = superMembers.get(key);
      if (
        subGroup.length !== 1 ||
        superGroup === undefined ||
        superGroup.length !== 1
      ) {
        continue;
      }
      const subMember = subGroup[0]!;
      const superMember = superGroup[0]!;
      out.push({
        from: subMember.id,
        to: superMember.id,
        kind,
        evidence: subMember.implementation ?? subMember.evidence,
      });
    }
  }
  return out;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key);
  if (values === undefined) map.set(key, [value]);
  else values.push(value);
}
