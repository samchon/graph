import { ISamchonGraphDecorator } from "./ISamchonGraphDecorator";
import { ISamchonGraphEvidence } from "./ISamchonGraphEvidence";

/**
 * Source-free facts for a few selected handles, not a file reader: signatures,
 * member outlines, direct calls and types, implementation candidates,
 * dependency summaries, and sourceSpan citation anchors.
 */
export interface ISamchonGraphDetails {
  /** Discriminator for selected symbol inspection. */
  type: "details";

  /** Selected node facts, in the same order as resolved handles when possible. */
  nodes: ISamchonGraphDetails.INode[];

  /** Handles the graph holds no node for. */
  unknown: string[];

  /**
   * Handles that name more than one node, with the nodes they name.
   *
   * A name the graph knows twice is not a name the graph does not know: two
   * classes called `Workbench` are two facts, and answering "unknown" to a
   * handle the index resolved twice sends the caller to the files for what is
   * already here. Re-call `details` with the `id` of the one the question
   * means.
   */
  ambiguous?: ISamchonGraphDetails.IAmbiguity[];
}
export namespace ISamchonGraphDetails {
  /** Which selected handles to inspect, and how much of each to return. */
  export interface IRequest {
    /** Discriminator for selected symbol inspection. */
    type: "details";

    /**
     * Node ids or dotted symbol handles (`OrderService.create`). Prefer one to
     * three; use `trace` for a path instead of widening this call.
     */
    handles: string[];

    /**
     * Also list each node's direct dependencies and dependents (symbols it uses
     * and symbols that use it), capped. A relationship summary, not a file
     * body.
     *
     * @default false
     */
    neighbors?: boolean;

    /**
     * Dependencies and dependents per side when `neighbors:true`. A small
     * orientation slice by default; what uses a symbol grows with its
     * popularity, so `trace` answers the whole "who uses this".
     *
     * @default 2
     */
    neighborLimit?: number;

    /**
     * Owned members for a container or object literal. The complete outline by
     * default — a class's members and an enum's are the symbol itself, so they
     * are not sampled. Pass a number to cap.
     */
    memberLimit?: number;

    /**
     * Direct execution and type references per group. A small orientation slice
     * by default; `trace` follows the whole fan-out.
     *
     * @default 2
     */
    dependencyLimit?: number;

    /**
     * Include dependency-boundary references from node_modules or bundled
     * `.d.ts` libraries. Enable only when external type/API boundaries are the
     * question.
     *
     * @default false
     */
    includeExternal?: boolean;
  }

  /** One handle and the several nodes it names. */
  export interface IAmbiguity {
    /** The handle as submitted. */
    handle: string;

    /** Every node the handle names, each with the id to re-call `details` on. */
    candidates: ICandidate[];
  }

  /** One node a handle could mean: enough to choose, not to answer from. */
  export interface ICandidate {
    /** Stable node id: submit this as the handle to select this one. */
    id: string;

    /** Qualified symbol name when available, otherwise the simple name. */
    name: string;

    /** Declaration kind (`class`, `method`, `function`, ...). */
    kind: string;

    /** Project-relative path of the file that declares this node. */
    file: string;

    /** 1-based declaration line, when known. */
    line?: number;
  }

  /** One inspected node: its declared shape and graph coordinates. */
  export interface INode {
    /** Stable node id for subsequent `details` or `trace` calls. */
    id: string;

    /** Qualified symbol name when available, otherwise the simple name. */
    name: string;

    /** Declaration kind (`class`, `method`, `function`, ...). */
    kind: string;

    /** Project-relative path of the file that declares this node. */
    file: string;

    /** 1-based declaration line, when known. */
    line?: number;

    /** The declaration signature: its first line(s) up to the body. */
    signature?: string;

    /** The first sentence of the doc comment above the declaration. */
    doc?: string;

    /** Decorators written on this declaration, when any. */
    decorators?: ISamchonGraphDecorator[];

    /** Assigned implementation span, when source comes from one. */
    implementation?: ISamchonGraphEvidence;

    /** Direct execution dependencies in source order, with edge evidence. */
    calls?: IReference[];

    /** Direct type dependencies in source order, with edge evidence. */
    types?: IReference[];

    /** Concrete nodes that implement or override this interface/base member. */
    implementedBy?: IReference[];

    /**
     * String-literal values found in the declaration signature, such as a union
     * or enum's value set. Returned whole rather than sampled: a symbol's value
     * set is part of its identity, not a slice of its fan-out.
     */
    literals?: string[];

    /**
     * Owned symbol or top-level property outline a consumer reaches for on a
     * container or object-literal variable, without bodies.
     */
    members?: IMember[];

    /** Declaration or implementation citation range, when known. */
    sourceSpan?: Pick<ISamchonGraphEvidence, "file" | "startLine" | "endLine">;

    /** Symbols this node uses (outgoing dependency edges). */
    dependsOn?: IReference[];

    /** Symbols that use this node (incoming dependency edges). */
    dependedOnBy?: IReference[];
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

    /** Decorators written on this member, when any. */
    decorators?: ISamchonGraphDecorator[];
  }

  /** A dependency neighbor of an inspected node and the edge that links them. */
  export interface IReference {
    /** Stable id of the neighboring node. */
    id: string;

    /** Neighbor symbol name, qualified when available. */
    name: string;

    /** Neighbor declaration kind. */
    kind: string;

    /** Project-relative declaration file for the neighbor. */
    file: string;

    /** 1-based declaration line, when known. */
    line?: number;

    /** The edge kind connecting the two (`calls`, `type_ref`, ...). */
    relation: string;

    /**
     * Source span that produced the edge: citation evidence, not a file-read
     * cue.
     */
    evidence?: ISamchonGraphEvidence;
  }
}
