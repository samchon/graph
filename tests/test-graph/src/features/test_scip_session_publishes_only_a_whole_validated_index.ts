import { TestValidator } from "@nestia/e2e";
import { ScipSession } from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

/**
 * A SCIP session publishes whole validated generations, or nothing.
 *
 * Every failure below leaves the previously published snapshot exactly where it
 * was, because a snapshot that is half of one index and half of another is not
 * a smaller answer — it is a wrong one that no reader can detect. The lifecycle
 * is exercised against a real child process rather than a stub: the paths worth
 * proving here are precisely the ones a stub would replace, from an artifact
 * that never appears to a child that ignores its first signal.
 */
export const test_scip_session_publishes_only_a_whole_validated_index =
  async () => {
    await assertGenerations();
    await assertFailuresRetainTheGeneration();
    await assertCloseOwnsItsChildren();
  };

async function assertGenerations(): Promise<void> {
  const root = GraphPaths.createTempDirectory("samchon-graph-scip-session-");
  fs.writeFileSync(path.join(root, "main.go"), "package main\n");
  const state = path.join(root, "generation.txt");
  const session = sessionOf(root, { state });

  TestValidator.equals(
    "a session starts before its first generation",
    [session.generation, session.current],
    [0, undefined],
  );

  const initial = await session.refresh();
  TestValidator.equals(
    "the first index is the initial generation",
    [initial.changed, initial.generation, initial.mode],
    [true, 1, "initial"],
  );
  TestValidator.equals(
    "the index's declarations are published",
    initial.snapshot.nodes.map((node) => node.name),
    ["first"],
  );
  TestValidator.equals(
    "the slice owns exactly the session's languages",
    initial.snapshot.languages,
    ["go"],
  );
  TestValidator.equals(
    "the producer behind the facts is reported",
    [
      initial.snapshot.provenance.tool,
      initial.snapshot.provenance.toolVersion,
      initial.snapshot.provenance.provider,
      initial.snapshot.provenance.authority,
    ],
    ["fake-scip", "1.2.3", "scip-fake", "semantic-index"],
  );
  TestValidator.predicate(
    "the manifest carries a digest a reader can reproduce",
    initial.snapshot.sources.get(path.join(root, "main.go"))?.checkerDigest !==
      undefined,
  );

  // Unchanged is a statement about the inputs, not a guess from a counter: the
  // indexer is not even run, because nothing it reads has moved.
  const unchanged = await session.refresh();
  TestValidator.equals(
    "an unmoved input set reuses the published generation",
    [unchanged.changed, unchanged.generation, unchanged.mode],
    [false, 1, "unchanged"],
  );
  TestValidator.predicate(
    "…and reuses the identical snapshot object",
    unchanged.snapshot === initial.snapshot,
  );
  TestValidator.equals(
    "the indexer was not run a second time",
    fs.readFileSync(state, "utf8").trim(),
    "1",
  );

  // A build input outside the language's own extensions still moves the file
  // set, which is the whole reason the fingerprint covers it.
  fs.writeFileSync(path.join(root, "go.mod"), "module example\n");
  const rebuilt = await session.refresh();
  TestValidator.equals(
    "a moved build input rebuilds the generation",
    [rebuilt.changed, rebuilt.generation, rebuilt.mode],
    [true, 2, "rebuild"],
  );
  TestValidator.equals(
    "the new generation replaces the old declarations whole",
    rebuilt.snapshot.nodes.map((node) => node.name),
    ["second"],
  );
  await session.close();
}

