import { TestValidator } from "@nestia/e2e";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildLspGraph } from "../../../../packages/graph/src/indexer/buildLspGraph";
import { TtscGraphClient } from "../../../../packages/graph/src/provider/ttscgraph/TtscGraphClient";
import { ttscGraphStrictRefusal } from "../../../../packages/graph/src/provider/ttscgraph/ttscGraphStrictRefusal";
import { GraphPaths } from "../internal/GraphPaths";

/**
 * The snapshot proves its own program, and the client never opens a file.
 *
 * This is the graph-side twin of ttsc's
 * `TestServeSnapshotProvesItsProgramWithoutASecondRead`. The client used to
 * adapt the dump, `readText` every file it named straight off the disk, and then
 * issue a second `{id}` round-trip purely to ask whether anything had moved
 * meanwhile. Neither half was sound: the bytes a later read returns are not the
 * bytes the checker resolved against, and a clean confirmation only ever proved
 * that the *server* saw no change — a write that lands and reverts in between is
 * invisible to both questions.
 *
 * The test states that as a property rather than an intention: the project's
 * sources are never written to disk at all. Every earlier version of this client
 * would hand back an empty source map here, because every `readText` returns
 * undefined and the file is dropped. This one hands back the producer's
 * complete program manifest intact, because the producer is the only party
 * that ever knew. That includes virtual bundled libraries which deliberately
 * have no disk path.
 */
export const test_ttscgraph_provider_proves_its_program_without_reading_disk =
  async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "samchon-graph-ttscgraph-provenance-"),
    );
    // Only the tsconfig exists. `src/index.ts`, `src/core/order.ts`, and
    // `src/empty.ts` are named by the dump's facts and by its manifest, and are
    // deliberately absent from the filesystem: a client that needs to read them
    // cannot pass, and one that trusts the compiler that parsed them does not
    // care.
    fs.writeFileSync(path.join(root, "tsconfig.json"), "{}\n");
    const client = new TtscGraphClient({
      root,
      command: process.execPath,
      args: [GraphPaths.fakeTtscGraphServer],
    });
    try {
      const initial = await client.refresh();
      TestValidator.equals(
        "a snapshot whose files are absent from disk still names every one of them",
        [...initial.snapshot.sources.keys()].sort(),
        [
          "bundled:///libs/lib.es2015.collection.d.ts",
          path.join(root, "src", "core", "order.ts"),
          path.join(root, "src", "empty.ts"),
          path.join(root, "src", "index.ts"),
        ].sort(),
      );
      TestValidator.equals(
        "the checker's digest survives a file the client cannot read",
        initial.snapshot.sources.get(path.join(root, "src", "empty.ts"))
          ?.checkerDigest,
        createHash("sha256").update("absent:src/empty.ts").digest("hex"),
      );
      TestValidator.equals(
        "an unreadable file reports no disk digest rather than inventing one",
        initial.snapshot.sources.get(path.join(root, "src", "empty.ts"))
          ?.diskDigest,
        "",
      );
      TestValidator.predicate(
        "the facts themselves survive, because they never depended on the disk",
        initial.snapshot.nodes.some(
          (node) => node.id === "src/core/order.ts#first:function",
        ),
      );
    } finally {
      await client.close();
    }

    await assertRefused(root, "--protocol=0", "a producer below the pinned protocol");
    await assertRefused(
      root,
      "--drop-capability=sourceDigests",
      "a producer that cannot prove its source manifest",
    );
    await assertRefused(
      root,
      "--drop-capability=universe",
      "a producer that cannot state its build universe",
    );
    await assertRefused(
      root,
      "--envelope-capability-mismatch",
      "an envelope and dump that disagree about their capabilities",
    );
    await assertUniverseDriftRefused(root);
    await assertUncollectedDiagnosticsAreDeclared(root);
    assertCapsAreRefusedAtTheProviderBoundary();
    await assertCapBypassIsNeverSilent();
  };

/** A producer this client must not read is one it must not adapt either. */
async function assertRefused(
  root: string,
  arg: string,
  description: string,
): Promise<void> {
  const client = new TtscGraphClient({
    root,
    command: process.execPath,
    args: [GraphPaths.fakeTtscGraphServer, arg],
  });
  try {
    let error: unknown;
    try {
      await client.refresh();
    } catch (caught) {
      error = caught;
    }
    TestValidator.predicate(
      `${description} fails closed`,
      error instanceof Error,
    );
    TestValidator.predicate(
      `${description} publishes no partial state`,
      client.current === undefined && client.generation === 0,
    );
  } finally {
    await client.close();
  }
}

/**
 * `incremental` means the resident program was reused, and a program can only be
 * reused while the inputs deciding its file set hold still. A producer whose
 * universe moved under that label is not cosmetically wrong — it reused a
 * program it should have reloaded, and the mode this provider reports is only
 * worth reporting because it is checked.
 */
