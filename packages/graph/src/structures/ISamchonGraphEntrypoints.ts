import { GraphLanguage } from "../typings/GraphLanguage";
import { ISamchonGraphNext } from "./ISamchonGraphNext";
import { ISamchonGraphOverview } from "./ISamchonGraphOverview";

/** The first compact source-free handle list for a code question. */
export interface ISamchonGraphEntrypoints {
  /** Discriminator for first-pass question indexing. */
  type: "entrypoints";

  /** The original question/search phrase the entrypoints were built for. */
  query: string;

  /** Ranked symbols relevant to the query. */
  ranked: ISamchonGraphEntrypoints.IEntrypoint[];

  /** Code handles written directly in the query, resolved when possible. */
  mentions: ISamchonGraphOverview.INode[];

  /** Direct dependency context for the resolved mentions and highest hits. */
  dependencyOrientation: string[];

  /** How to use this source-free result next. */
  next: ISamchonGraphNext;

  /** Human-readable compatibility note mirroring `next`. */
  guide: string;
}

export namespace ISamchonGraphEntrypoints {
  /**
   * Ask for first handles when the question is narrow but the symbol is not yet
   * known. For broad tours, read-next, architecture, or multi-phase runtime
   * flow, use `tour` instead of decomposing the answer into entrypoints and
   * follow-up calls.
   */
  export interface IRequest {
    /** Discriminator for first-pass question indexing. */
    type: "entrypoints";

    /**
     * A natural code question or search phrase. Mix prose with code handles,
     * for example `how Repository.find loads relations` or
     * `SelectQueryBuilder.setFindOptions join aliases`. Keep this close to the
     * user's question; do not turn it into a broad keyword dump.
     */
    query: string;

    /** Target source language for the entrypoints. */
    language?: GraphLanguage;

    /**
     * Maximum ranked hits to return.
     *
     * Prefer the default. Raise only when the first result was truncated and
     * the missing handle is named.
     *
     * @default 4
     */
    limit?: number;
  }

  /** One ranked search hit. */
  export interface IEntrypoint extends ISamchonGraphOverview.INode {
    /** Relative relevance; higher is a better match. */
    score: number;

    /** Why this entrypoint was ranked for the query. */
    reason: string;
  }
}
