import path from "node:path";

import { parseGraphDump } from "../indexer/parseGraphDump";
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
  root: string = process.cwd(),
): void {
  const label = `@samchon/graph: provider "${provider.name}"`;
  const project = path.resolve(root);
  parseGraphDump({
    project,
    languages: snapshot.languages,
    indexer: "lsp",
    nodes: snapshot.nodes,
    edges: snapshot.edges,
    diagnostics: snapshot.diagnostics,
    warnings: snapshot.warnings,
  });
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
  const nodeIds = new Set<string>();
  const files = new Set<string>();
  for (const node of snapshot.nodes) {
    nodeIds.add(node.id);
    if (node.file !== "") files.add(node.file);
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

  assertSourceManifest(snapshot, project, label, files);
}

function assertSourceManifest(
  snapshot: IBulkGraphSession.ISnapshot,
  root: string,
  label: string,
  nodeFiles: ReadonlySet<string>,
): void {
  for (const file of snapshot.sources.keys()) {
    if (file.startsWith("bundled:///")) {
      const relative = file.slice("bundled:///".length);
      if (
        relative === "" ||
        path.posix.normalize(relative) !== relative ||
        relative
          .split("/")
          .some((part) => part === "" || part === "." || part === "..")
      ) {
        throw new Error(
          `${label} published a non-canonical bundled source identity: ${file}`,
        );
      }
    } else if (!path.isAbsolute(file) || path.normalize(file) !== file) {
      throw new Error(
        `${label} published a source identity that is not normalized and absolute: ${file}`,
      );
    }
  }

  const required = new Set(nodeFiles);
  for (const node of snapshot.nodes) {
    if (node.evidence?.file !== undefined) required.add(node.evidence.file);
    if (node.implementation?.file !== undefined) {
      required.add(node.implementation.file);
    }
  }
  for (const edge of snapshot.edges) {
    if (edge.evidence?.file !== undefined) required.add(edge.evidence.file);
  }
  for (const diagnostic of snapshot.diagnostics) {
    if (diagnostic.file !== "") required.add(diagnostic.file);
  }

  for (const file of required) {
    const source = file.startsWith("bundled:///")
      ? file
      : path.resolve(root, file);
    if (!snapshot.sources.has(source)) {
      throw new Error(
        `${label} published facts for ${file} without binding that file to its source manifest`,
      );
    }
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
