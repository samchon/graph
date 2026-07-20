import { GraphLanguage } from "../typings";
import { IBulkGraphSession } from "./IBulkGraphSession";
import { IGraphProvider } from "./IGraphProvider";

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
  for (const node of snapshot.nodes) {
    if (!owned.has(node.language)) {
      throw new Error(
        `${label} published a ${node.language} node in a slice that owns only ${snapshot.languages.join(", ")}: ${node.id}`,
      );
    }
  }

  const provable = new Set(provider.facts);
  for (const edge of snapshot.edges) {
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
  const expected = new Set(right);
  return left.every((fact) => expected.has(fact));
}
