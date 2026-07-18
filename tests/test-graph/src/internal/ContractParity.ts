import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "./GraphPaths";

/**
 * The executable definition of "this product is a faithful multi-language
 * reproduction of `ITtscGraphApplication`".
 *
 * The product began as a port of the TypeScript-only `@ttsc/graph`. That origin
 * is a contract, not history: the MCP request/result union, the
 * question/draft/review/request workflow, and the audit/next/result output shape
 * must stay structurally identical to the reference, while only the fact-
 * production layer underneath is free to change. Hand comparison cannot hold
 * that line — source, schema, unions, requiredness, and nesting drift
 * independently and silently.
 *
 * The gate is a rewrite, not a diff. Every difference between the reference and
 * this product must be spelled out as a named, reviewed rule; applying those
 * rules to the reference must reproduce this product's contract *exactly*. An
 * exact match means every difference is accounted for. Anything else — a field
 * added here, a union member dropped there, an unreviewed edit, or drift in the
 * reference itself — fails closed, because no rule explains it.
 *
 * Prose is deliberately excluded here. {@link normalize} strips comments so the
 * structural gate cannot be masked by wording, and JSDoc parity is a separate
 * concern with its own reviewed fixture.
 */
export namespace ContractParity {
  /** Where a canonical fixture was derived from. */
  export interface IReference {
    /** The upstream repository the contract was ported from. */
    repository: string;

    /** The exact commit the canonical text was derived from. */
    commit: string;

    /** Directory within the reference repository holding the contract. */
    directory: string;
  }

  /** A checked-in canonical contract, so tests need no second repository. */
  export interface ICanonical {
    reference: IReference;

    /**
     * Contract name to its reference text, at two fidelities.
     *
     * `structure` is comment-stripped: it freezes the request/result shape and
     * fails on a field, union, requiredness, or nesting change. `prose` is the
     * whole file, comments included: it freezes the JSDoc a caller reads and the
     * `@default` values that decide behaviour, so a reworded instruction or a
     * silent default bump — the drift a structure diff cannot see — fails too.
     */
    contracts: Record<string, IContract>;
  }

  /** The reference text of one contract at both fidelities. */
  export interface IContract {
    /** Comment-stripped reference text: the request/result shape. */
    structure: string;

    /** Whole reference text with comments: the JSDoc and `@default` values. */
    prose: string;
  }

  /**
   * One reviewed difference between the reference and this product.
   *
   * `from` and `to` are exact text. A rule that no longer matches is itself a
   * failure: it means the shape it was reviewed against has moved.
   *
   * `layer` says where the rule applies, and the choice follows from a fact about
   * the two texts: prose *contains* structure — it is the same file, comments and
   * all. So a rule that touches a code line (a relocated import, an added
   * vocabulary member) shows up in both texts and is `"both"`, the default. Only
   * a rule that touches a comment — reworded instruction, changed `@default` — is
   * `"prose"`, because the structure text has already dropped the comment it
   * lives in. There is no structure-only rule: a code line is never absent from
   * prose.
   */
  export interface IDeviation {
    /** Why this difference is intentional. */
    reason: string;

    /** Exact reference text. */
    from: string;

    /** Exact text it must become here. */
    to: string;

    /** Which layers the rule applies to. `"both"` unless stated. */
    layer?: "both" | "prose";
  }

  /**
   * Contract name to its file in the reference and its file here.
   *
   * The node/edge vocabulary moved from `structures/` to `typings/` when the
   * product stopped being TypeScript-only, so the two sides are not a pure name
   * substitution and each side names its own path.
   */
  export const CONTRACTS: Record<string, { reference: string; product: string }> = {
    Application: {
      reference: "structures/ITtscGraphApplication.ts",
      product: "structures/ISamchonGraphApplication.ts",
    },
    Decorator: {
      reference: "structures/ITtscGraphDecorator.ts",
      product: "structures/ISamchonGraphDecorator.ts",
    },
    Details: {
      reference: "structures/ITtscGraphDetails.ts",
      product: "structures/ISamchonGraphDetails.ts",
    },
    Dump: {
      reference: "structures/ITtscGraphDump.ts",
      product: "structures/ISamchonGraphDump.ts",
    },
    Edge: {
      reference: "structures/ITtscGraphEdge.ts",
      product: "structures/ISamchonGraphEdge.ts",
    },
    Entrypoints: {
      reference: "structures/ITtscGraphEntrypoints.ts",
      product: "structures/ISamchonGraphEntrypoints.ts",
    },
    Escape: {
      reference: "structures/ITtscGraphEscape.ts",
      product: "structures/ISamchonGraphEscape.ts",
    },
    Evidence: {
      reference: "structures/ITtscGraphEvidence.ts",
      product: "structures/ISamchonGraphEvidence.ts",
    },
    Lookup: {
      reference: "structures/ITtscGraphLookup.ts",
      product: "structures/ISamchonGraphLookup.ts",
    },
    Next: {
      reference: "structures/ITtscGraphNext.ts",
      product: "structures/ISamchonGraphNext.ts",
    },
    Node: {
      reference: "structures/ITtscGraphNode.ts",
      product: "structures/ISamchonGraphNode.ts",
    },
    Overview: {
      reference: "structures/ITtscGraphOverview.ts",
      product: "structures/ISamchonGraphOverview.ts",
    },
    Span: {
      reference: "structures/ITtscGraphSpan.ts",
      product: "structures/ISamchonGraphSpan.ts",
    },
    Tour: {
      reference: "structures/ITtscGraphTour.ts",
      product: "structures/ISamchonGraphTour.ts",
    },
    Trace: {
      reference: "structures/ITtscGraphTrace.ts",
      product: "structures/ISamchonGraphTrace.ts",
    },
    NodeModifier: {
      reference: "structures/TtscGraphNodeModifier.ts",
      product: "structures/SamchonGraphNodeModifier.ts",
    },
    NodeKind: {
      reference: "structures/TtscGraphNodeKind.ts",
      product: "typings/GraphNodeKind.ts",
    },
    EdgeKind: {
      reference: "structures/TtscGraphEdgeKind.ts",
      product: "typings/GraphEdgeKind.ts",
    },
  };

