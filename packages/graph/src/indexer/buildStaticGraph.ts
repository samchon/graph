import path from "node:path";

import {
  GraphEdgeKind,
  GraphLanguage,
  GraphNodeKind,
  IGraphDump,
  IGraphEdge,
  IGraphEvidence,
  IGraphNode,
} from "../structures";
import { projectRelative, readLines, walkSourceFiles } from "../utils/fs";
import { allExtensions, languageOf } from "./languages";
import { IBuildGraphOptions } from "./IBuildGraphOptions";
import { resolveType } from "./resolveType";
import { supertypesOf } from "./supertypesOf";

interface IDeclaration {
  node: IGraphNode;
  startIndex: number;
  endIndex: number;
  ownerId?: string;
}

const EXTERNAL_MODULE_LIMIT = 1_500;

export function buildStaticGraph(options: IBuildGraphOptions = {}): IGraphDump {
  const root = path.resolve(options.cwd ?? process.cwd());
  const files = walkSourceFiles(root, {
    extensions: allExtensions(options.languages),
    maxFiles: options.maxFiles,
  });
  const nodes: IGraphNode[] = [];
  const edges: IGraphEdge[] = [];
  const declarationsByFile = new Map<string, IDeclaration[]>();
  const byName = new Map<string, IGraphNode[]>();
  const externalNodes = new Map<string, IGraphNode>();
  const warnings: string[] = [];

  for (const file of files) {
    const lines = readLines(file);
    /* c8 ignore next */
    if (lines === undefined) continue;
    const rel = projectRelative(root, file);
    const language = languageOf(file);
    const declarations = declarationsOf(rel, language, lines);
    declarationsByFile.set(rel, declarations);
    for (const declaration of declarations) {
      nodes.push(declaration.node);
      push(byName, declaration.node.name, declaration.node);
      if (declaration.ownerId !== undefined) {
        edges.push({
          from: declaration.ownerId,
          to: declaration.node.id,
          kind: "contains",
          evidence: declaration.node.evidence,
        });
      }
    }
    for (const imported of importsOf(rel, language, lines)) {
      if (externalNodes.size >= EXTERNAL_MODULE_LIMIT) continue;
      const external = externalNode(language, imported, externalNodes);
      nodes.push(external);
      edges.push({
        from: rel,
        to: external.id,
        kind: "imports",
        evidence: imported.evidence,
      });
    }
  }

  for (const [rel, declarations] of declarationsByFile) {
    const abs = path.join(root, rel);
    const lines = readLines(abs);
    /* c8 ignore next */
    if (lines === undefined) continue;
    for (const declaration of declarations) {
      const body = lines
        .slice(declaration.startIndex, Math.max(declaration.startIndex + 1, declaration.endIndex + 1))
        .join("\n");
      for (const edge of dependencyEdges(declaration.node, body, byName)) {
        edges.push(edge);
      }
      for (const edge of inheritanceEdges(declaration.node, byName)) {
        edges.push(edge);
      }
    }
  }

  if (files.length === 0) {
    warnings.push("No supported source files were found.");
  }

  return {
    project: root,
    languages: [...new Set(files.map(languageOf))],
    generatedAt: new Date().toISOString(),
    indexer: "static",
    nodes: dedupeNodes(nodes),
    edges: dedupeEdges(edges),
    warnings,
  };
}

function declarationsOf(
  file: string,
  language: GraphLanguage,
  lines: readonly string[],
): IDeclaration[] {
  const declarations: IDeclaration[] = [];
  const ownerStack: Array<{ name: string; endIndex: number; id: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    while (ownerStack.length > 0 && i > ownerStack[ownerStack.length - 1]!.endIndex) {
      ownerStack.pop();
    }
    const parsed = parseDeclaration(language, line, ownerStack.length > 0);
    if (parsed !== undefined) {
      const endIndex = declarationEndIndex(lines, i);
      const owner = ownerStack.map((entry) => entry.name).join(".");
      const qualifiedName = owner === "" ? parsed.name : `${owner}.${parsed.name}`;
      const node: IGraphNode = {
        id: `${file}#${qualifiedName}:${parsed.kind}`,
        kind: parsed.kind,
        language,
        name: parsed.name,
        ...(qualifiedName !== parsed.name ? { qualifiedName } : {}),
        file,
        external: false,
        exported: parsed.exported,
        signature: line.trim(),
        evidence: {
          file,
          startLine: i + 1,
          startCol: Math.max(1, line.indexOf(parsed.name) + 1),
          endLine: i + 1,
          text: line.trim(),
        },
      };
      declarations.push({
        node,
        startIndex: i,
        endIndex,
        ownerId: ownerStack[ownerStack.length - 1]?.id,
      });
      if (isContainer(parsed.kind) && endIndex > i) {
        ownerStack.push({
          name: parsed.name,
          endIndex,
          id: node.id,
        });
      }
    }
  }
  return declarations;
}

