/* c8 ignore start -- Windows-only gated child entrypoint. Its process-tree
 * contract is exercised by the Windows lifecycle integration lane, while
 * POSIX coverage cannot execute a Windows Job Object. */
import { spawn } from "node:child_process";
import fs from "node:fs";

interface ILaunch {
  command: string;
  args: string[];
  windowsVerbatimArguments: boolean;
}

function main(): void {
  const encoded = process.env.SAMCHON_GRAPH_OWNED_COMMAND;
  const marker = process.env.SAMCHON_GRAPH_OWNED_GATE;
  delete process.env.SAMCHON_GRAPH_OWNED_COMMAND;
  delete process.env.SAMCHON_GRAPH_OWNED_GATE;
  if (
    process.platform !== "win32" ||
    encoded === undefined ||
    marker === undefined
  ) {
    fail("invalid Windows process-supervisor invocation");
    return;
  }
  let launch: ILaunch;
  try {
    const value = JSON.parse(
      Buffer.from(encoded, "base64").toString("utf8"),
    ) as Partial<ILaunch>;
    if (
      typeof value.command !== "string" ||
      value.command === "" ||
      !Array.isArray(value.args) ||
      value.args.some((argument) => typeof argument !== "string") ||
      typeof value.windowsVerbatimArguments !== "boolean"
    ) {
      throw new TypeError("invalid launch payload");
    }
    launch = value as ILaunch;
  } catch (error) {
    fail(
      `invalid Windows process-supervisor payload: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return;
  }

  waitForGate(marker, () => {
    const child = spawn(launch.command, launch.args, {
      cwd: process.cwd(),
      env: process.env,
      detached: false,
      stdio: "inherit",
      windowsHide: true,
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
    });
    let settled = false;
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      fail(`could not start owned Windows command: ${error.message}`);
    });
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      process.exit(code === null ? 1 : code);
    });
  });
}

function waitForGate(marker: string, launch: () => void): void {
  if (fs.existsSync(marker)) {
    fs.rmSync(marker, { force: true });
    launch();
    return;
  }
  setTimeout(() => waitForGate(marker, launch), 5);
}

function fail(message: string): void {
  process.stderr.write(`@samchon/graph: ${message}\n`, () => process.exit(1));
}

main();
/* c8 ignore stop */