  /**
   * Product identity, applied to the whole reference before anything else.
   *
   * This is the only broad substitution the gate allows, and it renames nothing
   * but the product: a type's prefix, the MCP method. A field, union member,
   * requiredness, or nesting change can never ride this list — those have to be
   * spelled out one at a time in {@link DEVIATIONS}.
   */
  export const IDENTIFIERS: readonly IDeviation[] = [
    {
      reason: "Structure types carry the product prefix.",
      from: "ITtscGraph",
      to: "ISamchonGraph",
    },
    {
      reason: "Vocabulary types carry the product prefix.",
      from: "TtscGraph",
      to: "SamchonGraph",
    },
    {
      reason:
        "The tool is named for what it indexes. The reference indexes only TypeScript; this one indexes sixteen languages, so naming the method for one of them would be untrue.",
      from: "inspect_typescript_graph",
      to: "inspect_code_graph",
    },
  ];

  /**
   * Authority substitutions the whole prose shares.
   *
   * The reference is a TypeScript compiler; this product is a multi-language
   * index, so its instructions must say so — a compiler resolves, an index
   * checks; the reference is TypeScript-specific, this one is language-neutral.
   * These are the product's standing identity, not tied to any one ttsc commit,
   * so they live here as one list rather than being repeated per contract.
   *
   * Applied to prose only — a comment-stripped structure never contains this
   * wording — and applied in order, because a longer phrase must rewrite before
   * the shorter word inside it (`non-TypeScript` before `TypeScript`). What one
   * of these cannot express as a single word or phrase becomes a contract's own
   * reviewed prose deviation in {@link DEVIATIONS}.
   */
  export const PROSE_SUBSTITUTIONS: readonly IDeviation[] = [
    {
      reason:
        "The reference escapes to non-TypeScript files; this product escapes to files outside the languages it indexes.",
      from: "non-TypeScript files",
      to: "files outside the indexed languages",
    },
    {
      reason: "The product names the language a session indexes, not TypeScript.",
      from: "TypeScript",
      to: "__LANG__",
    },
    {
      reason:
        "The reference derives facts from the compiler; this product derives them from its index. The article moves with the noun: `a compiler` becomes `an index`.",
      from: "a compiler-derived",
      to: "an index-derived",
    },
    {
      reason:
        "The reference derives facts from the compiler; this product derives them from its index.",
      from: "compiler-derived",
      to: "index-derived",
    },
    {
      reason:
        "The reference is backed by a compiler; this product is backed by an index.",
      from: "compiler-backed",
      to: "index-backed",
    },
    {
      reason: "A compiler resolves a symbol; an index checks it.",
      from: "the compiler resolved",
      to: "the index resolved",
    },
  ];

