import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { ContractParity } from "./internal/ContractParity";
import { GraphPaths } from "./internal/GraphPaths";

/**
 * Regenerate the canonical contract from a local `samchon/ttsc` checkout.
 *
 * This is parity development, not a package test. The checked-in canonical
 * fixture exists precisely so `pnpm test` never needs a second repository; this
 * tool is how that fixture is derived, and it is the only thing that ever reads
 * the reference.
 *
 * The reference path is an argument rather than a constant. A path that happens
 * to be right on one maintainer's disk is not a contract, and baking one in
 * would make the tool lie everywhere else.
 *
 *   node lib/parity.mjs --reference=<path to a samchon/ttsc checkout> [--diff]
 */
const argumentOf = (key: string): string | undefined => {
  const prefix = `--${key}=`;
  const found: string | undefined = process.argv
    .slice(2)
    .find((arg) => arg.startsWith(prefix));
  return found === undefined ? undefined : found.slice(prefix.length).trim();
};

const git = (repository: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();

const main = (): void => {
  const reference: string | undefined = argumentOf("reference");
  const showDiff: boolean = process.argv.slice(2).includes("--diff");
  if (reference === undefined || reference === "") {
    console.error(
      "usage: node lib/parity.mjs --reference=<path to a samchon/ttsc checkout> [--diff]",
    );
    process.exit(1);
  }
  if (!fs.existsSync(path.join(reference, ".git"))) {
    console.error(`parity: ${reference} is not a git checkout`);
    process.exit(1);
  }

  // The commit is provenance, so it has to describe the text that was actually
  // read. A dirty checkout would record a commit whose contents are not what
  // landed in the fixture.
  const dirty: string = git(reference, "status", "--porcelain");
  if (dirty !== "") {
    console.error(
      `parity: ${reference} has uncommitted changes, so no commit describes the\n` +
        `contract that would be captured. Commit or stash them first.\n\n${dirty}`,
    );
    process.exit(1);
  }
  const commit: string = git(reference, "rev-parse", "HEAD");
  const directory = "packages/graph/src";

  const contracts: Record<string, ContractParity.IContract> = {};
  for (const [name, entry] of Object.entries(ContractParity.CONTRACTS)) {
    const file: string = path.join(reference, directory, entry.reference);
    if (!fs.existsSync(file)) {
      console.error(`parity: the reference has no ${entry.reference}`);
      process.exit(1);
    }
    const source: string = fs.readFileSync(file, "utf8");
    contracts[name] = {
      structure: ContractParity.normalize(source, "structure"),
      prose: ContractParity.normalize(source, "prose"),
    };
  }

  const canonical: ContractParity.ICanonical = {
    reference: { repository: "samchon/ttsc", commit, directory },
    contracts,
  };
  // `--diff` is the review pass: report the candidate without replacing the
  // checked-in fixture. A subsequent invocation without it is the deliberate
  // write step, and still refuses to end quietly on a contract it cannot explain.
  if (!showDiff)
    fs.writeFileSync(
      GraphPaths.ttscCanonicalContract,
      `${JSON.stringify(canonical, null, 2)}\n`,
      "utf8",
    );

  console.log(
    `reference: samchon/ttsc @ ${commit}${showDiff ? " (preview)" : ""}`,
  );
  const failed: string[] = [];
  for (const contract of Object.keys(ContractParity.CONTRACTS)) {
    const outcome: string[] = [];
    for (const layer of ["structure", "prose"] as const) {
      try {
        const expected: string = ContractParity.expected(
          contract,
          contracts[contract]![layer],
          layer,
        );
        const actualText: string = ContractParity.actual(contract, layer);
        if (expected === actualText) {
          outcome.push(`${layer} ok`);
        } else {
          outcome.push(`${layer} MISMATCH`);
          if (showDiff) printFirstDiffs(contract, layer, expected, actualText);
        }
      } catch (error) {
        outcome.push(
          `${layer} STALE: ${error instanceof Error ? error.message.split("\n")[1]?.trim() : String(error)}`,
        );
      }
    }
    const ok: boolean = outcome.every((o) => o.endsWith(" ok"));
    if (!ok) failed.push(contract);
    const rules: number = ContractParity.DEVIATIONS[contract]?.length ?? 0;
    console.log(
      `  ${ok ? "ok      " : "FAIL    "} ${contract.padEnd(13)} ${outcome.join(" | ")}${rules === 0 ? "" : `  (${rules} reviewed rule${rules === 1 ? "" : "s"})`}`,
    );
  }

  if (failed.length !== 0) {
    console.error(
      `\nparity: ${failed.join(", ")} no longer reproduce the reference.\n` +
        (showDiff
          ? `The checked-in fixture was not changed; the diff above is the candidate.\n`
          : `The fixture was written, so the mismatch remains inspectable.\n`) +
        `Either the\n` +
        `reference moved in a way nobody reviewed, or this product drifted from it.\n` +
        `Review the difference and record it as a rule; do not loosen the gate.`,
    );
    process.exit(1);
  }
  console.log(
    `\nall ${Object.keys(ContractParity.CONTRACTS).length} contracts reproduce the reference`,
  );
  if (showDiff)
    console.log("preview only; the checked-in canonical fixture was not changed");
};

// Print the first few line-level differences between what the reference should
// become and what this product actually is, so an author enumerating a new
// deviation can read the exact `from`/`to` off the report instead of hunting.
function printFirstDiffs(
  contract: string,
  layer: string,
  expected: string,
  actualText: string,
): void {
  const e: string[] = expected.split("\n");
  const a: string[] = actualText.split("\n");
  const max: number = Math.max(e.length, a.length);
  let shown = 0;
  for (let i = 0; i < max && shown < 6; i++) {
    if (e[i] === a[i]) continue;
    shown++;
    console.log(`    ${contract}/${layer} L${i}`);
    console.log(`      reference-> ${JSON.stringify((e[i] ?? "").slice(0, 400))}`);
    console.log(`      product  -> ${JSON.stringify((a[i] ?? "").slice(0, 400))}`);
  }
}

main();
