import cp from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { invalidWebsiteCellReason } from "./website-cell.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const auditor = path.join(here, "audit-codex-traces.mjs");

/**
 * The single agent-result publication gate. It validates the stable website
 * cell and, for Codex, regenerates the full audit from raw JSONL traces before
 * accepting any report. A stored sample cannot substitute for its trace: core
 * usage and tool counts must agree run by run.
 */
export function assertPublicationCandidates(
  candidates,
  { auditPath, auditScript = auditor } = {},
) {
  for (const { cell } of candidates) {
    const invalidReason = invalidWebsiteCellReason(cell);
    if (invalidReason !== null) throw new Error(invalidReason);
  }
  for (const candidate of candidates) validateReportProvenance(candidate);

  const codexReports = [
    ...new Set(
      candidates
        .filter(({ harness, cell }) =>
          (harness ?? cell.harness) === "codex",
        )
        .map(({ reportPath }) => path.resolve(reportPath ?? "")),
    ),
  ];
  if (codexReports.length === 0) return null;
  if (!auditPath) throw new Error("Codex publication requires an audit output path");
  for (const reportPath of codexReports) {
    if (!fs.existsSync(reportPath)) {
      throw new Error(`missing Codex publication report: ${reportPath}`);
    }
  }

  const resolvedAudit = path.resolve(auditPath);
  fs.mkdirSync(path.dirname(resolvedAudit), { recursive: true });
  const suitePath = `${resolvedAudit}.suite.json`;
  fs.writeFileSync(
    suitePath,
    `${JSON.stringify(
      {
        cells: codexReports.map((report) => ({ harness: "codex", report })),
      },
      null,
      2,
    )}\n`,
  );
  const result = cp.spawnSync(
    process.execPath,
    [
      auditScript,
      `--report=${suitePath}`,
      "--baseline=none",
      `--out=${resolvedAudit}`,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  fs.writeFileSync(`${resolvedAudit}.out.log`, result.stdout ?? "");
  fs.writeFileSync(`${resolvedAudit}.err.log`, result.stderr ?? "");
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Codex trace audit failed (${result.status}): ${(result.stderr ?? "").trim()}`,
    );
  }
  if (!fs.existsSync(resolvedAudit)) {
    throw new Error(`Codex trace audit did not write ${resolvedAudit}`);
  }
  const audit = JSON.parse(fs.readFileSync(resolvedAudit, "utf8"));
  validateCodexTraceAudit(audit, codexReports);
  return resolvedAudit;
}

function validateReportProvenance({ cell, reportPath }) {
  if (!reportPath || !fs.existsSync(reportPath)) {
    throw new Error(`missing publication report: ${reportPath ?? "unspecified"}`);
  }
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  if (!/^[0-9a-f]{40}$/.test(report.commit ?? "")) {
    throw new Error(`${reportPath}: missing exact fixture commit`);
  }
  if (!/^[0-9a-f]{40}$/.test(report.fixtureTree ?? "")) {
    throw new Error(`${reportPath}: missing exact fixture tree`);
  }
  if (report.fixtureBranch !== report.commit || cell.fixtureBranch !== report.commit) {
    throw new Error(`${reportPath}: fixture commit provenance mismatch`);
  }
  if (cell.repo !== report.repo) {
    throw new Error(`${reportPath}: fixture repository provenance mismatch`);
  }
  const questionHash = crypto
    .createHash("sha256")
    .update(String(report.question ?? "").replace(/\r\n/g, "\n").trim())
    .digest("hex");
  if (
    report.questionSha256 !== questionHash ||
    cell.questionSha256 !== questionHash
  ) {
    throw new Error(`${reportPath}: question provenance mismatch`);
  }
  for (const sample of [
    ...(report.samples?.baseline ?? []),
    ...(report.samples?.graph ?? []),
  ]) {
    if (sample.questionSha256 !== questionHash) {
      throw new Error(`${reportPath}: sample question provenance mismatch`);
    }
  }
}

export function validateCodexTraceAudit(audit, reportPaths) {
  if (audit?.schemaVersion !== 1 || !Array.isArray(audit.cells)) {
    throw new Error("invalid Codex trace audit shape");
  }
  if (audit.cells.length !== reportPaths.length) {
    throw new Error(
      `Codex trace audit covered ${audit.cells.length}/${reportPaths.length} report(s)`,
    );
  }
  const audited = new Map(
    audit.cells.map((cell) => [
      path.resolve(repoRoot, cell.report),
      cell,
    ]),
  );
  for (const reportPath of reportPaths) {
    const resolvedReport = path.resolve(reportPath);
    const cell = audited.get(resolvedReport);
    if (!cell) throw new Error(`Codex trace audit omitted ${resolvedReport}`);
    validateAuditedReport(
      JSON.parse(fs.readFileSync(resolvedReport, "utf8")),
      cell,
      resolvedReport,
    );
  }
}

function validateAuditedReport(report, auditCell, reportPath) {
  const runs = auditCell.runsDetail ?? [];
  const expectedRunCount =
    (report.samples?.baseline?.length ?? 0) +
    (report.samples?.graph?.length ?? 0);
  if (runs.length !== expectedRunCount) {
    throw new Error(
      `${reportPath}: trace count ${runs.length} != sample count ${expectedRunCount}`,
    );
  }
  for (const arm of ["baseline", "graph"]) {
    const samples = report.samples?.[arm] ?? [];
    const armRuns = runs.filter((run) => run.arm === arm);
    if (armRuns.length !== samples.length) {
      throw new Error(
        `${reportPath}: ${arm} trace count ${armRuns.length} != sample count ${samples.length}`,
      );
    }
    if (new Set(armRuns.map((run) => run.run)).size !== armRuns.length) {
      throw new Error(`${reportPath}: ${arm} trace run numbers are not unique`);
    }
    if (
      new Set(samples.map((sample, index) => Number(sample.run ?? index + 1)))
        .size !== samples.length
    ) {
      throw new Error(`${reportPath}: ${arm} sample run numbers are not unique`);
    }
    const sampleRunNumbers = new Set(
      samples.map((sample, index) => Number(sample.run ?? index + 1)),
    );
    for (let run = 1; run <= samples.length; run++) {
      if (!sampleRunNumbers.has(run)) {
        throw new Error(`${reportPath}: ${arm} sample run ${run} is missing`);
      }
    }
    for (let index = 0; index < samples.length; index++) {
      const sample = samples[index];
      const runNumber = Number(sample.run ?? index + 1);
      const trace = armRuns.find((run) => run.run === runNumber);
      if (!trace) {
        throw new Error(`${reportPath}: missing ${arm} run ${runNumber} trace`);
      }
      if (trace.usage?.turns <= 0 || trace.messages?.count <= 0) {
        throw new Error(`${reportPath}: ${arm} run ${runNumber} is incomplete`);
      }
      for (const [label, actual, expected] of [
        ["tokens", trace.usage?.tokens, sample.tokens],
        ["cached", trace.usage?.cachedInputTokens, sample.cached ?? 0],
        ["reasoning", trace.usage?.reasoningTokens, sample.reasoning ?? 0],
        [
          "tokens with reasoning",
          trace.usage?.tokensWithReasoning,
          sample.tokensWithReasoning ??
            Number(sample.tokens ?? 0) + Number(sample.reasoning ?? 0),
        ],
        ["turns", trace.usage?.turns, sample.turns],
        ["tools", trace.tools?.total, sample.tools],
        ["shell", trace.tools?.command, sample.shell],
        ["graph", trace.tools?.mcp, sample.graph],
      ]) {
        if (Number(actual ?? 0) !== Number(expected ?? 0)) {
          throw new Error(
            `${reportPath}: ${arm} run ${runNumber} ${label} trace=${actual ?? 0} sample=${expected ?? 0}`,
          );
        }
      }
      if (arm === "graph" && trace.tools.mcp <= 0) {
        throw new Error(`${reportPath}: graph run ${runNumber} has no audited MCP call`);
      }
      if (arm === "graph" && trace.tools.command > 0) {
        throw new Error(`${reportPath}: graph run ${runNumber} has audited shell fallback`);
      }
    }
  }
  if (runs.length === 0) throw new Error(`${reportPath}: trace audit contains no runs`);
}
