/* c8 ignore start -- Windows-only process gate. Its lifecycle and transport
 * are exercised by Windows integration; POSIX cannot use the IPC launch arm. */
import { spawn } from "node:child_process";

interface ILaunch {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

/**
 * Wait for the parent to attach this process to its private Job Object before
 * spawning the real command. The real child inherits descriptors zero through
 * two directly, so this gate never proxies the provider transport.
 */
process.once("message", (value: unknown) => {
  const launch = launchOf(value);
  process.disconnect();
  const child = spawn(launch.command, launch.args, {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: "inherit",
    windowsHide: true,
    windowsVerbatimArguments: launch.windowsVerbatimArguments,
  });
  child.once("error", (error) => fail(error));
  child.once("exit", (code) => {
    process.exitCode = code ?? 1;
  });
});

process.once("disconnect", () => {
  if (process.exitCode === undefined) process.exitCode = 1;
});

function launchOf(value: unknown): ILaunch {
  if (
    typeof value !== "object" ||
    value === null ||
    !("command" in value) ||
    typeof value.command !== "string" ||
    !("args" in value) ||
    !Array.isArray(value.args) ||
    !value.args.every((entry) => typeof entry === "string") ||
    ("windowsVerbatimArguments" in value &&
      value.windowsVerbatimArguments !== undefined &&
      typeof value.windowsVerbatimArguments !== "boolean")
  ) {
    throw new Error("@samchon/graph: invalid Windows process-gate launch");
  }
  const launch = value as {
    command: string;
    args: string[];
    windowsVerbatimArguments?: boolean;
  };
  return {
    command: launch.command,
    args: [...launch.args],
    ...(launch.windowsVerbatimArguments === undefined
      ? {}
      : {
          windowsVerbatimArguments: launch.windowsVerbatimArguments,
        }),
  };
}

function fail(error: Error): void {
  process.stderr.write(
    `@samchon/graph: process launch failed: ${error.message}\n`,
    () => process.exit(127),
  );
}
/* c8 ignore stop */
