const fs = require("node:fs");
const path = require("node:path");

if (process.env.FAKE_CMAKE_FAIL === "1") process.exit(1);

const bIndex = process.argv.indexOf("-B");
const buildDir = bIndex >= 0 ? process.argv[bIndex + 1] : undefined;
if (buildDir !== undefined && process.env.FAKE_CMAKE_NO_OUTPUT !== "1") {
  fs.writeFileSync(path.join(buildDir, "compile_commands.json"), "[]");
}
process.exit(0);
