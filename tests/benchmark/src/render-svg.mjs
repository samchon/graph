// Renders the codex benchmark reports (results/codex-<repo>-<family>-<tool>.json)
// into one grouped-bar SVG per prompt family. Each SVG is self-adapting: an
// embedded `@media (prefers-color-scheme: dark)` swaps the color variables, so a
// single file looks right in both light and dark when dropped into a README
// with a plain `<img>` — no `<picture>` two-file trick needed.
//
// Visual rules follow the dataviz method: tools carry a fixed, validated
// categorical order (@samchon/graph blue, codegraph aqua, serena yellow; the
// light/dark steps are validated separately against each surface); the baseline
// is a neutral gray reference; marks are thin with a flat baseline edge and a
// 4px rounded data end, 2px gaps between bars; every bar carries a direct value
// label; the grid is recessive and there is exactly one axis (tokens).
//
//   node tests/benchmark/src/render-svg.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CORPUS } from "./corpus.mjs";
import { median } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const resultsRoot = path.resolve(here, "..", "results");

const TOOLS = ["samchon-graph", "codegraph", "serena"];
// The report/data key stays `samchon-graph` (it matches the result filenames);
// only the display label is the package name.
const LABELS = { "samchon-graph": "@samchon/graph", codegraph: "codegraph", serena: "serena" };
// CSS variable name per series key.
const VAR = { "samchon-graph": "--s1", codegraph: "--s2", serena: "--s3" };
// Light and dark palettes (validated categorical steps per surface).
const LIGHT = {
  surface: "#ffffff", text: "#1a1a19", muted: "#6b6a64", grid: "#00000018", baseline: "#767672",
  s1: "#2a78d6", s2: "#1baf7a", s3: "#eda100",
};
const DARK = {
  surface: "#0d1117", text: "#e6edf3", muted: "#9d9d97", grid: "#ffffff1e", baseline: "#9d9d97",
  s1: "#3987e5", s2: "#199e70", s3: "#c98500",
};

const reports = fs
  .readdirSync(resultsRoot)
  .filter((file) => /^codex-.*\.json$/.test(file))
  .map((file) => JSON.parse(fs.readFileSync(path.join(resultsRoot, file), "utf8")));
if (reports.length === 0) {
  console.error("No codex-*.json reports in results/; run the suite first.");
  process.exit(1);
}

const families = [...new Set(reports.map((report) => report.promptFamily))].sort();
const medianTokens = (report, arm) =>
  median((report.samples[arm] ?? []).filter((m) => m.tokens > 0).map((m) => m.tokens));
const cell = (family, repo, tool) => {
  const report = reports.find(
    (r) => r.promptFamily === family && r.repo === repo && r.tool === tool,
  );
  if (!report) return undefined;
  const arm = tool === "baseline" ? "baseline" : "graph";
  const value = medianTokens(report, arm);
  return value > 0 ? { value } : undefined;
};

const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

for (const family of families) {
  const repos = CORPUS.map((entry) => entry.name).filter((repo) =>
    reports.some((r) => r.promptFamily === family && r.repo === repo),
  );
  const sample = reports.find((r) => r.promptFamily === family);
  const model = sample?.model ?? "gpt-5.4-mini";
  const harness = sample?.harness ?? "codex";
  const out = path.join(resultsRoot, `${harness}-${model}-${family}.svg`);
  fs.writeFileSync(out, render(family, repos, model));
  console.log(`Wrote ${out}`);
}

