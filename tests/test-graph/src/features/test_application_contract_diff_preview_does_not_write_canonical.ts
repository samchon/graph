import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { TestValidator } from "@nestia/e2e";

import { ContractParity } from "../internal/ContractParity";
import { GraphPaths } from "../internal/GraphPaths";

/** `--diff` reviews a candidate canonical without replacing the checked-in one. */
export const test_application_contract_diff_preview_does_not_write_canonical =
  () => {
    const root: string = GraphPaths.createTempDirectory(
      "samchon-graph-parity-preview-",
    );
    try {
      const previewRoot: string = path.join(root, "graph");
      const reference: string = path.join(root, "ttsc");
      const parity: string = path.join(
        previewRoot,
        "tests",
        "test-graph",
        "lib",
        "parity.mjs",
      );
      const destination: string = path.join(
        previewRoot,
        "tests",
        "test-graph",
        "src",
        "internal",
        "ttsc-canonical-contract.json",
      );
      fs.mkdirSync(path.dirname(parity), { recursive: true });
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(path.join(previewRoot, "pnpm-workspace.yaml"), "");
      fs.copyFileSync(
        path.join(
          GraphPaths.repositoryRoot,
          "tests",
          "test-graph",
          "lib",
          "parity.mjs",
        ),
        parity,
      );

      const canonical: ContractParity.ICanonical = ContractParity.canonical();
      for (const [name, entry] of Object.entries(ContractParity.CONTRACTS)) {
        const referenceFile: string = path.join(
          reference,
          canonical.reference.directory,
          entry.reference,
        );
        fs.mkdirSync(path.dirname(referenceFile), { recursive: true });
        // Normalization folds each complete JSDoc block to a valid one-line
        // comment, so canonical prose is itself a valid synthetic source that
        // deterministically reproduces both fidelities.
        fs.writeFileSync(
          referenceFile,
          canonical.contracts[name]!.prose,
          "utf8",
        );

        const productFile: string = path.join(
          previewRoot,
          "packages",
          "graph",
          "src",
          entry.product,
        );
        fs.mkdirSync(path.dirname(productFile), { recursive: true });
        fs.copyFileSync(
          path.join(GraphPaths.graphPackageRoot, "src", entry.product),
          productFile,
        );
      }
      execFileSync("git", ["init"], { cwd: reference, stdio: "ignore" });
      execFileSync("git", ["add", "."], { cwd: reference, stdio: "ignore" });
      execFileSync(
        "git",
        [
          "-c",
          "user.name=Contract Parity",
          "-c",
          "user.email=parity@example.com",
          "commit",
          "-m",
          "fixture",
        ],
        { cwd: reference, stdio: "ignore" },
      );

      const sentinel: string = '{"sentinel":"reviewed canonical"}\n';
      fs.writeFileSync(destination, sentinel, "utf8");
      const preview = spawnSync(
        process.execPath,
        [parity, `--reference=${reference}`, "--diff"],
        { encoding: "utf8" },
      );
      if (preview.error !== undefined) throw preview.error;
      if (preview.status !== 0)
        throw new Error(
          `parity diff preview failed:\n${preview.stdout}\n${preview.stderr}`,
        );
      TestValidator.equals(
        "the diff preview leaves the canonical untouched",
        fs.readFileSync(destination, "utf8"),
        sentinel,
      );

      const write = spawnSync(
        process.execPath,
        [parity, `--reference=${reference}`],
        { encoding: "utf8" },
      );
      if (write.error !== undefined) throw write.error;
      if (write.status !== 0)
        throw new Error(`parity write failed:\n${write.stdout}\n${write.stderr}`);
      TestValidator.notEquals(
        "the write mode replaces the canonical under the same inputs",
        fs.readFileSync(destination, "utf8"),
        sentinel,
      );
    } finally {
      fs.rmSync(root, { force: true, recursive: true });
    }
  };
