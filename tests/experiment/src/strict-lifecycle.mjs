import fs from "node:fs";
import path from "node:path";

import { createResidentGraphSource } from "@samchon/graph";

import { ensureDir, shell, workRoot } from "./process.mjs";

/** Measure one strict provider without ever editing the pinned corpus clone. */
export const runStrictLifecycle = async (experiment, pinnedRoot) => {
  if (experiment.lifecycle === undefined) {
    throw new Error(
      `${experiment.language}: strict experiment has no lifecycle fixture`,
    );
  }
  const lifecycleRoot = path.join(workRoot, "lifecycle", experiment.language);
  fs.rmSync(lifecycleRoot, { force: true, recursive: true });
  ensureDir(path.dirname(lifecycleRoot));
  fs.cpSync(pinnedRoot, lifecycleRoot, {
    recursive: true,
    filter: (source) => path.basename(source) !== ".git",
  });
  if (experiment.prepare !== undefined) {
    shell(experiment.prepare, { cwd: lifecycleRoot });
  }

  const fixture = experiment.lifecycle;
  const sourceFile = path.join(lifecycleRoot, fixture.sourceFile);
  const createFile = path.join(lifecycleRoot, fixture.createFile);
  const renamedFile = path.join(lifecycleRoot, fixture.renamedFile);
  const buildFile = path.join(lifecycleRoot, fixture.buildFile);
  const failureFile = path.join(
    lifecycleRoot,
    fixture.failureFile ?? fixture.sourceFile,
  );
  const sourceText = fs.readFileSync(sourceFile, "utf8");
  const buildText = fs.readFileSync(buildFile, "utf8");
  const failureText = fs.readFileSync(failureFile, "utf8");
  const rows = [];
  const resident = createResidentGraphSource({
    cwd: lifecycleRoot,
    mode: "lsp",
    languages: [experiment.language],
    lspTimeoutMs: experiment.timeoutMs ?? 60_000,
    lspReadyTimeoutMs: experiment.readyTimeoutMs ?? 180_000,
    lspWarmupTimeoutMs: experiment.warmupTimeoutMs ?? 180_000,
  });
  let dump;
  let previousIdentity;

  const load = async (name, expectedModes) => {
    const started = performance.now();
    const next = await resident.load();
    const elapsedMs = Math.round(performance.now() - started);
    const provenance = strictProvenance(next, experiment);
    const mode = resident.modes().get(experiment.strictProvider);
    if (!expectedModes.includes(mode)) {
      throw new Error(
        `${experiment.language}: ${name} reported ${String(mode)}, expected ${expectedModes.join(" or ")}`,
      );
    }
    const identity = [
      provenance.manifest,
      provenance.content,
      provenance.universe,
    ].join(":");
    const row = {
      name,
      status: "passed",
      mode,
      elapsedMs,
      changed: dump !== next,
      outputBytes: Buffer.byteLength(JSON.stringify(next), "utf8"),
      manifest: provenance.manifest,
      content: provenance.content,
      universe: provenance.universe,
      nodeCount: next.nodes.length,
      edgeCount: next.edges.length,
      diagnosticCount: next.diagnostics?.length ?? 0,
    };
    if (name === "unchanged" && identity !== previousIdentity) {
      throw new Error(
        `${experiment.language}: unchanged refresh moved strict provenance`,
      );
    }
    if (
      name !== "cold" &&
      name !== "unchanged" &&
      identity === previousIdentity
    ) {
      throw new Error(
        `${experiment.language}: ${name} did not move content, manifest, or build universe`,
      );
    }
    dump = next;
    previousIdentity = identity;
    rows.push(row);
    return next;
  };

  try {
    const cold = await load("cold", ["initial"]);
    const unchanged = await load("unchanged", ["unchanged"]);
    if (cold !== unchanged) {
      throw new Error(
        `${experiment.language}: unchanged resident load replaced dump identity`,
      );
    }

    fs.writeFileSync(sourceFile, sourceText + fixture.editSuffix);
    await load("edit", CHANGED_MODES);

    fs.writeFileSync(createFile, fixture.createText);
    const created = await load("create", CHANGED_MODES);
    assertCreatedSymbol(
      created,
      fixture,
      experiment.language,
      fixture.createFile,
    );
    assertCreatedEdge(created, fixture, experiment.language);

    fs.renameSync(createFile, renamedFile);
    const renamed = await load("rename", CHANGED_MODES);
    assertCreatedSymbol(
      renamed,
      fixture,
      experiment.language,
      fixture.renamedFile,
    );
    assertCreatedEdge(renamed, fixture, experiment.language);

    fs.rmSync(renamedFile);
    const deleted = await load("delete", CHANGED_MODES);
    if (deleted.nodes.some((node) => node.name === fixture.createdSymbol)) {
      throw new Error(
        `${experiment.language}: deleted lifecycle declaration remained in the graph`,
      );
    }

    fs.writeFileSync(buildFile, `${buildText}\n`);
    await load("build-config", CHANGED_MODES);

    const failedAt = performance.now();
    fs.writeFileSync(failureFile, failureText + fixture.failureSuffix);
    if (fixture.failurePolicy === "reject") {
      let failure;
      try {
        await resident.load();
      } catch (error) {
        failure = error;
      }
      if (!(failure instanceof Error)) {
        throw new Error(
          `${experiment.language}: malformed project input unexpectedly published`,
        );
      }
      rows.push({
        name: "failure",
        status: "rejected",
        mode: resident.modes().get(experiment.strictProvider),
        elapsedMs: Math.round(performance.now() - failedAt),
        error: failure.message,
      });
    } else if (fixture.failurePolicy === "tolerated") {
      // Some producers genuinely do not fail on this input class, and asserting
      // a rejection they never make would only prove the harness can be made to
      // agree with itself. What is still worth proving is that the graph did not
      // quietly serve the previous generation across a changed build input: the
      // producer answers again, the snapshot passes the same strict contract,
      // and provenance moves. The limitation is published rather than hidden.
      if (typeof fixture.failureLimitation !== "string") {
        throw new Error(
          `${experiment.language}: a tolerated failure must publish the limitation it accepts`,
        );
      }
      const priorIdentity = previousIdentity;
      let tolerated;
      try {
        tolerated = await resident.load();
      } catch (error) {
        throw new Error(
          `${experiment.language}: the catalog records this input as tolerated, but the provider rejected it: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const provenance = strictProvenance(tolerated, experiment);
      const mode = resident.modes().get(experiment.strictProvider);
      if (!CHANGED_MODES.includes(mode)) {
        throw new Error(
          `${experiment.language}: tolerated failure reported ${String(mode)}`,
        );
      }
      const identity = [
        provenance.manifest,
        provenance.content,
        provenance.universe,
      ].join(":");
      if (identity === priorIdentity) {
        throw new Error(
          `${experiment.language}: tolerated failure did not move strict provenance`,
        );
      }
      dump = tolerated;
      previousIdentity = identity;
      rows.push({
        name: "failure",
        status: "tolerated",
        mode,
        elapsedMs: Math.round(performance.now() - failedAt),
        diagnosticCount: tolerated.diagnostics?.length ?? 0,
        limitation: fixture.failureLimitation,
      });
    } else if (
      fixture.failurePolicy === "diagnostic" ||
      fixture.failurePolicy === "reject-or-diagnostic"
    ) {
      const priorIdentity = previousIdentity;
      let diagnosed;
      let rejected;
      try {
        diagnosed = await resident.load();
      } catch (error) {
        rejected = error;
      }
      if (rejected !== undefined) {
        if (fixture.failurePolicy !== "reject-or-diagnostic") throw rejected;
        rows.push({
          name: "failure",
          status: "rejected",
          mode: resident.modes().get(experiment.strictProvider),
          elapsedMs: Math.round(performance.now() - failedAt),
          error: rejected instanceof Error ? rejected.message : String(rejected),
        });
      } else {
        if (diagnosed === undefined) {
          throw new Error(`${experiment.language}: failure produced no result`);
        }
        if ((diagnosed.diagnostics?.length ?? 0) === 0) {
          throw new Error(
            `${experiment.language}: malformed project input produced neither rejection nor diagnostics`,
          );
        }
        dump = diagnosed;
        const provenance = strictProvenance(diagnosed, experiment);
        const mode = resident.modes().get(experiment.strictProvider);
        if (!CHANGED_MODES.includes(mode)) {
          throw new Error(
            `${experiment.language}: diagnostic failure reported ${String(mode)}`,
          );
        }
        previousIdentity = [
          provenance.manifest,
          provenance.content,
          provenance.universe,
        ].join(":");
        if (previousIdentity === priorIdentity) {
          throw new Error(
            `${experiment.language}: diagnostic failure did not move strict provenance`,
          );
        }
        rows.push({
          name: "failure",
          status: "diagnostic-only",
          mode,
          elapsedMs: Math.round(performance.now() - failedAt),
          diagnosticCount: diagnosed.diagnostics?.length ?? 0,
        });
      }
    } else {
      throw new Error(
        `${experiment.language}: unknown failure policy ${String(fixture.failurePolicy)}`,
      );
    }

    fs.writeFileSync(failureFile, failureText);
    fs.writeFileSync(sourceFile, sourceText);
    fs.writeFileSync(buildFile, buildText);
    const retried = await load("retry", CHANGED_MODES);
    if (retried.nodes.some((node) => node.name === fixture.createdSymbol)) {
      throw new Error(
        `${experiment.language}: retry retained a removed lifecycle declaration`,
      );
    }
    return { dump: cold, rows, project: lifecycleRoot };
  } finally {
    await resident.close();
  }
};

function strictProvenance(dump, experiment) {
  const provenance = dump.provenance?.find(
    (row) => row.provider === experiment.strictProvider,
  );
  if (provenance === undefined) {
    const warnings = dump.warnings?.join("; ") ?? "no graph warnings";
    throw new Error(
      `${experiment.language}: strict lifecycle lost ${experiment.strictProvider} provenance: ${warnings}`,
    );
  }
  return provenance;
}

function assertCreatedSymbol(dump, fixture, language, expectedFile) {
  const created = dump.nodes.find(
    (node) => node.name === fixture.createdSymbol,
  );
  if (created === undefined || created.file !== expectedFile) {
    throw new Error(
      `${language}: lifecycle declaration was not published from ${expectedFile}`,
    );
  }
}

function assertCreatedEdge(dump, fixture, language) {
  if (fixture.createdEdge === undefined) return;
  const nodes = new Map(dump.nodes.map((node) => [node.id, node]));
  const found = dump.edges.some((edge) => {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    return (
      edge.kind === fixture.createdEdge.kind &&
      from?.name === fixture.createdEdge.from &&
      to?.name === fixture.createdEdge.to
    );
  });
  if (!found) {
    throw new Error(
      `${language}: lifecycle lost ${fixture.createdEdge.kind} ${fixture.createdEdge.from} -> ${fixture.createdEdge.to}`,
    );
  }
}

const CHANGED_MODES = ["reload", "incremental", "rebuild"];
