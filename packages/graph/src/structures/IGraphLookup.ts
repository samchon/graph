import { GraphLanguage } from "./GraphLanguage";
import { GraphNodeKind } from "./GraphNodeKind";
import { IGraphDecorator } from "./IGraphDecorator";
import { IGraphNext } from "./IGraphNext";
import { IGraphOverview } from "./IGraphOverview";

/** Targeted symbol lookup when a concrete name or handle is being resolved. */
export interface IGraphLookup {
  /** Discriminator for targeted symbol lookup. */
  type: "lookup";

  /** Ranked symbol matches for the query. */
  hits: IGraphLookup.IHit[];

  /** Query terms that matched nothing. */
  unknown?: string[];

  /** How to use this source-free result next. */
  next: IGraphNext;

  /** Human-readable compatibility note mirroring `next`. */
  guide: string;
}

export namespace IGraphLookup {
  /** Find a concrete class, method, function, property, type, or dotted handle. */
  export interface IRequest {
    /** Discriminator for targeted symbol lookup. */
    type: "lookup";

    /**
     * What to find, in natural language and code vocabulary mixed freely: a
     * symbol name, a dotted member (`Service.create`), or a short phrase
     * (`request handler`). Exact names are not required, but this is not a
     * second broad entrypoints call. Use it when a named handle is missing or
     * ambiguous.
     */
    query: string;

    /** Restrict hits to this language. */
    language?: GraphLanguage;

    /** Restrict hits to this declaration kind. */
    kind?: GraphNodeKind;

    /**
     * Maximum hits to return.
     *
     * Prefer the default. Large hit lists usually mean the query is too broad;
     * refine the name instead of raising this.
     *
     * @default 5
     */
    limit?: number;

    /**
     * Include dependency-boundary declarations from bundled libraries. Leave
     * false for project-source answers; enable only when external type/API
     * boundaries are the question.
     *
     * @default false
     */
    includeExternal?: boolean;
  }

  /** One ranked hit with a handle to follow via `details` or `trace`. */
  export interface IHit extends IGraphOverview.INode {
    /** Relative relevance; higher is a better match. */
    score: number;

    /**
     * The hit's declaration signature, so you can often answer without
     * requesting details.
     */
    signature?: string;

    /** Decorators written on this declaration, when any. */
    decorators?: IGraphDecorator[];
  }
}
