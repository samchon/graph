export type GraphLanguage =
  | "typescript"
  | "javascript"
  | "go"
  | "rust"
  | "cpp"
  | "c"
  | "java"
  | "csharp"
  | "kotlin"
  | "swift"
  | "scala"
  | "zig"
  | "unknown";

export type GraphNodeKind =
  | "file"
  | "package"
  | "namespace"
  | "module"
  | "function"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "variable"
  | "method"
  | "property"
  | "parameter"
  | "field"
  | "constructor"
  | "external_symbol";

export type GraphEdgeKind =
  | "contains"
  | "exports"
  | "imports"
  | "calls"
  | "accesses"
  | "instantiates"
  | "type_ref"
  | "extends"
  | "implements"
  | "overrides"
  | "decorates"
  | "renders"
  | "tests"
  | "references";

export interface IGraphEvidence {
  file: string;
  startLine: number;
  startCol?: number;
  endLine?: number;
  endCol?: number;
  text?: string;
}

export interface IGraphDecorator {
  name: string;
  arguments?: string[];
  evidence?: IGraphEvidence;
}

export interface IGraphNode {
  id: string;
  kind: GraphNodeKind;
  language: GraphLanguage;
  name: string;
  qualifiedName?: string;
  file: string;
  external: boolean;
  ignored?: boolean;
  exported?: boolean;
  signature?: string;
  modifiers?: string[];
  decorators?: IGraphDecorator[];
  evidence?: IGraphEvidence;
  implementation?: IGraphEvidence;
}

export interface IGraphEdge {
  from: string;
  to: string;
  kind: GraphEdgeKind;
  evidence?: IGraphEvidence;
}

export interface IGraphDiagnostic {
  file: string;
  message: string;
  severity: "error" | "warning" | "information" | "hint";
  source?: string;
  code?: string | number;
  evidence?: IGraphEvidence;
}

export interface IGraphDump {
  project: string;
  languages: GraphLanguage[];
  generatedAt: string;
  indexer: "lsp" | "static" | "hybrid";
  nodes: IGraphNode[];
  edges: IGraphEdge[];
  diagnostics?: IGraphDiagnostic[];
  warnings?: string[];
}

export interface IGraphNext {
  action: "answer" | "inspect" | "outside" | "clarify";
  request?:
    | "entrypoints"
    | "lookup"
    | "trace"
    | "details"
    | "overview"
    | "tour";
  reason: string;
}

export interface IGraphOverview {
  type: "overview";
  project: string;
  languages: GraphLanguage[];
  counts: IGraphOverview.ICounts;
  layers?: IGraphOverview.ILayer[];
  hotspots?: IGraphOverview.IHotspot[];
  publicApi?: IGraphOverview.IPublicApi[];
  diagnostics?: IGraphDiagnostic[];
  next: IGraphNext;
  guide: string;
}

export namespace IGraphOverview {
  export interface IRequest {
    type: "overview";
    aspect?: "all" | "layers" | "hotspots" | "publicApi" | "diagnostics";
  }

  export interface ICounts {
    files: number;
    nodes: number;
    edges: number;
    byKind: Record<string, number>;
    byLanguage: Record<string, number>;
  }

  export interface ILayer {
    dir: string;
    files: number;
    exported: number;
    languages: GraphLanguage[];
  }

  export interface INode {
    id: string;
    name: string;
    kind: string;
    language: GraphLanguage;
    file: string;
    line?: number;
    sourceSpan?: Pick<IGraphEvidence, "file" | "startLine" | "endLine">;
  }

  export interface IHotspot extends INode {
    fanIn: number;
    fanOut: number;
  }

  export type IPublicApi = INode;
}

export interface IGraphLookup {
  type: "lookup";
  hits: IGraphLookup.IHit[];
  unknown?: string[];
  next: IGraphNext;
  guide: string;
}

export namespace IGraphLookup {
  export interface IRequest {
    type: "lookup";
    query: string;
    language?: GraphLanguage;
    kind?: GraphNodeKind;
    limit?: number;
    includeExternal?: boolean;
  }

  export interface IHit extends IGraphOverview.INode {
    score: number;
    signature?: string;
    decorators?: IGraphDecorator[];
  }
}

export interface IGraphDetails {
  type: "details";
  nodes: IGraphDetails.INode[];
  unknown: string[];
  next: IGraphNext;
  guide: string;
}

export namespace IGraphDetails {
  export interface IRequest {
    type: "details";
    handles: string[];
    neighbors?: boolean;
    neighborLimit?: number;
    memberLimit?: number;
    dependencyLimit?: number;
    includeExternal?: boolean;
  }

