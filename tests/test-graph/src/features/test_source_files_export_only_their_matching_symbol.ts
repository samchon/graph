import { TestValidator } from "@nestia/e2e";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs));
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(abs);
  }
  return out.sort();
};

export const test_source_files_export_only_their_matching_symbol = () => {
  const roots = [
    path.join(GraphPaths.graphPackageRoot, "src"),
    path.join(GraphPaths.repositoryRoot, "tests", "test-graph", "src"),
  ];
  const violations: string[] = [];
  for (const root of roots) {
    for (const file of walk(root)) {
      const relative = path.relative(GraphPaths.repositoryRoot, file).replace(/\\/g, "/");
      const text = fs.readFileSync(file, "utf8");
      const exportLines = text.split(/\r?\n/).filter((line) => line.startsWith("export "));
      const reexports = exportLines.filter((line) => /^export\s+(?:\*|\{)/.test(line));
      const localNames = [
        ...new Set(
          exportLines.flatMap((line) => {
            const match = /^export\s+(?:async\s+)?(?:declare\s+)?(?:class|function|interface|type|namespace|const|let|var|enum)\s+([A-Za-z_$][\w$]*)/.exec(line);
            return match === null ? [] : [match[1]];
          }),
        ),
      ];

      if (localNames.length === 0) continue;
      if (reexports.length > 0) {
        violations.push(`${relative}: mixes local exports with re-exports`);
        continue;
      }
      if (localNames.length !== 1) {
        violations.push(`${relative}: exports ${localNames.join(", ")}`);
        continue;
      }
      const stem = path.basename(file, ".ts");
      if (stem !== localNames[0]) {
        violations.push(`${relative}: exports ${localNames[0]} but file is ${stem}.ts`);
      }
    }
  }

  TestValidator.equals("source export convention violations", violations, []);
};