function parseDeclaration(
  language: GraphLanguage,
  line: string,
  inContainer: boolean,
): { kind: GraphNodeKind; name: string; exported?: boolean } | undefined {
  const text = line.trim();
  if (text === "" || text.startsWith("//") || text.startsWith("*")) return undefined;
  const packageDeclaration = /^package\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*;?/.exec(text);
  if (packageDeclaration !== null) {
    return {
      kind: "package",
      name: packageDeclaration[1]!,
      exported: true,
    };
  }
  if (inContainer) {
    const method =
      /^(?:(?:public|private|protected|internal|static|abstract|final|open|override|async|pub|pub\(crate\))\s+)*([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*(?::|->|\{|$)/.exec(
        text,
      );
    if (method !== null && !CONTROL_WORDS.has(method[1]!)) {
      return { kind: "method", name: method[1]! };
    }
  }
  const generic = /^(?:export\s+)?(?:(?:public|private|protected|internal|static|abstract|final|open|override|async|pub|pub\(crate\))\s+)*(class|interface|struct|enum|trait|type|namespace|module|object|protocol|extension|func|fn|function|def|fun|method|const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(text);
  const cppFunction = /^(?:[\w:<>,~*&\s]+)\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:const\s*)?\{?\s*$/.exec(text);
  const goFunc = /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/.exec(text);
  const goType = /^type\s+([A-Za-z_]\w*)\s+(struct|interface|\w+)/.exec(text);
  const tsVariable = /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::|=|\()/ .exec(text);

  if (language === "go" && goFunc !== null) {
    return { kind: "function", name: goFunc[1]!, exported: isCapitalized(goFunc[1]!) };
  }
  if (language === "go" && goType !== null) {
    return {
      kind: goType[2] === "interface" ? "interface" : "class",
      name: goType[1]!,
      exported: isCapitalized(goType[1]!),
    };
  }
  if ((language === "typescript" || language === "javascript") && tsVariable !== null) {
    return {
      kind: "variable",
      name: tsVariable[1]!,
      exported: text.startsWith("export "),
    };
  }
  if (generic !== null) {
    const token = generic[1]!;
    const name = generic[2]!;
    return {
      kind: kindOf(token),
      name,
      exported:
        /\b(export|public|pub)\b/.test(text) ||
        language === "go" && isCapitalized(name),
    };
  }
  if ((language === "c" || language === "cpp") && cppFunction !== null) {
    return { kind: "function", name: cppFunction[1]!, exported: true };
  }
  return undefined;
}

function kindOf(token: string): GraphNodeKind {
  switch (token) {
    case "class":
    case "struct":
    case "object":
    case "extension":
      return "class";
    case "interface":
    case "trait":
    case "protocol":
      return "interface";
    case "type":
      return "type";
    case "enum":
      return "enum";
    case "namespace":
      return "namespace";
    case "module":
      return "module";
    case "func":
    case "fn":
    case "function":
    case "def":
    case "fun":
    case "method":
      return "function";
    default:
      return "variable";
  }
}

function importsOf(
  file: string,
  language: GraphLanguage,
  lines: readonly string[],
): Array<{ name: string; evidence: IGraphEvidence }> {
  const out: Array<{ name: string; evidence: IGraphEvidence }> = [];
  let goImportBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!.trim();
    const names: string[] = [];
    if (language === "typescript" || language === "javascript") {
      for (const match of text.matchAll(/\bfrom\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|^import\s+["']([^"']+)["']/g)) {
        names.push((match[1] ?? match[2] ?? match[3])!);
      }
    } else if (language === "go") {
      if (goImportBlock) {
        if (text.startsWith(")")) {
          goImportBlock = false;
        } else {
          const match = /^(?:(?:[._]|\w+)\s+)?["`]([^"`]+)["`]/.exec(text);
          if (match !== null) names.push(match[1]!);
        }
      } else if (/^import\s*\(/.test(text)) {
        goImportBlock = true;
      } else {
        const match = /^import\s+(?:(?:[._]|\w+)\s+)?["`]([^"`]+)["`]/.exec(text);
        if (match !== null) names.push(match[1]!);
      }
    } else if (language === "rust") {
      const match = /^use\s+([^;]+);?/.exec(text);
      if (match !== null) names.push(match[1]!);
    } else if (language === "cpp" || language === "c") {
      const match = /^#include\s+[<"]([^>"]+)[>"]/.exec(text);
      if (match !== null) names.push(match[1]!);
    } else {
      const match = /^(?:import|using|package)\s+([^;]+)/.exec(text);
      if (match !== null) names.push(match[1]!.trim());
    }
    for (const name of names.filter((value) => value !== "")) {
      out.push({
        name,
        evidence: { file, startLine: i + 1, endLine: i + 1, text },
      });
    }
  }
  return out;
}

function dependencyEdges(
  source: IGraphNode,
  body: string,
  byName: Map<string, IGraphNode[]>,
): IGraphEdge[] {
  const out: IGraphEdge[] = [];
  const seen = new Set<string>();
  for (const [name, targets] of byName) {
    if (name === source.name) continue;
    const target = targets.find((node) => node.file !== source.file || node.id !== source.id);
    /* c8 ignore next */
    if (target === undefined) continue;
    const callPattern = new RegExp(`\\b(?:new\\s+)?${escapeRegExp(name)}\\s*\\(`);
    const typePattern = new RegExp(`\\b${escapeRegExp(name)}\\b`);
    const kind: GraphEdgeKind | undefined = callPattern.test(body)
      ? target.kind === "class"
        ? "instantiates"
        : "calls"
      : typePattern.test(body)
        ? "type_ref"
        : undefined;
    if (kind === undefined) continue;
    const key = `${source.id}\0${target.id}\0${kind}`;
    /* c8 ignore next */
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      from: source.id,
      to: target.id,
      kind,
      evidence: source.evidence,
    });
  }
  return out;
}

function inheritanceEdges(
  source: IGraphNode,
  byName: Map<string, IGraphNode[]>,
): IGraphEdge[] {
  if (source.kind !== "class" && source.kind !== "interface") return [];
  const out: IGraphEdge[] = [];
  const seen = new Set<string>();
  for (const supertype of supertypesOf(source.signature!)) {
    const target = resolveType(supertype.name, source, byName);
    if (target === undefined) continue;
    const key = `${supertype.relation}\0${target.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      from: source.id,
      to: target.id,
      kind: supertype.relation,
      evidence: source.evidence,
    });
  }
  return out;
}

function externalNode(
  language: GraphLanguage,
  imported: { name: string; evidence: IGraphEvidence },
  cache: Map<string, IGraphNode>,
): IGraphNode {
  const key = `external:${language}:${imported.name}`;
  let node = cache.get(key);
  if (node !== undefined) return node;
  node = {
    id: key,
    kind: "external_symbol",
    language,
    name: imported.name,
    file: "",
    external: true,
  };
  cache.set(key, node);
  return node;
}

function dedupeNodes(nodes: IGraphNode[]): IGraphNode[] {
  const map = new Map<string, IGraphNode>();
  for (const node of nodes) map.set(node.id, node);
  return [...map.values()];
}

function dedupeEdges(edges: IGraphEdge[]): IGraphEdge[] {
  const map = new Map<string, IGraphEdge>();
  for (const edge of edges) map.set(`${edge.kind}\0${edge.from}\0${edge.to}`, edge);
  return [...map.values()];
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const bucket = map.get(key);
  if (bucket === undefined) map.set(key, [value]);
  else bucket.push(value);
}

function isContainer(kind: GraphNodeKind): boolean {
  return (
    kind === "class" ||
    kind === "interface" ||
    kind === "namespace" ||
    kind === "module" ||
    kind === "function" ||
    kind === "method" ||
    kind === "constructor"
  );
}

function declarationEndIndex(lines: readonly string[], start: number): number {
  let depth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let entered = false;
  for (let i = start; i < lines.length; i++) {
    const text = stripStringsAndComments(lines[i]!);
    for (const char of text) {
      if (char === "(") {
        parenDepth++;
      } else if (char === ")") {
        parenDepth = Math.max(0, parenDepth - 1);
      } else if (char === "[") {
        bracketDepth++;
      } else if (char === "]") {
        bracketDepth = Math.max(0, bracketDepth - 1);
      } else if (char === "{" && parenDepth === 0 && bracketDepth === 0) {
        depth++;
        entered = true;
      } else if (char === "}" && parenDepth === 0 && bracketDepth === 0) {
        depth = Math.max(0, depth - 1);
      }
    }
    if (entered && depth === 0) return i;
    if (!entered && text.trimEnd().endsWith(";")) return i;
  }
  return start;
}

function stripStringsAndComments(line: string): string {
  return line.replace(/\/\/.*$/, "").replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "");
}

function isCapitalized(name: string): boolean {
  return /^[A-Z]/.test(name);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CONTROL_WORDS = new Set([
  "for",
  "if",
  "switch",
  "while",
  "catch",
  "return",
]);