async function assertUniverseDriftRefused(root: string): Promise<void> {
  const client = new TtscGraphClient({
    root,
    command: process.execPath,
    args: [GraphPaths.fakeTtscGraphServer, "--universe-drift"],
  });
  try {
    const initial = await client.refresh();
    await client.refresh();
    let error: unknown;
    try {
      await client.refresh();
    } catch (caught) {
      error = caught;
    }
    TestValidator.predicate(
      "an incremental snapshot whose build universe moved fails closed",
      error instanceof Error,
    );
    TestValidator.predicate(
      "a contradicted mode preserves the previous trusted generation",
      client.current !== undefined && client.generation === 1,
    );
  } finally {
    await client.close();
  }
}

/**
 * An empty diagnostic list and an uncollected one are the same bytes on the
 * wire. Only the capability tells them apart, so a snapshot that did not collect
 * them says so instead of reading as a clean bill of health.
 */
async function assertUncollectedDiagnosticsAreDeclared(
  root: string,
): Promise<void> {
  const client = new TtscGraphClient({
    root,
    command: process.execPath,
    args: [GraphPaths.fakeTtscGraphServer, "--drop-capability=diagnostics"],
  });
  try {
    const refresh = await client.refresh();
    TestValidator.equals(
      "a producer that collected no diagnostics reports none",
      refresh.snapshot.diagnostics,
      [],
    );
    TestValidator.predicate(
      "and says that is why, rather than letting the empty list speak for it",
      refresh.snapshot.warnings.some((warning) =>
        warning.includes("did not collect compiler diagnostics"),
      ),
    );
    TestValidator.predicate(
      "the capability list stays the authority a consumer can branch on",
      !refresh.snapshot.provenance.capabilities.includes("diagnostics"),
    );
  } finally {
    await client.close();
  }
}

/** The cap decision is the provider's own statement, testable on its own. */
function assertCapsAreRefusedAtTheProviderBoundary(): void {
  TestValidator.equals(
    "an uncapped build reaches the strict provider",
    ttscGraphStrictRefusal({}),
    undefined,
  );
  for (const [label, options] of [
    ["maxFiles", { maxFiles: 120 }],
    ["lspReferenceLimit", { lspReferenceLimit: 250 }],
    ["server", { server: "ttscserver" }],
  ] as const) {
    TestValidator.predicate(
      `${label} refuses the strict provider and names itself in the reason`,
      ttscGraphStrictRefusal(options)?.includes(label) === true,
    );
  }
  // One warning naming every refused option at once, not one per option: a
  // reader who fixes the first clause and sees the lane still refuse learns
  // nothing from a reason that was only ever a third of the truth.
  const all = ttscGraphStrictRefusal({
    maxFiles: 120,
    lspReferenceLimit: 250,
    server: "ttscserver",
  });
  TestValidator.predicate(
    "every refused option appears in the one warning",
    all !== undefined &&
      all.includes("server") &&
      all.includes("maxFiles") &&
      all.includes("lspReferenceLimit"),
  );
}

/**
 * The defect this issue names: `buildLspGraph` skipped the strict lane whenever
 * a cap was present and said nothing, so the real-language experiment — which
 * passes `maxFiles` and `lspReferenceLimit` on every run — never once launched
 * `ttscgraph` while reporting a generic success each time.
 */
async function assertCapBypassIsNeverSilent(): Promise<void> {
  // Its own checkout, with real TypeScript on disk: the language loop skips a
  // language it finds no files for, so a fixture without sources would prove
  // nothing about which lane indexed them.
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "samchon-graph-ttscgraph-caps-"),
  );
  fs.writeFileSync(path.join(root, "tsconfig.json"), "{}\n");
  fs.writeFileSync(
    path.join(root, "index.ts"),
    "export const answer = 1;\n",
  );
  let resolves = 0;
  const capped = await buildLspGraph(
    {
      cwd: root,
      languages: ["typescript"],
      maxFiles: 120,
      lspReferenceLimit: 250,
      // No such server exists, so the generic lane falls through to the static
      // parser. What is under test is the warning and the fact that the strict
      // provider was never consulted — not what ended up replacing it.
      server: "definitely-not-a-real-language-server",
    },
    {
      resolveTtscGraphCommand: () => {
        resolves += 1;
        return {
          command: process.execPath,
          args: [GraphPaths.fakeTtscGraphServer],
        };
      },
    },
  );
  TestValidator.equals(
    "a capped build never even resolves the strict provider binary",
    resolves,
    0,
  );
  TestValidator.predicate(
    "a capped build says which options disabled the compiler-owned lane",
    capped.warnings.some(
      (warning) =>
        warning.includes("ttscgraph bulk indexing is disabled by") &&
        warning.includes("maxFiles") &&
        warning.includes("lspReferenceLimit") &&
        warning.includes("server"),
    ),
  );
  TestValidator.equals(
    "and says it exactly once",
    capped.warnings.filter((warning) =>
      warning.includes("ttscgraph bulk indexing is disabled by"),
    ).length,
    1,
  );
  TestValidator.predicate(
    "a capped build does not claim compiler-owned authority",
    capped.warnings.some((warning) =>
      warning.includes("These facts are not compiler-owned"),
    ),
  );
}