  /**
   * Every reviewed difference beyond product identity, per contract.
   *
   * A contract absent from this map must match the reference exactly once
   * identity is substituted. Twelve of the eighteen do: the entire
   * request/output contract is byte-identical, and the multi-language extensions
   * live only in the dump envelope and the node/edge vocabulary. That is the
   * invariant this campaign rests on, so it is worth stating where it is
   * enforced rather than only where it is documented.
   */
  export const DEVIATIONS: Record<string, readonly IDeviation[]> = {
    Dump: [
      {
        reason:
          "The dump gained a language set, an indexer authority, diagnostics, and warnings, so it imports the language vocabulary and the diagnostic structure the reference never needed.",
        from: 'import { ISamchonGraphEdge } from "./ISamchonGraphEdge";',
        to: [
          'import { GraphLanguage } from "../typings/GraphLanguage";',
          'import { ISamchonGraphDiagnostic } from "./ISamchonGraphDiagnostic";',
          'import { ISamchonGraphEdge } from "./ISamchonGraphEdge";',
        ].join("\n"),
      },
      {
        reason:
          "A tsconfig is the TypeScript-only input. A multi-language dump instead names the languages it holds and the strategy that produced them, because a caller cannot judge a fact without knowing what resolved it.",
        from: "tsconfig: string;",
        to: [
          "languages: GraphLanguage[];",
          'indexer: "lsp" | "static" | "hybrid";',
        ].join("\n"),
      },
      {
        reason:
          "A language server has something to say about the source it indexed, and a build can hit non-fatal trouble worth reporting. The reference had neither channel.",
        from: [
          "edges: ISamchonGraphDump.IEdge[];",
          "}",
          "export namespace ISamchonGraphDump {",
        ].join("\n"),
        to: [
          "edges: ISamchonGraphDump.IEdge[];",
          "diagnostics?: ISamchonGraphDiagnostic[];",
          "warnings?: string[];",
          "}",
          "export namespace ISamchonGraphDump {",
        ].join("\n"),
      },
      {
        reason:
          "Formatting only. The shorter product prefix lets the `Omit` fit differently; the declaration is the same.",
        from: [
          "export interface INode extends Omit<",
          "ISamchonGraphNode,",
          '"evidence" | "implementation"',
          "> {",
        ].join("\n"),
        to: [
          "export interface INode",
          'extends Omit<ISamchonGraphNode, "evidence" | "implementation"> {',
        ].join("\n"),
      },
    ],
    Edge: [
      {
        reason:
          "The edge vocabulary is no longer TypeScript-specific, so it moved out of the structures barrel into the shared typings.",
        from: 'import { SamchonGraphEdgeKind } from "./SamchonGraphEdgeKind";',
        to: 'import { GraphEdgeKind } from "../typings/GraphEdgeKind";',
      },
      {
        reason: "Follows the vocabulary relocation.",
        from: "kind: SamchonGraphEdgeKind;",
        to: "kind: GraphEdgeKind;",
      },
    ],
    Node: [
      {
        reason:
          "The node vocabulary moved to the shared typings, and a node now names the language it came from. Both imports sort ahead of the structure imports.",
        from: [
          'import { ISamchonGraphDecorator } from "./ISamchonGraphDecorator";',
          'import { ISamchonGraphEvidence } from "./ISamchonGraphEvidence";',
          'import { SamchonGraphNodeKind } from "./SamchonGraphNodeKind";',
          'import { SamchonGraphNodeModifier } from "./SamchonGraphNodeModifier";',
        ].join("\n"),
        to: [
          'import { GraphLanguage } from "../typings/GraphLanguage";',
          'import { GraphNodeKind } from "../typings/GraphNodeKind";',
          'import { ISamchonGraphDecorator } from "./ISamchonGraphDecorator";',
          'import { ISamchonGraphEvidence } from "./ISamchonGraphEvidence";',
          'import { SamchonGraphNodeModifier } from "./SamchonGraphNodeModifier";',
        ].join("\n"),
      },
      {
        reason:
          "A node carries its language. In a single-language graph the answer was the whole graph's; here two nodes in one dump can disagree.",
        from: "kind: SamchonGraphNodeKind;",
        to: ["kind: GraphNodeKind;", "language: GraphLanguage;"].join("\n"),
      },
    ],
    NodeModifier: [
      {
        reason:
          "C and C++ internal linkage has no TypeScript equivalent: a declaration can be confined to its translation unit, which is a visibility the reference's vocabulary could not express.",
        from: ['| "protected"', '| "optional";'].join("\n"),
        to: ['| "protected"', '| "internal"', '| "optional";'].join("\n"),
      },
    ],
    NodeKind: [
      {
        reason: "Follows the vocabulary relocation to the shared typings.",
        from: "export type SamchonGraphNodeKind =",
        to: "export type GraphNodeKind =",
      },
      {
        reason:
          "Declaration kinds a TypeScript-only vocabulary never needed. TypeScript models both as properties; Java, C#, and their peers distinguish a field from a property, and a constructor from a method.",
        from: ['| "parameter"', '| "external_symbol";'].join("\n"),
        to: [
          '| "parameter"',
          '| "field"',
          '| "constructor"',
          '| "external_symbol";',
        ].join("\n"),
      },
    ],
    EdgeKind: [
      {
        reason: "Follows the vocabulary relocation to the shared typings.",
        from: "export type SamchonGraphEdgeKind =",
        to: "export type GraphEdgeKind =",
      },
      {
        reason:
          "A relationship a language server reports without classifying it further. The compiler-backed reference always knew which kind it was; a generic LSP lane does not, and inventing a stronger kind would overclaim.",
        from: '| "tests";',
        to: ['| "tests"', '| "references";'].join("\n"),
      },
    ],
  };

