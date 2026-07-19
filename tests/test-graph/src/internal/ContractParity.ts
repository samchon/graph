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
 * The two fidelities stay separate. {@link normalize} strips comments for the
 * structural gate so wording cannot mask a shape change, while the prose gate
 * keeps JSDoc and defaults and applies only explicitly prose-scoped rules.
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

    /** Exact number of reference occurrences this rule reviewed. @default 1 */
    occurrences?: number;
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
   * This is the only broad structural substitution the gate allows, and it
   * renames nothing but the product: a type's prefix, the MCP method. A field,
   * union member, requiredness, or nesting change can never ride this list —
   * those have to be spelled out one at a time in {@link DEVIATIONS}. Prose has
   * its separate authority vocabulary in {@link PROSE_SUBSTITUTIONS}.
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
        "The reference's graph is built by the compiler; this product's is built by its index. The article moves with the noun, exactly as for the `-derived` form above.",
      from: "a compiler-built",
      to: "an index-built",
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
    {
      reason:
        "`checker` and `compiler` are the reference's two names for the one resolving authority; where it resolved a symbol, this product's index checked it. Sibling of the `compiler resolved` rewrite above.",
      from: "the checker resolved",
      to: "the index resolved",
    },
  ];

  // The reference's dump now embeds proof for one TypeScript Program. This
  // product already consumes that proof at the strict-provider boundary, but
  // its public dump can combine several providers and cannot truthfully present
  // one provider's universe as authority for all languages. Issue #66 owns the
  // provider registry and the eventual multi-provider public provenance shape.
  //
  // These constants keep the temporary omission exact at both fidelities. The
  // prose rule first reduces the reviewed comment-bearing block to the same
  // code-only text the structure layer sees; the following ordinary rule then
  // removes that exact text from both. Any upstream field or wording change
  // makes one of the two replacements stale instead of broadening the omission.
  const DUMP_METADATA_STRUCTURE: string = [
    "provenance: ISamchonGraphDump.IProvenance;",
    "diagnostics: ISamchonGraphDump.IDiagnostic[];",
  ].join("\n").concat("\n");

  const DUMP_METADATA_PROSE: string = [
    "/** Evidence about the one program that produced everything below. */",
    "provenance: ISamchonGraphDump.IProvenance;",
    "/** The compiler's findings for the same generation that produced the facts. Empty means the program reported none. It does not mean they were not collected — `provenance.capabilities` is what says whether they were. */",
    "diagnostics: ISamchonGraphDump.IDiagnostic[];",
  ].join("\n").concat("\n");

  const DUMP_PROVENANCE_STRUCTURE: string = [
    "export interface IProvenance {",
    "schemaVersion: number;",
    "capabilities: string[];",
    "producer: IProducer;",
    "universe: IUniverse;",
    "sources: ISourceDigest[];",
    "}",
    "export interface IProducer {",
    "tool: string;",
    "version: string;",
    "typescript: string;",
    "}",
    "export interface IUniverse {",
    "configs: IFileDigest[];",
    "roots: IRootFile[];",
    "}",
    "export interface IRootFile {",
    "config: string;",
    "file: string;",
    "}",
    "export interface IFileDigest {",
    "file: string;",
    "digest: string;",
    "}",
    "export interface ISourceDigest {",
    "file: string;",
    "checkerDigest: string;",
    "diskDigest: string;",
    "}",
    "export interface IDiagnostic {",
    "file: string;",
    "line: number;",
    "column: number;",
    "code: number;",
    'category: "error" | "warning";',
    "message: string;",
    "}",
  ].join("\n").concat("\n");

  const DUMP_PROVENANCE_PROSE: string = [
    "/** What a snapshot knows about its own origin. The graph's claim is that its nodes, edges, spans, and diagnostics all came from one `Program`. Without this the claim is unprovable from the response: a consumer could only re-read the disk afterwards and hope nothing moved, which is not sound — a write that lands and reverts in between is invisible to it, and a re-read proves what the disk says now, never what the index resolved against. This carries no source text. A digest is the opposite of inlining: it is what lets a consumer prove byte-identity against text it read itself, without the graph ever shipping that text. */",
    "export interface IProvenance {",
    "/** The dump body's schema version, moved when a field is added, removed, or redefined. Independent of the serve protocol's version: a dump written to a file has a schema but never rode the protocol. */",
    "schemaVersion: number;",
    "/** What this snapshot proves. A consumer degrades against this rather than guessing from a field's emptiness, because an empty list and an uncollected one look identical on the wire. The known members are `universe`, `sourceDigests`, `diskDigests`, and `diagnostics`. The type stays `string[]` rather than a union of those on purpose: a union would make `typia.assert` reject a newer producer for naming a capability this client has not heard of, turning \"proves more than you know about\" into a hard failure. An unknown capability is exactly the case a consumer should ignore. */",
    "capabilities: string[];",
    "/** What built the snapshot. */",
    "producer: IProducer;",
    "/** The inputs that decide which files are in the program at all. */",
    "universe: IUniverse;",
    "/** One entry per file the program loaded, ordered by file. */",
    "sources: ISourceDigest[];",
    "}",
    "/** Identifies the binary and the checker behind the facts. `tool` and `version` are separate because more than one binary can produce a dump and they do not share a version line — the shipped `ttscgraph` is stamped at release, the internal viewer tool is not versioned at all — so folding the name in would hand a consumer that parses a version a tool name. */",
    "export interface IProducer {",
    "/** The producing binary's name, such as `ttscgraph`. */",
    "tool: string;",
    '/** The producing binary\'s build version, as its `--version` prints it. A local build reports the dev placeholder; a tool that carries no version reports `""`. */',
    "version: string;",
    "/** The __LANG__ version typescript-go implements. */",
    "typescript: string;",
    "}",
    "/** The build universe: the inputs that decide which files the program contains, as opposed to what is inside them. A change to any of them can add or drop whole files, so a consumer reusing facts across snapshots must treat a universe change as invalidating everything. */",
    "export interface IUniverse {",
    "/** The tsconfig chain — the project's config and everything it extends. It stays an input regardless of what any source contains: compiler options change the meaning of code the checker resolves without any source file changing. */",
    "configs: IFileDigest[];",
    "/** The resolved root file set, one entry per (config, file) pair. A root a config names but that does not exist is still listed: its absence is part of the fingerprint, and creating it later changes the program. */",
    "roots: IRootFile[];",
    "}",
    "/** A root file attributed to the config that named it. */",
    "export interface IRootFile {",
    "/** The tsconfig that named this root, project-relative. */",
    "config: string;",
    "/** The root file, project-relative. */",
    "file: string;",
    "}",
    "/** A file and the hex-encoded SHA-256 of its on-disk bytes. */",
    "export interface IFileDigest {",
    "/** Project-relative. */",
    "file: string;",
    "/** Hex-encoded SHA-256. */",
    "digest: string;",
    "}",
    '/** The manifest entry for one source file the program loaded. Two digests, because "the bytes the checker read" and "the bytes on disk" are not always the same string and a consumer needs to know which one it compares against. They diverge when a source-preamble plugin injects text ahead of the file before tsgo parses it, which a real plugin project does on every build. */',
    "export interface ISourceDigest {",
    "/** Project-relative. */",
    "file: string;",
    "/** Hex-encoded SHA-256 of the text the index resolved against — the ground truth for the facts. Every node, edge, and span attributed to this file was computed from these bytes. */",
    "checkerDigest: string;",
    '/** Hex-encoded SHA-256 of the file\'s on-disk bytes at snapshot time, or `""` when it could not be read: it vanished mid-load, or it is a virtual source with no on-disk identity. This is the one a consumer that opens the file itself can reproduce. When it equals `checkerDigest`, a matching read proves byte-identity with the facts. When it does not, the checker saw augmented text and that proof is simply not available for this file — which is a thing to report, not to paper over. Read it only when `provenance.capabilities` lists `diskDigests`. Without that claim every one of these is empty because the producer never hashed the disk, which is a different fact from a file that could not be read. */',
    "diskDigest: string;",
    "}",
    "/** One compiler diagnostic from the generation that produced the facts. */",
    "export interface IDiagnostic {",
    "/** Project-relative. */",
    "file: string;",
    "/** 1-based line. */",
    "line: number;",
    "/** 1-based column. */",
    "column: number;",
    "/** The __LANG__ diagnostic code, such as 2322. */",
    "code: number;",
    "/** Whether the finding fails a build. */",
    'category: "error" | "warning";',
    "/** The diagnostic text, without the code prefix. */",
    "message: string;",
    "}",
  ].join("\n").concat("\n");

  /**
   * Every reviewed difference beyond product identity, per contract.
   *
   * A contract absent from this map must match both fidelities exactly once the
   * blanket identity and authority substitutions are applied. At the structure
   * layer, twelve of the eighteen contracts match exactly; four of those carry
   * prose-only rules here. The structural multi-language extensions remain
   * confined to the dump envelope and node/edge vocabulary. That is the invariant
   * this campaign rests on, so it is worth stating where it is enforced rather
   * than only where it is documented.
   */
  export const DEVIATIONS: Record<string, readonly IDeviation[]> = {
    // The tool's own instruction manual. Structurally the request/output shape is
    // byte-identical to the reference, but the JSDoc a caller reads is rewritten
    // throughout for an index: a compiler resolves-and-verifies a fact, the index
    // checks it; the reference's audit names a type-checked program, this one names
    // the LSP/static/hybrid index that built the snapshot. A handful of edits carry
    // no such authority — they only trim or reword an unchanged meaning; each says
    // so in its reason rather than borrowing an authority it does not have.
    Application: [
      {
        reason:
          "The compiler resolves a fact and verifies it; the index checks it. The same guarantee, named for the authority that gives it.",
        layer: "prose",
        from: "is compiler-resolved and verified for the snapshot",
        to: "is checked against the index for the snapshot",
      },
      {
        reason:
          "A compiler verifies; an index checks. The facts under a ranked shortlist stay checked — only the selection around them is heuristic.",
        layer: "prose",
        from: "the facts stay verified but the selection",
        to: "the facts stay checked but the selection",
      },
      {
        reason:
          "The compiler resolves-and-verifies; the index checks against the snapshot its `audit` names. The `named by audit` clause is pulled forward here so the later sentence need not repeat it.",
        layer: "prose",
        from: "every returned fact is compiler-resolved and verified. Never use",
        to: "every returned fact has been checked against the index named by `audit`. Never use",
      },
      {
        reason:
          "A compiler resolves each fact to its type-checked program; this product checks it against the current index. The reference's `and audit says so on every result` is dropped because the opening sentence already named the index as the one `audit` names.",
        layer: "prose",
        from: "The server resolved each one to the type-checked program for the snapshot the call synced to, and `audit` says so on every result.",
        to: "The server checked each one against the current index for the snapshot the call synced to.",
      },
      {
        reason:
          "No authority: `Selection is the separate question` is trimmed to `Selection is separate`, with no change of meaning.",
        layer: "prose",
        from: "Selection is the separate question.",
        to: "Selection is separate.",
      },
      {
        reason:
          "A compiler verifies; an index checks. `are still` becomes `stay` to read alongside the other `stay checked` above.",
        layer: "prose",
        from: "their facts are still verified, but whether",
        to: "their facts stay checked, but whether",
      },
      {
        reason: "A compiler resolves a fact; an index checks it.",
        layer: "prose",
        from: "re-confirming a fact the graph already resolved is not.",
        to: "re-confirming a fact the graph already checked is not.",
      },
      {
        reason: "A compiler resolves a fact; an index has already checked it.",
        layer: "prose",
        from: "do not re-confirm what the graph resolved.",
        to: "do not re-confirm what the graph already checked.",
      },
      {
        reason:
          "There is no compiler to own the index; the repository's own program index answers the question.",
        layer: "prose",
        from: "Answer a __LANG__ question from the compiler's own index of this repository.",
        to: "Answer a __LANG__ question from this repository's own program index.",
      },
      {
        reason:
          "The checker's resolution, audited, becomes a check against the index — the product has a checker nowhere, an index everywhere.",
        layer: "prose",
        from: "Every fact in a result is the checker's own resolution, audited before return, so no fact needs verifying",
        to: "Every fact in a result is checked against the index before return, so no fact needs verifying",
      },
      {
        reason:
          "No authority: the sentence is reworded with no change of meaning (a comma becomes `or`, `in` becomes `inside`).",
        layer: "prose",
        from: "Read a file for what the graph does not carry: a body, the text in a span.",
        to: "Read a file for what the graph does not carry: a body or the text inside a span.",
      },
      {
        reason:
          "The `audit` string is what the server actually returns, and this product's differs: it names the LSP, static, or hybrid index that built the snapshot rather than a type-checked program the reference's checker resolved every fact to.",
        layer: "prose",
        from: "What the server audited this result against before returning it, in its own words: every node, span, edge, signature, member, and step in it resolves to the type-checked program for the snapshot the call synced to, so opening a file it cites only returns a fact already in it.",
        to: "What the server checked this result against before returning it, in its own words. The audit names the LSP, static, or hybrid index that built the current snapshot.",
      },
      {
        reason:
          "The operation-aware audit says the same thing with the product's actual compact wording: a walk returns the held structure for its named handles, and details splits whole identity from sliced fan-out.",
        layer: "prose",
        from: "For the walks from a named handle (`trace`, `overview`) it reports the result as the structure the graph holds, bounded where `truncated` says. For `details` it reports the two halves of a resolved symbol: its own shape returned whole, its fan-out returned as a slice with `trace` for the rest.",
        to: "For the walks from a named handle (`trace`, `overview`) it reports the structure held for the named handles, bounded where `truncated` says. For `details` it reports the two halves of a resolved symbol: its own shape returned whole, its fan-out returned as a slice with `trace` for the rest.",
      },
      {
        reason:
          "Documents this product's real ranked-operation `audit` string: the facts are checked rather than verified (authority), and the rest is reworded with no change of meaning (`the caller's` becomes `yours`).",
        layer: "prose",
        from: "For the ranked operations (`lookup`, `entrypoints`, `tour`) it adds that the selection is heuristic — matched, scored, ranked, and limited against the question — so the facts are verified but the shortlist's coverage is the caller's to judge.",
        to: "For ranked operations (`lookup`, `entrypoints`, `tour`) it additionally says that selection was matched, scored, ranked, and limited against the question, so the facts are checked but shortlist coverage is yours to judge.",
      },
    ],
    Details: [
      {
        reason:
          "The multi-language product names the active provider rather than claiming every lane has TypeScript-checker authority; unproved enumerable sets remain absent.",
        layer: "prose",
        from: "/** The complete value set a type alias or enum admits, in __LANG__ source form (`\"a\"`, `1`, `true`, `null`) — the checker's resolved union members, not the quoted tokens that happened to fit in `signature`. Absent when the type has no enumerable value set. A `signature` is capped at the declaration head, so for a union or enum written across several lines this is the field that carries the members. */",
        to: "/** The complete value set a type alias or enum admits, in __LANG__ source form (`\"a\"`, `1`, `true`, `null`) — the provider-resolved union members, not quoted tokens scraped from `signature`. Absent when the active index cannot prove an enumerable value set. */",
      },
    ],
    Trace: [
      {
        reason:
          "Path mode now reports bounded depth and dispatch-hub omissions instead of falsely proving that no connection exists, so truncation applies to both trace forms.",
        layer: "prose",
        from: "/** In an open trace, true when a bound omitted an eligible node or hop. */",
        to: "/** True when a walk or path-search bound omitted an eligible node or hop. */",
      },
    ],
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
          "The reference proves one TypeScript Program. The public multi-language dump cannot present one provider's proof as authority for every language; #66 owns the provider registry and its eventual public provenance shape. Reduce the reviewed prose block to its code before removing the same exact structure at both fidelities.",
        layer: "prose",
        from: DUMP_METADATA_PROSE,
        to: DUMP_METADATA_STRUCTURE,
      },
      {
        reason:
          "The single-program provenance and its compiler-only diagnostic row are provider-boundary facts today, not claims of the combined public dump. #66 must replace this omission with a multi-provider registry rather than reusing the TypeScript shape.",
        from: DUMP_METADATA_STRUCTURE,
        to: "",
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
          "The omitted top-level single-program proof leaves its TypeScript-only namespace unused. Reduce its exact reviewed prose to the structure text so the next rule removes the same block at both fidelities without hiding upstream drift.",
        layer: "prose",
        from: DUMP_PROVENANCE_PROSE,
        to: DUMP_PROVENANCE_STRUCTURE,
      },
      {
        reason:
          "These helper types describe only the omitted one-Program provenance and diagnostics contract. #66 will define the product's non-empty provider-set provenance instead of exporting dead TypeScript-only helpers.",
        from: DUMP_PROVENANCE_STRUCTURE,
        to: "",
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
      {
        reason:
          "The CLI is named for the product, the fact-builder is no longer a separate Go program but this product's indexer, and a multi-language engine cannot name one language: `__LANG__ graph engine` becomes `code graph engine`.",
        layer: "prose",
        from: "The whole-graph export `ttscgraph dump` writes and the MCP server loads — the wire contract between the Go fact-builder and the __LANG__ graph engine.",
        to: "The whole-graph export `samchon-graph dump` writes and the MCP server loads — the wire contract between the indexer and the code graph engine.",
      },
      {
        reason:
          "The reference's one Program can make one provenance claim for the entire dump. The combined public dump cannot make that claim until #66 represents every contributing provider and build universe.",
        layer: "prose",
        from: "every node and edge the build resolved, plus the `provenance` that says which program resolved them.",
        to: "every node and edge the build resolved.",
      },
      {
        reason:
          "The reference's snapshot is a native (Go) artifact; this product's is just the snapshot the indexer parses.",
        layer: "prose",
        from: "The server parses each changed native snapshot",
        to: "The server parses each changed snapshot",
      },
      {
        reason:
          "No authority: the reference closes on its bundled 3D viewer; this product documents its own dump invariant instead — a deterministic, timestamp-free function of the source, which is a closed product decision, not a compiler-vs-index difference.",
        layer: "prose",
        from: "while project inputs stay unchanged; the bundled 3D viewer reduces the same dump.",
        to: "while project inputs stay unchanged. It is a pure function of its source: two dumps of the same unedited checkout are byte-identical, so a graph can be cached, diffed, and trusted. Nothing here records when it was built — a timestamp would move under an unchanged source, which is exactly the property a cache and a diff depend on.",
      },
      {
        reason:
          "The product's public dump has no single TypeScript config or provenance manifest; it names only the project-relative graph and generic diagnostic paths shared by every indexing lane.",
        layer: "prose",
        from: "`project` is absolute. Every other path is relative to it — `tsconfig`, and the `file` fields on nodes, edges, diagnostics, and the provenance manifest. Two kinds of path fall outside the project and so cannot be relative to it: a dependency keeps its `node_modules/`-relative tail, which is what makes a dependency leaf readable, and anything else the compiler loaded keeps the identity the compiler gave it — a virtual lib stays `bundled:///…`.",
        to: "Paths in `project` are absolute; `file` fields on nodes, edges, and diagnostics are project-relative.",
      },
      {
        reason:
          "The `tsconfig`-to-`languages`/`indexer` swap above is a code rule the structure layer sees; each new field's JSDoc, which that layer drops, is documented here.",
        layer: "prose",
        from: [
          '/** The tsconfig the program was loaded from, relative to `project`. */',
          "languages: GraphLanguage[];",
          'indexer: "lsp" | "static" | "hybrid";',
        ].join("\n"),
        to: [
          "/** The source languages present in this dump. */",
          "languages: GraphLanguage[];",
          "/** Which indexing strategy produced the graph. */",
          'indexer: "lsp" | "static" | "hybrid";',
        ].join("\n"),
      },
      {
        reason:
          "The `diagnostics` and `warnings` additions above are code rules; their JSDoc lives only in the prose layer.",
        layer: "prose",
        from: [
          "edges: ISamchonGraphDump.IEdge[];",
          "diagnostics?: ISamchonGraphDiagnostic[];",
          "warnings?: string[];",
        ].join("\n"),
        to: [
          "edges: ISamchonGraphDump.IEdge[];",
          "/** What the language server said about the source while it indexed it. Absent when the dump was built without one — a static parse has nobody to ask. */",
          "diagnostics?: ISamchonGraphDiagnostic[];",
          "/** Non-fatal problems encountered while building the graph. */",
          "warnings?: string[];",
        ].join("\n"),
      },
      {
        reason:
          "The node/edge wire rows are emitted by this product's indexer, not the reference's separate builder process. Applies to both the `INode` and `IEdge` namespace docs.",
        layer: "prose",
        from: "the builder sends it",
        to: "the indexer sends it",
        occurrences: 2,
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
      {
        reason:
          "A compiler resolves every edge, so the reference can call the whole graph a single checker-resolved fact. This product's edges are resolved by whichever index built the graph, so the graph is one kind of fact and each result's `audit` names which kind.",
        layer: "prose",
        from: "Every edge is compiler-resolved, so there is no per-edge trust flag: the whole graph is checker-resolved fact.",
        to: "Every edge is resolved by the index that built the graph, so there is no per-edge trust flag: the whole graph is one kind of fact, and a result's `audit` names which kind.",
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
      {
        reason:
          "The `language` field the rule above added is a code line the structure layer sees; its JSDoc, which that layer drops, is documented here. Runs after that rule, on the line it produced.",
        layer: "prose",
        from: "language: GraphLanguage;",
        to: [
          "/** The source language this node was declared in. */",
          "language: GraphLanguage;",
        ].join("\n"),
      },
      {
        reason:
          "No authority: the example is reworded with no change of meaning (indefinite articles added before `Prisma client` and `codegen output`).",
        layer: "prose",
        from: "git-ignored generated code (Prisma client, codegen output)",
        to: "git-ignored generated code (a Prisma client, a codegen output)",
      },
      {
        reason:
          "Enum members keep producer order, but the producer may be a compiler, language server, or static index rather than a TypeScript checker.",
        layer: "prose",
        from: "in checker order",
        to: "in index order",
      },
      {
        reason:
          "The index is the product-wide authority that attempts constant folding; not every supported language uses a checker.",
        layer: "prose",
        from: "the checker could not fold",
        to: "the index could not fold",
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
      {
        reason:
          "Follows the enum extension above: the symbol kinds now run `file` through `constructor`, not `file` through `parameter`, because `field` and `constructor` were added after `parameter`.",
        layer: "prose",
        from: "`file` through `parameter`",
        to: "`file` through `constructor`",
      },
      {
        reason:
          "The reference's TypeScript program owns the declarations and its checker resolves them; this product's language server both owns and resolves them.",
        layer: "prose",
        from: "declarations the __LANG__ program owns and the checker resolves",
        to: "declarations the language server owns and resolves",
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
      {
        reason:
          "The reference's checker resolves the value and type edges and the dispatch target; this product's language server does. `the checker` appears twice in this doc, both times the language server.",
        layer: "prose",
        from: "the checker",
        to: "the language server",
        occurrences: 2,
      },
      {
        reason:
          "JSX is a TypeScript/React form; this product indexes many languages, so `renders` names a generic component use, not a JSX one.",
        layer: "prose",
        from: "`renders` is a JSX component use",
        to: "`renders` is a component use",
      },
    ],
    Span: [
      {
        reason:
          "The reference's wire shape sits between its Go builder and the loader; this product's sits between its indexer and the loader.",
        layer: "prose",
        from: "This shape exists only between the Go builder and the loader.",
        to: "This shape exists only between the indexer and the loader.",
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
        .map((line) => {
          const trimmed: string = line.trim();
          return trimmed === "*/"
            ? trimmed
            : trimmed.replace(/^\*\s?/, "").trimEnd();
        })
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    );
  }

  /** Apply one reviewed rule, failing when it no longer matches. */
  export function rewrite(source: string, deviation: IDeviation): string {
    const expectedOccurrences: number = deviation.occurrences ?? 1;
    const actualOccurrences: number = source.split(deviation.from).length - 1;
    if (actualOccurrences !== expectedOccurrences) {
      throw new Error(
        `contract parity: a reviewed rule no longer matches the reference.\n` +
          `  reason: ${deviation.reason}\n` +
          `  expected ${expectedOccurrences} occurrence(s), found ${actualOccurrences}:\n${deviation.from}\n` +
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