  export interface INode extends IGraphOverview.INode {
    signature?: string;
    decorators?: IGraphDecorator[];
    implementation?: IGraphEvidence;
    members?: IMember[];
    calls?: IReference[];
    types?: IReference[];
    dependsOn?: IReference[];
    dependedOnBy?: IReference[];
    diagnostics?: IGraphDiagnostic[];
  }

  export interface IMember {
    name: string;
    kind: string;
    line?: number;
    signature?: string;
  }

  export interface IReference extends IGraphOverview.INode {
    relation: string;
    evidence?: IGraphEvidence;
  }
}

export interface IGraphTrace {
  type: "trace";
  start?: IGraphTrace.INode;
  direction: string;
  hops: IGraphTrace.IHop[];
  reached: IGraphTrace.INode[];
  truncated: boolean;
  target?: IGraphTrace.INode;
  path?: IGraphTrace.INode[];
  steps?: string[];
  candidates?: IGraphTrace.INode[];
  next: IGraphNext;
  guide: string;
}

export namespace IGraphTrace {
  export interface IRequest {
    type: "trace";
    from: string;
    to?: string;
    direction?: "forward" | "reverse" | "impact";
    focus?: "all" | "execution" | "types";
    maxDepth?: number;
    maxNodes?: number;
    includeExternal?: boolean;
  }

  export interface IHop {
    from: string;
    to: string;
    kind: string;
    depth: number;
    evidence?: IGraphEvidence;
  }

  export interface INode extends IGraphOverview.INode {
    depth?: number;
    signature?: string;
    roles?: string[];
  }
}

export interface IGraphEntrypoints {
  type: "entrypoints";
  query: string;
  ranked: IGraphEntrypoints.IEntrypoint[];
  mentions: IGraphOverview.INode[];
  dependencyOrientation: string[];
  next: IGraphNext;
  guide: string;
}

export namespace IGraphEntrypoints {
  export interface IRequest {
    type: "entrypoints";
    query: string;
    language?: GraphLanguage;
    limit?: number;
  }

  export interface IEntrypoint extends IGraphOverview.INode {
    score: number;
    reason: string;
  }
}

export interface IGraphTour {
  type: "tour";
  question?: string;
  entrypoints: IGraphEntrypoints.IEntrypoint[];
  primaryFlow: string[];
  nearbyPaths: IGraphOverview.INode[];
  testAnchors: IGraphOverview.INode[];
  answerAnchors: IGraphOverview.INode[];
  diagnostics?: IGraphDiagnostic[];
  next: IGraphNext;
  guide: string;
}

export namespace IGraphTour {
  export interface IRequest {
    type: "tour";
    question?: string;
    language?: GraphLanguage;
    limit?: number;
  }
}

export interface IGraphEscape {
  type: "escape";
  skipped: true;
  reason: string;
  nextStep?: string;
  next: IGraphNext;
  guide: string;
}

export namespace IGraphEscape {
  export interface IRequest {
    type: "escape";
    reason: string;
    nextStep?: string;
  }
}

/**
 * One MCP application surface for every supported language.
 *
 * Use this for architecture, runtime flow, APIs, callers/callees, type
 * relations, dependency orientation, diagnostics, and source-span anchors across
 * strongly typed compiled languages. It returns a graph index: names,
 * signatures, spans, diagnostics, and edges. It never returns source bodies.
 *
 * When the graph was built by LSP, returned facts are language-server/compiler
 * facts for the indexed snapshot. When it was built by static fallback, the
 * result carries the same contract but may be approximate; the `indexer` field
 * on dumps and CLI warnings tell you which path was used.
 */
export interface ISamchonGraphApplication {
  /**
   * Inspect the resident multi-language code graph.
   *
   * Fill `question`, `draft`, and `review`, then choose exactly one request
   * branch. If the answer is outside declarations, references, calls, types,
   * diagnostics, or source-span anchors, choose `escape`.
   */
  inspect_code_graph(
    props: ISamchonGraphApplication.IProps,
  ): Promise<ISamchonGraphApplication.IResult>;
}

export namespace ISamchonGraphApplication {
  export interface IProps {
    question: string;
    draft: IDraft;
    review: string;
    request:
      | IGraphEntrypoints.IRequest
      | IGraphLookup.IRequest
      | IGraphTrace.IRequest
      | IGraphDetails.IRequest
      | IGraphOverview.IRequest
      | IGraphTour.IRequest
      | IGraphEscape.IRequest;
  }

  export interface IDraft {
    reason: string;
    type: IProps["request"]["type"];
  }

  export interface IResult {
    result:
      | IGraphEntrypoints
      | IGraphLookup
      | IGraphTrace
      | IGraphDetails
      | IGraphOverview
      | IGraphTour
      | IGraphEscape;
  }
}
