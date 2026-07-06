import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const getArguments = (key: string): string[] => {
  const prefix = `--${key}=`;
  return process.argv
    .slice(2)
    .filter((arg) => arg.startsWith(prefix))
    .flatMap((arg) => arg.slice(prefix.length).split(","))
    .map((arg) => arg.trim())
    .filter(Boolean);
};

interface Execution {
  name: string;
  location: string;
  error: Error | null;
  started_at: string;
  completed_at: string;
}

const walk = async (dir: string): Promise<string[]> => {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(abs)));
    else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".mjs"))) out.push(abs);
  }
  return out.sort();
};

const main = async (): Promise<void> => {
  const include = getArguments("include");
  const exclude = getArguments("exclude");
  const started = Date.now();
  const location = path.join(path.dirname(fileURLToPath(import.meta.url)), "features");
  const files = (await walk(location)).filter((file) => {
    const name = path.basename(file);
    return (
      name.startsWith("test_") &&
      (include.length ? include.some((name) => file.includes(name)) : true) &&
      (exclude.length ? exclude.every((name) => !file.includes(name)) : true)
    );
  });

  if (files.length === 0) {
    const reason = include.length
      ? `No tests matched --include=${include.join(",")}`
      : "No tests were discovered under tests/test-graph/src/features";
    console.error(reason);
    process.exit(1);
  }

  const executions: Execution[] = [];
  for (const file of files) {
    const modulo = await import(pathToFileURL(file).href);
    const entries = Object.entries(modulo).filter(
      (entry): entry is [string, () => unknown | Promise<unknown>] =>
        entry[0].startsWith("test_") && typeof entry[1] === "function",
    );
    if (entries.length !== 1) {
      throw new Error(`${path.relative(path.dirname(location), file)} must export exactly one test_* function.`);
    }
    const [name, closure] = entries[0]!;
    const exec: Execution = {
      name,
      location: file,
      error: null,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    };
    executions.push(exec);
    try {
      await closure();
    } catch (error) {
      exec.error = error instanceof Error ? error : new Error(String(error));
    } finally {
      exec.completed_at = new Date().toISOString();
      if (exec.error === null) {
        const elapsed = Math.max(
          0,
          new Date(exec.completed_at).getTime() - new Date(exec.started_at).getTime(),
        );
        console.log(`  - \x1b[32m${exec.name}\x1b[0m: \x1b[33m${elapsed.toLocaleString()} ms\x1b[0m`);
      } else {
        console.log(`  - \x1b[32m${exec.name}\x1b[0m: \x1b[31m${exec.error.name}\x1b[0m`);
      }
    }
  }

  const errors = executions.filter((exec) => exec.error !== null).map((exec) => exec.error);
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
