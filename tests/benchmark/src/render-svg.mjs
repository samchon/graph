// Renders the codex benchmark reports (results/codex-<repo>-<family>-<tool>.json)
// into grouped-bar SVG charts, one per prompt family, in light and dark
// variants for a GitHub README <picture> block.
//
// Visual rules follow the dataviz method: tools carry a fixed, validated
// categorical order (samchon-graph blue, codegraph aqua, serena yellow;
// light/dark steps validated separately against their surfaces); the baseline
// is a neutral gray reference; marks are thin with a flat baseline edge and a
// 4px rounded data end, 2px gaps between bars; every bar carries a direct value
// label (the relief the light-mode contrast WARN requires); the grid is
// recessive and there is exactly one axis (tokens).
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
const THEMES = {
  light: {
    surface: "#ffffff",
    text: "#1a1a19",
    muted: "#6b6a64",
    grid: "#00000018",
    baseline: "#767672",
    series: { "samchon-graph": "#2a78d6", codegraph: "#1baf7a", serena: "#eda100" },
  },
  dark: {
    surface: "#0d1117",
    text: "#e6edf3",
    muted: "#9d9d97",
    grid: "#ffffff1e",
    baseline: "#9d9d97",
    series: { "samchon-graph": "#3987e5", codegraph: "#199e70", serena: "#c98500" },
  },
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
  return value > 0 ? { value, model: report.model } : undefined;
};

const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

for (const family of families) {
  const repos = CORPUS.map((entry) => entry.name).filter((repo) =>
    reports.some((r) => r.promptFamily === family && r.repo === repo),
  );
  const model = reports.find((r) => r.promptFamily === family)?.model ?? "gpt-5.4-mini";
  for (const [mode, theme] of Object.entries(THEMES)) {
    const svg = render(family, repos, model, theme);
    const out = path.join(resultsRoot, `summary-${family}-${mode}.svg`);
    fs.writeFileSync(out, svg);
    console.log(`Wrote ${out}`);
  }
}

function render(family, repos, model, theme) {
  const width = 940;
  const gutter = 96;
  const plotLeft = gutter;
  const plotRight = width - 168;
  const plotWidth = plotRight - plotLeft;
  const barH = 12;
  const barStep = barH + 2; // the 2px surface gap between adjacent bars
  const groupPad = 12;
  const groupH = barStep * 4 + groupPad;
  const legendY = 58;
  const plotTop = legendY + 28;
  const footerH = 96;
  const height = plotTop + repos.length * groupH + footerH;

  const values = [];
  for (const repo of repos) {
    for (const tool of ["baseline", ...TOOLS]) values.push(cell(family, repo, tool)?.value ?? 0);
  }
  const max = Math.max(...values, 1);
  const x = (v) => plotLeft + (v / max) * plotWidth;

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif">`,
    `<rect width="${width}" height="${height}" fill="${theme.surface}"/>`,
    `<text x="24" y="30" font-size="16" font-weight="600" fill="${theme.text}">Agent token cost — ${esc(family)} question, per repository</text>`,
    `<text x="24" y="48" font-size="12" fill="${theme.muted}">codex / ${esc(model)} · reasoning high · N=1 · median tokens per run (input + output, summed per turn) · lower is better</text>`,
  );

  // Legend: baseline + fixed tool order.
  let lx = 24;
  for (const [name, color] of [["baseline (no MCP)", theme.baseline], ...TOOLS.map((t) => [t, theme.series[t]])]) {
    parts.push(
      `<rect x="${lx}" y="${legendY}" width="10" height="10" rx="2" fill="${color}"/>`,
      `<text x="${lx + 15}" y="${legendY + 9}" font-size="12" fill="${theme.text}">${esc(name)}</text>`,
    );
    lx += 15 + name.length * 6.4 + 22;
  }

  // Recessive grid + the one axis (tokens).
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    const gx = x(v);
    parts.push(
      `<line x1="${gx}" y1="${plotTop - 6}" x2="${gx}" y2="${plotTop + repos.length * groupH - groupPad}" stroke="${theme.grid}" stroke-width="1"/>`,
      `<text x="${gx}" y="${plotTop + repos.length * groupH + 14}" font-size="11" fill="${theme.muted}" text-anchor="middle">${fmt(v)}</text>`,
    );
  }
  parts.push(
    `<text x="${plotRight}" y="${plotTop + repos.length * groupH + 32}" font-size="11" fill="${theme.muted}" text-anchor="end">tokens</text>`,
  );

  // Bars: flat baseline edge, 4px rounded data end.
  const bar = (y, w, color) => {
    const r = Math.min(4, w);
    return `<path d="M ${plotLeft} ${y} L ${plotLeft + w - r} ${y} Q ${plotLeft + w} ${y} ${plotLeft + w} ${y + r} L ${plotLeft + w} ${y + barH - r} Q ${plotLeft + w} ${y + barH} ${plotLeft + w - r} ${y + barH} L ${plotLeft} ${y + barH} Z" fill="${color}"/>`;
  };
  repos.forEach((repo, index) => {
    const top = plotTop + index * groupH;
    const language = CORPUS.find((entry) => entry.name === repo)?.language ?? "";
    parts.push(
      `<text x="${gutter - 8}" y="${top + barH}" font-size="12" font-weight="600" fill="${theme.text}" text-anchor="end">${esc(repo)}</text>`,
      `<text x="${gutter - 8}" y="${top + barH + 13}" font-size="10" fill="${theme.muted}" text-anchor="end">${esc(language)}</text>`,
    );
    const base = cell(family, repo, "baseline")?.value;
    ["baseline", ...TOOLS].forEach((tool, i) => {
      const y = top + i * barStep;
      const entry = cell(family, repo, tool);
      const color = tool === "baseline" ? theme.baseline : theme.series[tool];
      if (entry === undefined) {
        parts.push(
          `<text x="${plotLeft + 4}" y="${y + barH - 2}" font-size="10" fill="${theme.muted}">not measured</text>`,
        );
        return;
      }
      const w = Math.max(2, x(entry.value) - plotLeft);
      parts.push(bar(y, w, color));
      const change = base ? Math.round((entry.value / base - 1) * 100) : 0;
      const delta =
        tool !== "baseline" && base ? ` (${change > 0 ? "+" : ""}${change}%)` : "";
      parts.push(
        `<text x="${plotLeft + w + 6}" y="${y + barH - 2}" font-size="11" fill="${theme.muted}">${fmt(entry.value)}${esc(delta)}</text>`,
      );
    });
  });

  // Summary: median reduction vs baseline per tool, across measured repos.
  const summaryY = plotTop + repos.length * groupH + 54;
  const summaries = TOOLS.map((tool) => {
    const cuts = repos
      .map((repo) => {
        const base = cell(family, repo, "baseline")?.value;
        const value = cell(family, repo, tool)?.value;
        return base && value ? 1 - value / base : undefined;
      })
      .filter((v) => v !== undefined);
    if (cuts.length === 0) return `${tool} not measured`;
    const cut = Math.round(median(cuts) * 100);
    return cut >= 0
      ? `${tool} ${cut}% fewer (n=${cuts.length})`
      : `${tool} ${-cut}% more (n=${cuts.length})`;
  });
  parts.push(
    `<text x="24" y="${summaryY}" font-size="12" font-weight="600" fill="${theme.text}">Median vs baseline: ${esc(summaries.join(" · "))}</text>`,
  );
  parts.push("</svg>");
  return parts.join("\n");
}
