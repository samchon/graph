---
name: documentation
description: Defines public README and maintainer-document structure, source-of-truth boundaries, prose formatting, and voice for @samchon/graph. Use before writing, modifying, renaming, or moving repository Markdown documentation, CLI or MCP examples, benchmark methodology, or language-support instructions.
---

# Documentation

## Public README

The root `README.md` is the canonical public document for package users. Start with what `@samchon/graph` is, the problem it solves, installation, the smallest MCP setup, language-server prerequisites, benchmark evidence, and the common operational path.

Keep public prose direct and practical. Explain internal ranking, protocol, or indexer details only when a user needs them to interpret the contract or benchmark honestly.

`packages/graph/README.md` is ignored and copied from the root during package build. Never edit it directly. If the package copy is stale, rebuild after updating the root source.

## Contract Synchronization

The README embeds and explains the public MCP application contract, and `test_readme_embeds_the_exact_application_contract.ts` guards that relationship. The TypeScript block sourced from `packages/graph/src/structures/ISamchonGraphApplication.ts` must remain byte-for-byte synchronized with the contract region that the test selects. When changing `ISamchonGraphApplication`, request/result unions, tool descriptions, supported languages, CLI forms, or trust claims:

1. Update the owning TypeScript types and JSDoc first.
2. Update the root README's exact contract excerpt and surrounding explanation.
3. Run the focused README contract test and the relevant public-surface tests.

Do not weaken the test, hand-edit generated package output, or leave examples describing a schema the server no longer accepts.

## Maintainer Documents

- `tests/experiment/README.md` explains real-language-server smoke experiments and their external prerequisites.
- `tests/benchmark/README.md` introduces the benchmark architecture and zero-spend versus paid lanes.
- `tests/benchmark/graph/README.md` owns detailed runner flags, reproducibility, and publication acceptance.
- `.agents/skills/` owns agent workflows and durable repository contracts; it points to source and READMEs rather than duplicating them.

Keep one audience and task per document. Put user setup in the root README, experiment operation beside the experiment, and benchmark methodology beside the harness.

## Prose Layout

Preserve the surrounding document's line-wrapping convention. The public README generally keeps prose compact, while maintainer READMEs contain hard-wrapped paragraphs. Do not reflow unrelated paragraphs just to impose a different style, and do not claim a formatter policy the repository does not have.

Keep structural line breaks for headings, paragraphs, list items, tables, block quotes, and fenced code. Verify shell examples from the repository root unless the text explicitly changes directories.

## Voice

Write in the plain, direct voice of the human-authored docs in this repository. Do not write like an AI assistant.

- No emoji or ornamental headings.
- Avoid AI-cliche phrasing such as "let's dive in", "whether you're X or Y", "it's worth noting", and filler adjectives such as "seamless", "powerful", "robust", or "effortless".
- Do not add a wrap-up sentence that merely restates the paragraph. State the fact and stop.
- Distinguish measured evidence from extrapolation. Name the harness, model, corpus, sample count, and limitations for benchmark claims.
