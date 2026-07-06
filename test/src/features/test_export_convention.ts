const fs = require("node:fs");
const path = require("node:path");
const { TestValidator } = require("@nestia/e2e");

const walk = (dir) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs));
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(abs);
  }
  return out.sort();
};

exports.test_source_files_export_only_their_matching_symbol = () => {
  const root = path.join(process.cwd(), "src");
  const violations = [];
  for (const file of walk(root)) {
    const relative = path.relative(process.cwd(), file).replace(/\\/g, "/");
    const text = fs.readFileSync(file, "utf8");
    const exportLines = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("export "));
    const reexports = exportLines.filter((line) =>
      /^export\s+(?:\*|\{)/.test(line),
    );
    const localNames = [
      ...new Set(
        exportLines
          .flatMap((line) => {
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

  TestValidator.equals("source export convention violations", violations, []);
};
