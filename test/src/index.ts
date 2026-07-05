const { DynamicExecutor } = require("@nestia/e2e");
const path = require("node:path");

const getArguments = (key) => {
  const prefix = `--${key}=`;
  return process.argv
    .slice(2)
    .filter((arg) => arg.startsWith(prefix))
    .flatMap((arg) => arg.slice(prefix.length).split(","))
    .map((arg) => arg.trim())
    .filter(Boolean);
};

const main = async () => {
  const include = getArguments("include");
  const exclude = getArguments("exclude");
  const started = Date.now();
  const report = await DynamicExecutor.validate({
    prefix: "test_",
    location: path.join(process.cwd(), "test", "src", "features"),
    extension: "ts",
    parameters: () => [],
    onComplete: (exec) => {
      if (exec.error === null) {
        const elapsed = Math.max(
          0,
          new Date(exec.completed_at).getTime() -
            new Date(exec.started_at).getTime(),
        );
        console.log(`  - \x1b[32m${exec.name}\x1b[0m: \x1b[33m${elapsed.toLocaleString()} ms\x1b[0m`);
      } else {
        console.log(`  - \x1b[32m${exec.name}\x1b[0m: \x1b[31m${exec.error.name}\x1b[0m`);
      }
    },
    filter: (file) =>
      (include.length ? include.some((name) => file.includes(name)) : true) &&
      (exclude.length ? exclude.every((name) => !file.includes(name)) : true),
  });

  if (report.executions.length === 0) {
    const reason = include.length
      ? `No tests matched --include=${include.join(",")}`
      : "No tests were discovered under test/src/features";
    console.error(reason);
    process.exit(1);
  }

  const errors = report.executions
    .filter((exec) => exec.error !== null)
    .map((exec) => exec.error);
  for (const error of errors) console.error(error);
  console.log(errors.length ? "Failed" : "Success");
  console.log(
    "Elapsed time",
    Math.max(0, Date.now() - started).toLocaleString(),
    "ms",
  );
  if (errors.length) process.exit(1);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
