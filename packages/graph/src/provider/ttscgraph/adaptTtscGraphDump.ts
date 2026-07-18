import path from "node:path";

import {
  ISamchonGraphDecorator,
  ISamchonGraphEdge,
  ISamchonGraphEvidence,
  ISamchonGraphNode,
} from "../../structures";
import { GraphEdgeKind, GraphNodeKind } from "../../typings";

/**
 * Adapt a `ttscgraph serve` dump to one strict TypeScript language slice.
 *
 * The dump already is the semantic fact source. This adapter only adds the
 * language discriminator and performs the same module-to-file export-surface
 * fold as ttsc's canonical TtscGraphMemory. It rejects malformed identities,
 * dangling endpoints, and collisions instead of repairing or deduplicating
 * compiler output.
 */
export function adaptTtscGraphDump(
  input: unknown,
  expectedRoot: string,
): {
  nodes: ISamchonGraphNode[];
  edges: ISamchonGraphEdge[];
  files: string[];
} {
  const dump = objectOf(input, "dump");
  const project = stringOf(dump.project, "dump.project");
  if (!samePath(project, expectedRoot)) {
    throw new Error(
      `ttscgraph: response project ${project} does not match ${expectedRoot}`,
    );
  }
  const rawNodes = arrayOf(dump.nodes, "dump.nodes");
  const rawEdges = arrayOf(dump.edges, "dump.edges");
  const moduleIds = new Map<string, string>();
  const rawIds = new Set<string>();
  const sourceFileById = new Map<string, string>();
  const nodes: ISamchonGraphNode[] = [];
  const files = new Set<string>();

  for (let index = 0; index < rawNodes.length; index++) {
    const raw = objectOf(rawNodes[index], `dump.nodes[${index}]`);
    const id = stringOf(raw.id, `dump.nodes[${index}].id`);
    if (rawIds.has(id)) throw new Error(`ttscgraph: duplicate node id: ${id}`);
    rawIds.add(id);
    const kind = nodeKindOf(raw.kind, `dump.nodes[${index}].kind`);
    const file = stringOf(raw.file, `dump.nodes[${index}].file`);
    const external = booleanOf(raw.external, `dump.nodes[${index}].external`);
    validateGraphFile(file, `dump.nodes[${index}].file`, external);
    validateNodeId(id, file, kind);
    sourceFileById.set(id, file);
    if (!external && file !== "") files.add(file);
    if (kind === "module") {
      // `validateGraphFile` above already rejects an empty file for every node,
      // so a module reaching here always names a file.
      moduleIds.set(id, file);
      continue;
    }
    const node: ISamchonGraphNode = {
      id,
      kind,
      language: "typescript",
      name: stringOf(raw.name, `dump.nodes[${index}].name`),
      file,
      external,
    };
    optionalString(raw.qualifiedName, `${id}.qualifiedName`, (value) => {
      node.qualifiedName = value;
    });
    optionalBoolean(raw.ignored, `${id}.ignored`, (value) => {
      node.ignored = value;
    });
    optionalBoolean(raw.exported, `${id}.exported`, (value) => {
      node.exported = value;
    });
    optionalBoolean(raw.closure, `${id}.closure`, (value) => {
      node.closure = value;
    });
    if (raw.modifiers !== undefined) {
      node.modifiers = arrayOf(raw.modifiers, `${id}.modifiers`).map(
        (value, modifierIndex) =>
          modifierOf(value, `${id}.modifiers[${modifierIndex}]`),
      );
    }
    if (raw.decorators !== undefined) {
      node.decorators = decoratorsOf(raw.decorators, id);
    }
    if (raw.evidence !== undefined) {
      node.evidence = evidenceOf(raw.evidence, file, `${id}.evidence`, true);
    }
    if (raw.implementation !== undefined) {
      node.implementation = evidenceOf(
        raw.implementation,
        file,
        `${id}.implementation`,
      );
    }
    nodes.push(node);
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  // A folded file node takes the module's file path as its id, and that path can
  // never collide with a declaration node id: `validateNodeId` requires every
  // declaration id to contain a `#`, while a module file (the id prefix before
  // the first `#`) never does. No runtime collision check is therefore possible.
  // Canonical TtscGraphMemory turns every compiler module into one file node,
  // including an edge-and-declaration-free module whose module node is its only
  // trace. The strict adapter folds modules before the shared memory sees them,
  // so retain that exact structural fact here. Generic LSP/static `module`
  // declarations never enter this adapter and remain untouched.
  for (const file of new Set(moduleIds.values())) {
    nodes.push({
      id: file,
      kind: "file",
      language: "typescript",
      name: path.posix.basename(file),
      file,
      external: false,
    });
  }

  const edges: ISamchonGraphEdge[] = [];
  const edgeKeys = new Set<string>();
  for (let index = 0; index < rawEdges.length; index++) {
    const raw = objectOf(rawEdges[index], `dump.edges[${index}]`);
    const rawFrom = stringOf(raw.from, `dump.edges[${index}].from`);
    const rawTo = stringOf(raw.to, `dump.edges[${index}].to`);
    if (!rawIds.has(rawFrom)) {
      throw new Error(`ttscgraph: edge has unknown from endpoint: ${rawFrom}`);
    }
    if (!nodeIds.has(rawTo)) {
      throw new Error(
        `ttscgraph: edge has unknown or folded to endpoint: ${rawTo}`,
      );
    }
    const from = moduleIds.get(rawFrom) ?? rawFrom;
    const kind = edgeKindOf(raw.kind, `dump.edges[${index}].kind`);
    const key = `${kind}\0${from}\0${rawTo}`;
    if (edgeKeys.has(key)) {
      throw new Error(
        `ttscgraph: duplicate edge after module folding: ${kind} ${from} -> ${rawTo}`,
      );
    }
    edgeKeys.add(key);
    const edge: ISamchonGraphEdge = { from, to: rawTo, kind };
    if (raw.evidence !== undefined) {
      edge.evidence = evidenceOf(
        raw.evidence,
        sourceFileById.get(rawFrom)!,
        `dump.edges[${index}].evidence`,
        true,
      );
    }
    edges.push(edge);
  }

  return {
    nodes,
    edges,
    files: [...files]
      .sort((left, right) => left.localeCompare(right))
      .map((file) => path.resolve(expectedRoot, file)),
  };
}

const NODE_KINDS = new Set<GraphNodeKind>([
  "function",
  "class",
  "interface",
  "type",
  "enum",
  "variable",
  "method",
  "module",
]);
const EDGE_KINDS = new Set<GraphEdgeKind>([
  "exports",
  "calls",
  "accesses",
  "instantiates",
  "type_ref",
  "extends",
  "implements",
  "renders",
]);
const MODIFIERS = new Set<NonNullable<ISamchonGraphNode["modifiers"]>[number]>([
  "export",
  "default",
  "declare",
  "abstract",
  "static",
  "readonly",
  "async",
  "const",
  "public",
  "private",
  "protected",
  "internal",
  "optional",
]);

function objectOf(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`ttscgraph: ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function arrayOf(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`ttscgraph: ${label} must be an array`);
  }
  return value;
}

function stringOf(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`ttscgraph: ${label} must be a string`);
  }
  return value;
}

function booleanOf(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`ttscgraph: ${label} must be a boolean`);
  }
  return value;
}

function integerOf(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`ttscgraph: ${label} must be a positive integer`);
  }
  return value as number;
}

function nodeKindOf(value: unknown, label: string): GraphNodeKind {
  const kind = stringOf(value, label) as GraphNodeKind;
  if (!NODE_KINDS.has(kind)) {
    throw new Error(`ttscgraph: unsupported ${label}: ${kind}`);
  }
  return kind;
}

function edgeKindOf(value: unknown, label: string): GraphEdgeKind {
  const kind = stringOf(value, label) as GraphEdgeKind;
  if (!EDGE_KINDS.has(kind)) {
    throw new Error(`ttscgraph: unsupported ${label}: ${kind}`);
  }
  return kind;
}

function modifierOf(
  value: unknown,
  label: string,
): NonNullable<ISamchonGraphNode["modifiers"]>[number] {
  const modifier = stringOf(value, label) as NonNullable<
    ISamchonGraphNode["modifiers"]
  >[number];
  if (!MODIFIERS.has(modifier)) {
    throw new Error(`ttscgraph: unsupported ${label}: ${modifier}`);
  }
  return modifier;
}

function evidenceOf(
  value: unknown,
  defaultFile: string,
  label: string,
  mustMatchDefaultFile = false,
): ISamchonGraphEvidence {
  const raw = objectOf(value, label);
  const file =
    raw.file === undefined
      ? defaultFile
      : stringOf(raw.file, `${label}.file`);
  validateGraphFile(
    file,
    `${label}.file`,
    defaultFile.startsWith(BUNDLED_FILE_PREFIX),
  );
  if (mustMatchDefaultFile && file !== defaultFile) {
    throw new Error(
      `ttscgraph: ${label}.file must match its owning file: ${defaultFile}`,
    );
  }
  const evidence: ISamchonGraphEvidence = {
    file,
    startLine: integerOf(raw.startLine, `${label}.startLine`),
  };
  if (raw.startCol !== undefined) {
    evidence.startCol = integerOf(raw.startCol, `${label}.startCol`);
  }
  if (raw.endLine !== undefined) {
    evidence.endLine = integerOf(raw.endLine, `${label}.endLine`);
  }
  if (raw.endCol !== undefined) {
    evidence.endCol = integerOf(raw.endCol, `${label}.endCol`);
  }
  if (
    evidence.endCol !== undefined &&
    evidence.endLine === undefined
  ) {
    throw new Error(`ttscgraph: ${label}.endCol requires endLine`);
  }
  if (
    evidence.endLine !== undefined &&
    (evidence.endLine < evidence.startLine ||
      (evidence.endLine === evidence.startLine &&
        evidence.startCol !== undefined &&
        evidence.endCol !== undefined &&
        evidence.endCol < evidence.startCol))
  ) {
    throw new Error(`ttscgraph: ${label} has a reversed range`);
  }
  return evidence;
}

function decoratorsOf(value: unknown, id: string): ISamchonGraphDecorator[] {
  return arrayOf(value, `${id}.decorators`).map((item, index) => {
    const raw = objectOf(item, `${id}.decorators[${index}]`);
    return {
      name: stringOf(raw.name, `${id}.decorators[${index}].name`),
      arguments: arrayOf(
        raw.arguments,
        `${id}.decorators[${index}].arguments`,
      ).map((argument, argumentIndex) => {
        const rawArgument = objectOf(
          argument,
          `${id}.decorators[${index}].arguments[${argumentIndex}]`,
        );
        if (rawArgument.literal === undefined) return {};
        if (
          typeof rawArgument.literal !== "string" &&
          typeof rawArgument.literal !== "number" &&
          typeof rawArgument.literal !== "boolean"
        ) {
          throw new Error(
            `ttscgraph: ${id}.decorators[${index}].arguments[${argumentIndex}].literal must be scalar`,
          );
        }
        return { literal: rawArgument.literal };
      }),
    };
  });
}

function optionalString(
  value: unknown,
  label: string,
  assign: (value: string) => void,
): void {
  if (value !== undefined) assign(stringOf(value, label));
}

function optionalBoolean(
  value: unknown,
  label: string,
  assign: (value: boolean) => void,
): void {
  if (value !== undefined) assign(booleanOf(value, label));
}

const BUNDLED_FILE_PREFIX = "bundled:///";

function validateGraphFile(
  file: string,
  label: string,
  allowBundled = false,
): void {
  if (allowBundled && isNormalizedBundledFile(file)) return;
  if (
    file === "" ||
    file.includes("\\") ||
    path.posix.isAbsolute(file) ||
    path.win32.isAbsolute(file) ||
    path.posix.normalize(file) !== file ||
    file.split("/").some((segment) =>
      segment === "" || segment === "." || segment === ".."
    )
  ) {
    throw new Error(
      `ttscgraph: ${label} must be a normalized project-relative file: ${file}`,
    );
  }
}

function isNormalizedBundledFile(file: string): boolean {
  if (!file.startsWith(BUNDLED_FILE_PREFIX)) return false;
  const relative = file.slice(BUNDLED_FILE_PREFIX.length);
  return (
    relative !== "" &&
    !relative.includes("\\") &&
    !path.posix.isAbsolute(relative) &&
    path.posix.normalize(relative) === relative &&
    relative
      .split("/")
      .every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

function validateNodeId(id: string, file: string, kind: GraphNodeKind): void {
  const hash = id.indexOf("#");
  if (
    hash <= 0 ||
    id.slice(0, hash) !== file ||
    !id.endsWith(`:${kind}`)
  ) {
    throw new Error(
      `ttscgraph: node id does not match its file and kind: ${id}`,
    );
  }
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  // Only one arm of this comparison runs on a given operating system.
  /* c8 ignore next 3 */
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}
