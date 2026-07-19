import { ISamchonGraphDecorator } from "./ISamchonGraphDecorator";
import { ISamchonGraphEvidence } from "./ISamchonGraphEvidence";

/** The first compact source-free handle list for a __LANG__ code question. */
export interface ISamchonGraphEntrypoints {
  /** Discriminator for first-pass question indexing. */
  type: "entrypoints";

  /** Ranked symbols relevant to the query. */
  hits: ISamchonGraphEntrypoints.IHit[];

  /** Code handles written directly in the query, resolved when possible. */
  mentions: ISamchonGraphEntrypoints.IMention[];

  /** Direct dependency context for the resolved mentions and highest hits. */
  neighborhood: ISamchonGraphEntrypoints.INeighborhood[];

  /** True when some low-signal seeds or references were capped; the list stands. */
  truncated?: boolean;
}

export namespace ISamchonGraphEntrypoints {
  /**
   * First handles when the question is narrow but the symbol name is not yet
   * known.
   */
  export interface IRequest {
    /** Discriminator for first-pass question indexing. */
    type: "entrypoints";

    /**
     * A natural code question or search phrase, prose mixed with code handles
     * (`how Repository.find loads relations`). Keep it close to the user's
     * question, not a broad keyword dump.
     */
    query: string;

    /**
     * Maximum ranked hits to return.
     *
     * @default 4
     */
    limit?: number;

    /**
     * Maximum direct dependencies and dependents per indexed symbol. An
     * orientation slice, not a dependency dump; use `trace` or `details` with
     * `neighbors:true` after choosing the specific handles.
     *
     * @default 0
     */
    neighbors?: number;
  }

  /** A compact symbol coordinate, optionally with its declaration signature. */
  export interface INode {
    /** Stable node id for subsequent graph calls. */
    id: string;

    /** Qualified symbol name when available, otherwise the simple name. */
    name: string;

    /** Declaration kind (`class`, `method`, `function`, ...). */
    kind: string;

    /** Declaration identity: project-relative, normalized absolute, or `bundled:///`. */
    file: string;

    /** 1-based declaration line, when known. */
    line?: number;

    /** Declaration head, included only for indexed symbols. */
    signature?: string;

    /** Decorators written on this declaration, when any. */
    decorators?: ISamchonGraphDecorator[];
  }

  /** One ranked search hit. */
  export interface IHit extends INode {
    /** Relative relevance; higher is a better match. */
    score: number;
  }

  /** A code handle written in the query, with its resolution status. */
  export interface IMention {
    /** The exact handle text found in the query. */
    handle: string;

    /** Resolved node when the handle maps unambiguously. */
    node?: INode;

    /** Candidate nodes when the handle is ambiguous. */
    candidates?: INode[];
  }

  /** Direct dependency context around one indexed symbol. */
  export interface INeighborhood extends INode {
    /** Symbols this node directly uses, capped by `neighbors`. */
    dependsOn: IReference[];

    /** Symbols that directly use this node, capped by `neighbors`. */
    dependedOnBy: IReference[];
  }

  /** One neighboring symbol and the relationship leading to it. */
  export interface IReference {
    /** Stable id of the neighboring node. */
    id: string;

    /** Neighbor symbol name, qualified when available. */
    name: string;

    /** Neighbor declaration kind. */
    kind: string;

    /** Neighbor identity: project-relative, normalized absolute, or `bundled:///`. */
    file: string;

    /** 1-based declaration line, when known. */
    line?: number;

    /** Edge kind connecting the indexed node and this neighbor. */
    relation: string;

    /** Source span for the edge: shows why it exists without opening the file. */
    evidence?: ISamchonGraphEvidence;
  }
}