function render(family, repos, model) {
  const width = 940;
  const gutter = 96;
  const plotLeft = gutter;
  const plotRight = width - 168;
  const plotWidth = plotRight - plotLeft;
  const barH = 12;
  const barStep = barH + 2; // 2px surface gap between adjacent bars
  const groupPad = 12;
  const groupH = barStep * 4 + groupPad;
  const legendY = 74;
  const plotTop = legendY + 30;
  const footerH = 44;
  const height = plotTop + repos.length * groupH + footerH;

  const values = [];
  for (const repo of repos) {
    for (const tool of ["baseline", ...TOOLS]) values.push(cell(family, repo, tool)?.value ?? 0);
  }
  const max = Math.max(...values, 1);
  const x = (v) => plotLeft + (v / max) * plotWidth;

  // One stylesheet defines the color variables; the dark block overrides them,
  // so the same geometry renders correctly under either color scheme.
  const vars = (p) =>
    `--surface:${p.surface};--text:${p.text};--muted:${p.muted};--grid:${p.grid};--baseline:${p.baseline};--s1:${p.s1};--s2:${p.s2};--s3:${p.s3};`;
  const style =
    `<style>` +
    `svg{--f:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;${vars(LIGHT)}}` +
    `@media (prefers-color-scheme:dark){svg{${vars(DARK)}}}` +
    `.s{fill:var(--surface)}.t{fill:var(--text)}.m{fill:var(--muted)}` +
    `.g{stroke:var(--grid);stroke-width:1}.b0{fill:var(--baseline)}` +
    `.b1{fill:var(--s1)}.b2{fill:var(--s2)}.b3{fill:var(--s3)}` +
    `text{font-family:var(--f)}</style>`;
  const cls = { baseline: "b0", "samchon-graph": "b1", codegraph: "b2", serena: "b3" };

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    style,
    `<rect width="${width}" height="${height}" class="s"/>`,
    `<text x="24" y="32" font-size="16" font-weight="600" class="t">Agent token cost — ${esc(family)} question, per repository</text>`,
    `<text x="24" y="52" font-size="12" class="m">codex · ${esc(model)} · N=1 · lower is better</text>`,
  );

  // Legend: baseline + fixed tool order.
  let lx = 24;
  for (const [name, klass] of [["baseline (no MCP)", "b0"], ...TOOLS.map((t) => [LABELS[t], cls[t]])]) {
    parts.push(
      `<rect x="${lx}" y="${legendY}" width="10" height="10" rx="2" class="${klass}"/>`,
      `<text x="${lx + 15}" y="${legendY + 9}" font-size="12" class="t">${esc(name)}</text>`,
    );
    lx += 15 + name.length * 6.4 + 22;
  }

  // Recessive grid + the one axis (tokens).
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    const gx = x(v);
    parts.push(
      `<line x1="${gx}" y1="${plotTop - 6}" x2="${gx}" y2="${plotTop + repos.length * groupH - groupPad}" class="g"/>`,
      `<text x="${gx}" y="${plotTop + repos.length * groupH + 14}" font-size="11" class="m" text-anchor="middle">${fmt(v)}</text>`,
    );
  }
  parts.push(
    `<text x="${plotRight}" y="${plotTop + repos.length * groupH + 32}" font-size="11" class="m" text-anchor="end">tokens</text>`,
  );

  // Bars: flat baseline edge, 4px rounded data end.
  const bar = (y, w, klass) => {
    const r = Math.min(4, w);
    return `<path d="M ${plotLeft} ${y} L ${plotLeft + w - r} ${y} Q ${plotLeft + w} ${y} ${plotLeft + w} ${y + r} L ${plotLeft + w} ${y + barH - r} Q ${plotLeft + w} ${y + barH} ${plotLeft + w - r} ${y + barH} L ${plotLeft} ${y + barH} Z" class="${klass}"/>`;
  };
  repos.forEach((repo, index) => {
    const top = plotTop + index * groupH;
    const language = CORPUS.find((entry) => entry.name === repo)?.language ?? "";
    parts.push(
      `<text x="${gutter - 8}" y="${top + barH}" font-size="12" font-weight="600" class="t" text-anchor="end">${esc(repo)}</text>`,
      `<text x="${gutter - 8}" y="${top + barH + 13}" font-size="10" class="m" text-anchor="end">${esc(language)}</text>`,
    );
    const base = cell(family, repo, "baseline")?.value;
    ["baseline", ...TOOLS].forEach((tool, i) => {
      const y = top + i * barStep;
      const entry = cell(family, repo, tool);
      if (entry === undefined) {
        parts.push(
          `<text x="${plotLeft + 4}" y="${y + barH - 2}" font-size="10" class="m">not measured</text>`,
        );
        return;
      }
      const w = Math.max(2, x(entry.value) - plotLeft);
      parts.push(bar(y, w, cls[tool]));
      const change = base ? Math.round((entry.value / base - 1) * 100) : 0;
      const delta = tool !== "baseline" && base ? ` (${change > 0 ? "+" : ""}${change}%)` : "";
      parts.push(
        `<text x="${plotLeft + w + 6}" y="${y + barH - 2}" font-size="11" class="m">${fmt(entry.value)}${esc(delta)}</text>`,
      );
    });
  });

  parts.push("</svg>");
  return parts.join("\n");
}
