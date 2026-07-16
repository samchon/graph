---
name: discussion
description: Runs structured multi-agent discussions for open-ended @samchon/graph topics. Use only when the user explicitly asks for a Discussion or team debate with transcripts and conclusions; do not use for Self-Review, Review Cycle, research review, issue discovery, or implementation.
---

# Discussion

Discussion explores a topic without changing code or turning the exchange into a review queue. Reviews and issue discovery use the review skill instead.

## Team

Form the largest practical team within the available concurrency. Give every participant a self-contained brief with the topic, constraints, known evidence, output expectations, and the exact repository instructions and skills to read. Do not give a preferred conclusion or divide the topic into assigned slices.

## Knowledge Base

Create `.discussions/<topic>/` with a short filesystem-safe name. Do not delete or overwrite an existing discussion directory unless the user explicitly requests it.

Each participant maintains a personal wiki-style subdirectory under the topic directory. Participants read the live transcript and one another's statements between turns, continue researching, and revise their own notes.

## Transcript

Run three unrestricted transcript rounds as `round1.md`, `round2.md`, and `round3.md`. The lead moderates and records every statement in speaking order as a live transcript, not a retrospective summary. Do not narrow the topic unless the user does.

After `round3.md`, the lead writes agreed conclusions, disagreements, and major open points to `summary.md`, reports the result, and waits. Discussion does not authorize implementation or remote actions.
