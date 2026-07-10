const fs = require("node:fs");
const path = require("node:path");

if (process.env.FAKE_PUB_FAIL === "1") process.exit(1);

const dartToolDir = path.join(process.cwd(), ".dart_tool");
fs.mkdirSync(dartToolDir, { recursive: true });
fs.writeFileSync(path.join(dartToolDir, "package_config.json"), "{}");
process.exit(0);
