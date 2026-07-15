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
 * dispatches through when a call lands on a declaration with no body (§3a) — an
 * abstract base and an interface are the same dead end to a walk that follows
 * what executes.
 */
export function overrideEdges(
  nodes: readonly ISamchonGraphNode[],
  edges: readonly ISamchonGraphEdge[],
): ISamchonGraphEdge[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const membersByOwner = new Map<string, Map<string, ISamchonGraphNode>>();
  for (const edge of edges) {
    if (edge.kind !== "contains") continue;
    const member = byId.get(edge.to);
    if (member === undefined || !IMPLEMENTATION_MEMBER_KINDS.has(member.kind))
      continue;
    let members = membersByOwner.get(edge.from);
    if (members === undefined) {
      members = new Map();
      membersByOwner.set(edge.from, members);
    }
    members.set(member.name, member);
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
    for (const [name, subMember] of subMembers) {
      const superMember = superMembers.get(name);
      if (superMember === undefined) continue;
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