  /** The two fidelities a contract is frozen at. */
  export type Layer = "structure" | "prose";

  /**
   * Reduce a contract to one fidelity.
   *
   * `structure` strips comments first, so wording can never mask a shape change
   * nor a shape change hide behind reworded prose. `prose` keeps the comments —
   * the JSDoc a caller reads and the `@default` values that decide behaviour are
   * the whole point of that layer. Both trim each line and drop blank lines, so
   * indentation and spacing are never the gate's business; the prose layer folds
   * hard line wrapping too, because where a sentence breaks is a formatter's
   * choice, not a contract, and the reference and this product wrap independently.
   */
  export function normalize(source: string, layer: Layer = "structure"): string {
    if (layer === "structure")
      return source
        .replace(/\r/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .join("\n");
    // Prose keeps every comment; it folds each comment block's internal wrapping
    // first (see below), then trims each line and drops blank lines — so where a
    // sentence wraps and how the file is spaced are never the gate's business,
    // while the words and the `@default` values are.
    return foldCommentWrapping(source.replace(/\r/g, ""))
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .join("\n");
  }

  // Collapse the internal line breaks of one `/** ... */` block to single
  // spaces, so a re-wrapped sentence reads as one line. The `*` margin and the
  // opening/closing fences stay, so a *reworded* sentence still differs — only
  // *where it wraps* is normalized away.
  function foldCommentWrapping(source: string): string {
    return source.replace(/\/\*\*[\s\S]*?\*\//g, (block) =>
      block
        .split("\n")
        .map((line) => line.trim().replace(/^\*\s?/, "").trimEnd())
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    );
  }

  /** Apply one reviewed rule, failing when it no longer matches. */
  export function rewrite(source: string, deviation: IDeviation): string {
    if (!source.includes(deviation.from)) {
      throw new Error(
        `contract parity: a reviewed rule no longer matches the reference.\n` +
          `  reason: ${deviation.reason}\n` +
          `  expected to find:\n${deviation.from}\n` +
          `The reference moved under a rule that was reviewed against its old shape. ` +
          `Re-review the rule rather than deleting it.`,
      );
    }
    return source.split(deviation.from).join(deviation.to);
  }

  /**
   * The contract this product must have, derived from the reference.
   *
   * Identity first, then that contract's own reviewed rules.
   *
   * The two are enforced differently, and the asymmetry is the point. Identity
   * is a blanket product rename: a contract that never mentions the product
   * simply has nothing to rename, so a miss is silence. A reviewed deviation
   * describes one specific shape; if that shape is gone, the review behind it is
   * stale and {@link rewrite} says so rather than quietly producing a contract
   * nobody reviewed.
   */
  export function expected(
    contract: string,
    canonicalText: string,
    layer: Layer = "structure",
  ): string {
    let result: string = canonicalText;
    for (const identifier of IDENTIFIERS)
      result = result.split(identifier.from).join(identifier.to);
    // The authority substitutions are prose's blanket rename, the way the
    // identifiers are structure's: applied everywhere they appear, in order, and
    // only to the prose layer where the wording lives.
    if (layer === "prose")
      for (const sub of PROSE_SUBSTITUTIONS)
        result = result.split(sub.from).join(sub.to);
    // A `"both"` rule names a code line, present in both texts, and runs in
    // either layer. A `"prose"` rule names a comment the structure text has
    // dropped, so it runs only when the prose layer is being built; run against
    // structure it would be a stale-rule failure for a target that is legitimately
    // absent. Every rule still fails closed if its target moved within the layer
    // it does apply to.
    const applies = (deviation: IDeviation): boolean =>
      (deviation.layer ?? "both") === "both" || layer === "prose";
    for (const deviation of DEVIATIONS[contract] ?? [])
      if (applies(deviation)) result = rewrite(result, deviation);
    return result;
  }

  /** This product's actual contract text at one fidelity, read from source. */
  export function actual(contract: string, layer: Layer = "structure"): string {
    const entry = CONTRACTS[contract];
    if (entry === undefined)
      throw new Error(`contract parity: unknown contract ${contract}`);
    return normalize(
      fs.readFileSync(
        path.join(GraphPaths.graphPackageRoot, "src", entry.product),
        "utf8",
      ),
      layer,
    );
  }

  /** The checked-in canonical contract and the commit it came from. */
  export function canonical(): ICanonical {
    return JSON.parse(
      fs.readFileSync(GraphPaths.ttscCanonicalContract, "utf8"),
    ) as ICanonical;
  }
}
