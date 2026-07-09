import { ISamchonGraphDecorator } from "./ISamchonGraphDecorator";
import { ISamchonGraphDiagnostic } from "./ISamchonGraphDiagnostic";
import { ISamchonGraphEvidence } from "./ISamchonGraphEvidence";
import { ISamchonGraphNext } from "./ISamchonGraphNext";
import { ISamchonGraphOverview } from "./ISamchonGraphOverview";

/**
 * The source-free facts for a few selected handles.
 *
 * This is not a file reader. It returns signatures, member outlines, direct
 * calls, direct types, implementation candidates, dependency summaries, and
 * sourceSpan citation anchors.
 */
export interface ISamchonGraphDetails {
  /** Discriminator for selected symbol inspection. */
  type: "details";

  /** Selected node facts, in the same order as resolved handles when possible. */
  nodes: ISamchonGraphDetails.INode[];

  /** Handles that resolved to no node, or that were ambiguous. */
  unknown: string[];

  /** How to use this source-free result next. */
  next: ISamchonGraphNext;

  /** Human-readable compatibility note mirroring `next`. */
  guide: string;
}

export namespace ISamchonGraphDetails {
  /** Which selected handles to inspect, and how much of each to return. */
  export interface IRequest {
    /** Discriminator for selected symbol inspection. */
    type: "details";

    /**
     * Node ids from another tool, or dotted symbol handles such as
     * `OrderService.create`. Pass the few handles you need for source-free
     * details. Prefer one to three handles. Use `trace` when you need a path
     * instead of widening this call.
     */
    handles: string[];

    /**
     * Also list each node's direct dependencies and dependents (the symbols it
     * uses and the symbols that use it). The list is capped; raise
     * `neighborLimit` when the first slice is truncated and the missing
     * relation is named. This remains a relationship summary, not a file body.
     *
     * @default false
     */
    neighbors?: boolean;

    /**
     * Maximum dependencies and dependents to return per side when
     * `neighbors:true`.
     *
     * Prefer the default. Values above a few neighbors are usually overfetch;
     * call `trace` for flow instead.
     *
     * @default 2
     */
    neighborLimit?: number;

    /**
     * Maximum owned members to return for a container or object literal. Raise
     * only when the first outline is truncated and the missing member is
     * named.
     *
     * @default 6
     */
    memberLimit?: number;

    /**
     * Maximum direct execution and type references to return per group. Raise
     * only when the first dependency slice is truncated and the missing
     * dependency is named.
     *
     * @default 1
     */
    dependencyLimit?: number;

    /**
     * Include dependency-boundary references from bundled libraries. Leave
     * false for source-architecture answers; enable only when external
     * type/API boundaries are the question.
     *
     * @default false
     */
    includeExternal?: boolean;
  }

  /** One inspected node: its declared shape and graph coordinates. */
  export interface INode extends ISamchonGraphOverview.INode {
    /** The declaration signature: its first line(s) up to the body. */
    signature?: string;

    /** Decorators written on this declaration, when any. */
    decorators?: ISamchonGraphDecorator[];

    /** Assigned implementation span, when source comes from one. */
    implementation?: ISamchonGraphEvidence;

    /**
     * For a container or object-literal variable: the owned symbol or top-level
     * property outline a consumer reaches for, without bodies.
     */
    members?: IMember[];

    /** Direct execution dependencies in source order, with edge evidence. */
    calls?: IReference[];

    /** Direct type dependencies in source order, with edge evidence. */
    types?: IReference[];

    /** Symbols this node uses (outgoing dependency edges). */
    dependsOn?: IReference[];

    /** Symbols that use this node (incoming dependency edges). */
    dependedOnBy?: IReference[];

    /** Diagnostics reported on this node's declaration, when any. */
    diagnostics?: ISamchonGraphDiagnostic[];
  }

  /** One member of a container node, with its signature but not its body. */
  export interface IMember {
    /** Member name, qualified when the graph records an owner-qualified handle. */
    name: string;

    /** Member kind (`method`, `property`, `class`, ...). */
    kind: string;

    /** 1-based declaration line, when known. */
    line?: number;

    /** The member's declaration signature. */
    signature?: string;
  }

  /** A dependency neighbor of an inspected node and the edge that links them. */
  export interface IReference extends ISamchonGraphOverview.INode {
    /** The edge kind connecting the two (`calls`, `type_ref`, ...). */
    relation: string;

    /**
     * Source span for the expression that produced this relationship. It is
     * repository evidence for the edge, not a file-read instruction.
     */
    evidence?: ISamchonGraphEvidence;
  }
}
