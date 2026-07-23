import { GraphLanguage } from "../typings";
import { fileOfNodeId } from "../utils/fileOfNodeId";
import { IBulkGraphSession } from "./IBulkGraphSession";
import { IGraphProvider } from "./IGraphProvider";
import {
  isSemanticGraphNodeId,
  validateSemanticGraphNode,
} from "./semanticIdentity";

/**
 * Hold a published snapshot to the contract its provider registered.
 *
 * A provider states what it owns and what it can prove before it runs. Without
 * this check those statements are decoration: a payload could carry a `calls`
 * edge from a provider registered to prove none, or facts for a language this
 * candidate never claimed, and the dump would publish both under a provenance
 * row asserting the opposite. The audit that rides on every MCP result would
 * then be describing a graph that does not exist.
 *
 * Rejecting is right rather than dropping the offending facts. A provider that
 * publishes outside its declared contract has a defect, and quietly deleting
 * its surplus edges would leave a snapshot that is neither what the provider
 * produced nor what it promised — and would hide the defect from the only
 * party positioned to notice it.
 */
export function assertGraphSnapshotContract(
  snapshot: IBulkGraphSession.ISnapshot,
  provider: IGraphProvider,
  languages: readonly GraphLanguage[],
): void {
  const label = `@samchon/graph: provider "${provider.name}"`;
  if (snapshot.languages.length === 0) {
    throw new Error(`${label} published a snapshot owning no language`);
  }
  if (new Set(snapshot.languages).size !== snapshot.languages.length) {
    throw new Error(
      `${label} published a snapshot owning one language more than once`,
    );
  }

  const claimed = new Set(languages);
  for (const language of snapshot.languages) {
    if (!claimed.has(language)) {
      throw new Error(
        `${label} published a ${language} slice, which this candidate does not own`,
      );
    }
  }

  // A slice replaces its languages whole. A node in a language the slice does
  // not name would be published by this generation and deleted by no later one,
  // because nothing that refreshes this session is responsible for it.
  const owned = new Set(snapshot.languages);
  const nodeIds = new Set<string>();
  const files = new Set<string>();
  for (const node of snapshot.nodes) {
    if (!owned.has(node.language)) {
      throw new Error(
        `${label} published a ${node.language} node in a slice that owns only ${snapshot.languages.join(", ")}: ${node.id}`,
      );
    }
    if (nodeIds.has(node.id)) {
      throw new Error(`${label} published duplicate node id ${node.id}`);
    }
    nodeIds.add(node.id);
    if (node.file !== "") files.add(node.file);
    if (isSemanticGraphNodeId(node.id)) {
      validateSemanticGraphNode(node);
    } else if (
      !(node.external && node.kind === "external_symbol" && node.file === "") &&
      !(node.kind === "file" && node.id === node.file)
    ) {
      const parsed = fileOfNodeId.parseLegacy(node.id);
      if (
        parsed === undefined ||
        parsed.file !== node.file ||
        parsed.kind !== node.kind
      ) {
        throw new Error(
          `${label} published a legacy node id that contradicts its file or kind: ${node.id}`,
        );
      }
    }
  }

  const provable = new Set(provider.facts);
  for (const edge of snapshot.edges) {
    if (
      (!nodeIds.has(edge.from) && !files.has(edge.from)) ||
      (!nodeIds.has(edge.to) && !files.has(edge.to))
    ) {
      throw new Error(
        `${label} published an edge with an absent endpoint: ${edge.from} -> ${edge.to}`,
      );
    }
    if (!provable.has(edge.kind)) {
      throw new Error(
        `${label} published a "${edge.kind}" edge although it is not registered to prove that family: ${edge.from} -> ${edge.to}`,
      );
    }
  }

  const provenance = snapshot.provenance;
  if (provenance.provider !== provider.name) {
    throw new Error(
      `${label} published provenance attributing its facts to "${provenance.provider}"`,
    );
  }
  if (provenance.authority !== provider.authority) {
    throw new Error(
      `${label} published provenance claiming ${provenance.authority} authority although it is registered as ${provider.authority}`,
    );
  }
  if (!sameFacts(provenance.facts, provider.facts)) {
    throw new Error(
      `${label} published provenance claiming fact families [${provenance.facts.join(", ")}] although it is registered to prove [${provider.facts.join(", ")}]`,
    );
  }
}

function sameFacts(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  // These are fact families, so a repeated member is not a second fact. Without
  // rejecting it, ["calls", "calls"] could replace ["calls", "imports"]:
  // the old membership-only check saw two entries that each appeared in the
  // registry and missed the family the provider had silently stopped claiming.
  if (new Set(left).size !== left.length) return false;
  const expected = new Set(right);
  if (expected.size !== right.length) return false;
  return left.every((fact) => expected.has(fact));
}
