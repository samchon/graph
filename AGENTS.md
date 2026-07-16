# AGENTS.md

`@samchon/graph` is a language-server-backed code graph and MCP server for statically typed compiled languages. It indexes declarations and relationships through real language servers when available, falls back to the separately packaged `@samchon/graph-sitter` best-effort syntax extractor, and exposes the result through the `samchon-graph` CLI, TypeScript API, and one typed MCP tool.

## Attitude

Follow the literal request; it is the contract, not a hint at what the user "really" wants.

- **Scope is the user's to widen.** Reinterpret the goal, weigh alternatives, or expand the task only on an explicit hand-off ("figure it out", "you decide"). Take a confident, specific ask as given.
- **Fidelity binds the goal, not the effort.** Within that goal, act with full initiative: do the substeps it needs, verify the work, and surface relevant consequences.
- **Evidence precedes correction.** Treat reports, review proposals, benchmark claims, and assertions that something is wrong or missing as hypotheses. Verify the real code path, tests, generated artifacts, benchmark trace, upstream behavior, and history before changing behavior.
- **Trace the consequence surface.** A named file or failing case is the starting point, not the investigation boundary. Follow the same cause through LSP and static lanes, resident refreshes, MCP results, CLI behavior, platforms, tests, experiments, and benchmarks, then address the whole verified class of failure within the requested goal.
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

README and maintainer-document authoring rules: `.agents/skills/documentation/SKILL.md`. Read before writing or modifying documentation.

### Issue Campaigns

Repository-wide issue discovery, lead-verified issue writing, dependency-batched implementation, and cleanup: `.agents/skills/issue-campaign/SKILL.md`. Read when the user asks for a broad audit, many issue candidates, or an issue-to-implementation campaign; do not use it for one already-defined issue.

### Review

Solo review, team Review Cycle, research review, and exhaustive issue-discovery rounds: `.agents/skills/review/SKILL.md`. Every reviewer inspects the whole declared surface independently, and rounds continue until a complete pass produces no sound improvement or meaningful issue candidate. Self-Review and any unqualified review request are always solo.

### Discussion

Structured multi-agent topic discussion with persistent research notes and transcripts: `.agents/skills/discussion/SKILL.md`. Read only when the user explicitly asks for a discussion; review and issue discovery do not imply discussion.

### Pull Request Submission

Branch, commit, pull-request, check, and merge flow: `.agents/skills/pull-request/SKILL.md`. Read when the user explicitly asks to open, submit, update, or merge a pull request, or when a standing autonomous mandate authorizes end-to-end delivery; never open, push, or merge on unprompted initiative.

### Benchmark

Benchmark runners, fixture isolation, trace audits, measurement integrity, and publication: `.agents/skills/benchmark/SKILL.md`. Read before running, modifying, or publishing benchmark results.

## Maintenance

### Writing style

AGENTS.md and SKILL.md files are read by humans as well as agents.

- **Optimize for comprehension, not minimum length.** A shorter document that forces the reader to infer prerequisites, reasons, exceptions, or stop conditions is not concise. Add the context needed to execute correctly.
- **Remove repetition, not substance.** State a rule once at its owner and link to it elsewhere. Keep the rationale when it prevents a plausible mistake.
- **Give each paragraph one job.** Split purpose, rule, rationale, procedure, and consequence when combining them would make the reader unpack a dense block.
- **Use structure as compression.** Use numbered lists for ordered procedures, bullets for choices or checklists, tables for repeated mappings, and code blocks for exact commands. Do not hide a workflow inside one long sentence.
- **State the rule before its reason.** Use negative phrasing only for a named failure mode that the affirmative rule does not already exclude.
- **Skills point, not paraphrase.** Do not restate what READMEs, source comments, or benchmark manifests already say; link to them.
- **Preserve local prose layout.** Do not hard-wrap or unwrap unrelated paragraphs while editing a document. Follow the surrounding file unless the task explicitly changes formatting policy.

### AGENTS.md

This is the repository's shared entry point for coding agents. Keep it to the brief product identity, global attitude, and skill index. The H2s are `## Attitude`, `## Skills`, and `## Maintenance`; `## Attitude` is the one place global agent-behavior rules live.

Update AGENTS.md only for repository-contract changes: a new skill area, a renamed or merged skill, a workflow that no longer fits an existing skill, a release-process change, or a coding-agent rule that applies globally before any skill loads.

### Skills

- **Location.** `.agents/skills/<kebab-name>/SKILL.md`. No numeric prefix. Each file opens with YAML frontmatter whose `name` matches the directory and whose third-person `description` states the complete trigger contract, including exclusions.
- **Core in SKILL.md, conditional topics as sibling documents.** Keep always-applicable procedure in SKILL.md. Move a topic needed only under a specific condition to a one-level-deep sibling document and link it with that read condition.
- **Two trigger surfaces, one scope.** The frontmatter description is the full trigger contract. The AGENTS.md pointer mirrors that scope more briefly. Correct the frontmatter first when the scope changes.
- **Create or merge.** Add a skill when a substantial repository concern would otherwise inflate AGENTS.md beyond an index. Merge sibling concerns when they share most of their structure.
- **Headings are plain.** Do not number skill or AGENTS.md headings. Use descriptive titles.
- **Current set.** The repository skills are `project`, `development`, `language-support`, `documentation`, `issue-campaign`, `review`, `discussion`, `pull-request`, and `benchmark`.