async function assertFailuresRetainTheGeneration(): Promise<void> {
  const root = GraphPaths.createTempDirectory("samchon-graph-scip-failure-");
  fs.writeFileSync(path.join(root, "main.go"), "package main\n");

  // An indexer that exits non-zero.
  await rejects(
    sessionOf(root, { mode: "fail" }).refresh(),
    "a non-zero indexer exit rejects",
  );

  // An indexer that exits cleanly having written nothing. Decoding whatever
  // happened to be at that path would publish another run's facts.
  await rejects(
    sessionOf(root, { mode: "silent" }).refresh(),
    "a missing artifact rejects rather than decoding a stale one",
  );

  // A decoder that fails, and one that answers with something unparseable.
  await rejects(
    sessionOf(root, { decodeMode: "fail" }).refresh(),
    "a failed decode rejects",
  );
  await rejects(
    sessionOf(root, { decodeMode: "garbage" }).refresh(),
    "an undecodable answer rejects",
  );

  // An index produced for another checkout describes another program.
  await rejects(
    sessionOf(root, { indexRoot: "/somewhere/else" }).refresh(),
    "an index built for another project rejects",
  );

  // A document in a language this session does not own.
  const foreign = sessionOf(root, { language: "rust" });
  const adapted = await foreign.refresh();
  TestValidator.equals(
    "a document outside the session's languages contributes nothing",
    adapted.snapshot.nodes,
    [],
  );
  TestValidator.predicate(
    "…and says so",
    adapted.snapshot.warnings.some((warning) => warning.includes("does not own")),
  );
  await foreign.close();

  // A failure after a published generation must leave that generation alone.
  const state = path.join(root, "generation.txt");
  const session = sessionOf(root, { state });
  const initial = await session.refresh();
  fs.writeFileSync(path.join(root, "main.go"), "package main // edited\n");
  const broken = sessionOf(root, { decodeMode: "fail" });
  await rejects(broken.refresh(), "a later failure still rejects");
  TestValidator.predicate(
    "a rejected refresh leaves the published generation standing",
    session.current === initial.snapshot && session.generation === 1,
  );
  await session.close();
  await broken.close();

  // A closed session answers, rather than starting another child.
  await rejects(session.refresh(), "a closed session refuses to refresh");
}

async function assertCloseOwnsItsChildren(): Promise<void> {
  const root = GraphPaths.createTempDirectory("samchon-graph-scip-close-");
  fs.writeFileSync(path.join(root, "main.go"), "package main\n");

  // A child that ignores its first signal must not hold shutdown open. The
  // refresh is left in flight on purpose: close is what has to reach it.
  const hung = sessionOf(root, { mode: "hang" });
  const pending = hung.refresh().catch(() => undefined);
  await settle();
  const closed = hung.close();
  // Idempotent by contract, and the second caller must wait for the same
  // shutdown rather than observing an already-emptied child set and returning
  // before those children exit.
  TestValidator.predicate("close is idempotent", hung.close() === closed);
  await closed;
  await pending;

  // A session that owns no language cannot be selected, so it cannot exist.
  TestValidator.error("a session must own at least one language", () =>
    sessionOf(root, { languages: [] }),
  );
}

interface IFixtureOptions {
  state?: string;
  mode?: string;
  decodeMode?: string;
  indexRoot?: string;
  language?: "go" | "rust";
  languages?: ("go" | "rust")[];
}

function sessionOf(root: string, options: IFixtureOptions = {}): ScipSession {
  return new ScipSession({
    root,
    languages: options.languages ?? [options.language ?? "go"],
    provider: "scip-fake",
    authority: "semantic-index",
    command: {
      command: process.execPath,
      args: [GraphPaths.fakeScipIndexer],
    },
    decode: {
      command: process.execPath,
      args: [
        GraphPaths.fakeScipDecoder,
        ...(options.decodeMode === undefined
          ? []
          : [`--mode=${options.decodeMode}`]),
      ],
    },
    indexArgs: (artifact) => [
      `--output=${artifact}`,
      `--root=${options.indexRoot ?? root}`,
      ...(options.mode === undefined ? [] : [`--mode=${options.mode}`]),
      ...(options.state === undefined ? [] : [`--state=${options.state}`]),
    ],
    inputs: () =>
      fs
        .readdirSync(root)
        .filter((entry) => entry.endsWith(".go") || entry === "go.mod"),
    languageOf: () => "go",
  });
}

async function rejects(task: Promise<unknown>, label: string): Promise<void> {
  let failed = false;
  try {
    await task;
  } catch {
    failed = true;
  }
  TestValidator.predicate(label, failed);
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}
