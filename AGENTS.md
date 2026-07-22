# AGENTS.md

`@samchon/graph` is a language-server-backed code graph and MCP server for statically typed compiled languages. It indexes declarations and relationships through real language servers when available, falls back to the separately packaged `@samchon/graph-sitter` best-effort syntax extractor, and exposes the result through the `samchon-graph` CLI, TypeScript API, and one typed MCP tool.

## Attitude

Follow the literal request; it is the contract, not a hint at what the user "really" wants.

- **Scope is the user's to widen.** Reinterpret the goal, weigh alternatives, or expand the task only on an explicit hand-off ("figure it out", "you decide"). Take a confident, specific ask as given.
- **Fidelity binds the goal, not the effort.** Within that goal, act with full initiative: do the substeps it needs, verify the work, and surface relevant consequences. Literal scope is no excuse for passive execution.
- **Match the user's language.** Communicate in English when the user writes in English and in Korean when the user writes in Korean. Switch when the user switches, unless they explicitly request another language.
- **Choose the principled course.** Decide from evidence, correctness, product boundaries, and the durable consequence. Time, difficulty, and consequence surface are reasons to investigate and validate more carefully, never reasons to settle for a shortcut, workaround, or weaker standard.
- **Evidence precedes correction.** Treat reports, review proposals, benchmark claims, and assertions that something is wrong or missing as hypotheses. Verify the real code path, tests, generated artifacts, benchmark trace, upstream behavior, and history before changing behavior.
- **Trace the consequence surface.** A named file or failing case is the starting point, not the investigation boundary. Follow the same cause through LSP and static lanes, resident refreshes, MCP results, CLI behavior, platforms, tests, experiments, and benchmarks, then address the whole verified class of failure within the requested goal.
- **Default to solo campaigns and review.** An issue campaign, Self-Review, and unqualified review are single-agent work. Use agents only when the user explicitly requests a team, parallel, or multi-agent workflow, then load the `multi-agent` skill. The one standing exception is the solo campaign's read-only commit early-warning pass, which that campaign requires on every pushed commit and which reports candidates and decides nothing.
- **Keep solo work in its checkout.** Do not create a clone or worktree for solo work or Self-Review. A worktree belongs only to an explicitly parallel implementation batch and its cleanup.
- **Default over ask.** On an ambiguous detail, pick the sensible default and state it; reserve questions for forks only the user can settle.

## Skills

Durable project conventions and workflows live under `.agents/skills/`. Read the linked skill when its topic applies; each skill indexes its own conditionally needed topic documents.

### Project Outline

Product contract, workspace layout, public boundaries, generated files, and canonical commands: `.agents/skills/project/SKILL.md`.

### Development

Implementation rules, consequence analysis, testing, validation, and change integrity: `.agents/skills/development/SKILL.md`. Read before writing or modifying code.

### Language Support

Keeping the language registry, LSP adapters, static fallback, fixtures, experiments, and documentation synchronized: `.agents/skills/language-support/SKILL.md`. Read before adding or changing a supported language, extension, language server, parser rule, or real-server experiment.

### Documentation

README, maintainer-document, and agent-instruction authoring rules: `.agents/skills/documentation/SKILL.md`. Read before writing or modifying documentation.

### Issue Campaigns

Default solo repository-wide issue discovery, issue adjudication, one integrated implementation pull request per cycle, CI repair, and cleanup: `.agents/skills/issue-campaign/SKILL.md`. Read when the user asks for a broad audit, many issue candidates, or an issue-to-implementation campaign without explicitly requesting parallel agents; do not use it for one already-defined issue.

### Review

Default solo Self-Review, unqualified review, and exhaustive solo issue-discovery rounds: `.agents/skills/review/SKILL.md`. The reviewer inspects the whole declared surface and repeats fresh rounds until a complete pass produces no sound improvement or meaningful issue candidate.

### Multi-Agent Workflows

Explicitly parallel review and issue-campaign variants: `.agents/skills/multi-agent/SKILL.md`. Read it only when the user explicitly asks for a team, parallel, or multi-agent workflow. Multi-agent issue campaigns parallelize discovery and implementation by default; use solo implementation only when the user explicitly requests parallel discovery alone.

### Discussion

Structured multi-agent topic discussion with persistent research notes and transcripts: `.agents/skills/discussion/SKILL.md`. Read only when the user explicitly asks for a discussion; review and issue discovery do not imply discussion.

### Pull Request Submission

Branch, commit, pull-request, check, and merge flow: `.agents/skills/pull-request/SKILL.md`. Read when the user explicitly asks to open, submit, update, or merge a pull request, or when a standing autonomous mandate authorizes end-to-end delivery; never open, push, or merge on unprompted initiative.

### Benchmark

Benchmark runners, fixture isolation, trace audits, measurement integrity, and publication: `.agents/skills/benchmark/SKILL.md`. This repository has no benchmark-campaign workflow. Read it before running, modifying, or publishing benchmark results.

## Maintenance

### Writing style

`AGENTS.md` and `SKILL.md` files are read by humans as well as agents. Read the documentation skill before editing either; it defines concise, clear operational writing and prose-layout rules.

### AGENTS.md

This is the repository's shared entry point for coding agents. Keep it to the brief product identity, global attitude, and skill index. The H2s are `## Attitude`, `## Skills`, and `## Maintenance`; `## Attitude` is the one place global agent-behavior rules live.

Update AGENTS.md only for repository-contract changes: a new skill area, a renamed or merged skill, a workflow that no longer fits an existing skill, a release-process change, or a coding-agent rule that applies globally before any skill loads.

### Skills

- **Location.** `.agents/skills/<kebab-name>/SKILL.md`. No numeric prefix. Each file opens with YAML frontmatter whose `name` matches the directory and whose third-person `description` states the complete trigger contract, including exclusions.
- **Core in SKILL.md, conditional topics as sibling documents.** Keep always-applicable procedure in SKILL.md. Move a topic needed only under a specific condition to a one-level-deep sibling document and link it with that read condition.
- **Two trigger surfaces, one scope.** The frontmatter description is the full trigger contract. The AGENTS.md pointer mirrors that scope more briefly. Correct the frontmatter first when the scope changes.
- **Create or merge.** Add a skill when a substantial repository concern would otherwise inflate AGENTS.md beyond an index. Merge sibling concerns when they share most of their structure.
- **Headings are plain.** Do not number skill or AGENTS.md headings. Use descriptive titles.
- **Current set.** The repository skills are `project`, `development`, `language-support`, `documentation`, `issue-campaign`, `review`, `multi-agent`, `discussion`, `pull-request`, and `benchmark`.
