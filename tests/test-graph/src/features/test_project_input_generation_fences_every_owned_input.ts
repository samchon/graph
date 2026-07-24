import { TestValidator } from "@nestia/e2e";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { commitProjectInputGeneration } from "../../../../packages/graph/src/indexer/commitProjectInputGeneration";
import type { IIndexerResult } from "../../../../packages/graph/src/indexer/IIndexerResult";
import { movedConsumedSource } from "../../../../packages/graph/src/indexer/movedConsumedSource";
import { movedProviderSource } from "../../../../packages/graph/src/indexer/movedProviderSource";
import { projectInputManifest } from "../../../../packages/graph/src/indexer/projectInputManifest";
import { providerBuildInputs } from "../../../../packages/graph/src/indexer/providerBuildInputs";
import { sameProjectInputManifest } from "../../../../packages/graph/src/indexer/sameProjectInputManifest";
import { GraphPaths } from "../internal/GraphPaths";
import { ProviderFixtures } from "../internal/ProviderFixtures";

export const test_project_input_generation_fences_every_owned_input =
  async () => {
    const root = GraphPaths.createTempDirectory("samchon-graph-input-commit-");
    const first = path.join(root, "first.ts");
    const second = path.join(root, "second.ts");
    const go = path.join(root, "main.go");
    const missing = path.join(root, "missing.generated");
    fs.writeFileSync(first, "export const first = 1;\n");
    fs.writeFileSync(second, "export const second = 2;\n");
    fs.writeFileSync(go, "package main\n");

    const external = GraphPaths.createTempDirectory(
      "samchon-graph-provider-source-helper-",
    );
    const externalFile = path.join(external, "shared.ts");
    const externalBody = Buffer.from("export const shared = 1;\n");
    fs.writeFileSync(externalFile, externalBody);
    const externalDigest = digest(externalBody);
    TestValidator.equals(
      "an absent provider manifest has no movement",
      movedProviderSource(undefined, new Map(), new Map()),
      undefined,
    );
    TestValidator.equals(
      "a bundled provider source needs no disk identity",
      movedProviderSource(
        new Map([
          [
            "bundled:///typescript/lib",
            { checkerDigest: externalDigest, diskDigest: "" },
          ],
        ]),
        new Map(),
        new Map(),
      ),
      undefined,
    );
    TestValidator.equals(
      "an unchanged external provider source remains bound",
      movedProviderSource(
        new Map([
          [
            externalFile,
            {
              checkerDigest: externalDigest,
              diskDigest: externalDigest,
            },
          ],
        ]),
        new Map(),
        new Map(),
      ),
      undefined,
    );
    TestValidator.predicate(
      "a relative provider source cannot escape the common identity contract",
      movedProviderSource(
        new Map([
          [
            "relative.ts",
            {
              checkerDigest: externalDigest,
              diskDigest: externalDigest,
            },
          ],
        ]),
        new Map(),
        new Map(),
      )?.includes("does not bind") === true,
    );
    TestValidator.predicate(
      "a missing external provider source cannot retain an old digest",
      movedProviderSource(
        new Map([
          [
            path.join(external, "missing.ts"),
            {
              checkerDigest: externalDigest,
              diskDigest: externalDigest,
            },
          ],
        ]),
        new Map(),
        new Map(),
      )?.includes("does not bind") === true,
    );

    const typescript = ProviderFixtures.provider({
      name: "typescript-owner",
      languages: ["typescript"],
      buildInputs: ["first.ts", "shared.generated"],
    });
    const goProvider = ProviderFixtures.provider({
      name: "go-owner",
      languages: ["go"],
      buildInputs: ["shared.generated", "go.generated"],
    });
    const unrelated = ProviderFixtures.provider({
      name: "unrelated",
      languages: ["rust"],
      buildInputs: ["rust.generated"],
    });
    const providers = [typescript, goProvider, unrelated];
    const dynamic = ProviderFixtures.provider({
      name: "dynamic-owner",
      languages: ["go"],
      buildInputs: (projectRoot) => [
        path.relative(projectRoot, path.join(root, "nested", "go.mod")),
      ],
    });

    TestValidator.equals(
      "only participating provider inputs are deduplicated and sorted",
      providerBuildInputs(["typescript", "go"], providers, root)
        .filter((input) =>
          ["first.ts", "go.generated", "shared.generated"].includes(input),
        ),
      ["first.ts", "go.generated", "shared.generated"],
    );
    TestValidator.equals(
      "a provider with no declared build inputs contributes none",
      providerBuildInputs(
        ["typescript"],
        [ProviderFixtures.provider({ name: "source-only" })],
        root,
      ),
      providerBuildInputs(["typescript"], [], root),
    );
    TestValidator.predicate(
      "dynamic build inputs receive the project root and join the common registry",
      providerBuildInputs(["go"], [dynamic], root).includes("nested/go.mod"),
    );

    const dartRoot = GraphPaths.createTempDirectory(
      "samchon-graph-dart-package-input-",
    );
    fs.writeFileSync(path.join(dartRoot, "pubspec.yaml"), "name: fixture\n");
    fs.writeFileSync(path.join(dartRoot, "main.dart"), "void main() {}\n");
    const packageConfig = path.join(
      dartRoot,
      ".dart_tool",
      "package_config.json",
    );
    TestValidator.predicate(
      "a missing generated Dart package config is already a build input",
      providerBuildInputs(["dart"], [], dartRoot).includes(
        ".dart_tool/package_config.json",
      ),
    );
    let dartAttempts = 0;
    const dartCommitted = await commitProjectInputGeneration(
      { cwd: dartRoot, languages: ["dart"] },
      [],
      () => {
        dartAttempts += 1;
        if (!fs.existsSync(packageConfig)) {
          fs.mkdirSync(path.dirname(packageConfig), { recursive: true });
          fs.writeFileSync(packageConfig, '{"configVersion":2}\n');
        }
        return resultOf(dartRoot);
      },
    );
    TestValidator.equals(
      "creating package_config.json during preparation retries the generation",
      [
        dartAttempts,
        dartCommitted.buildInputs?.includes(
          ".dart_tool/package_config.json",
        ),
        dartCommitted.inputManifest?.get(packageConfig) === "missing",
      ],
      [2, true, false],
    );

    const manifest = projectInputManifest(
      root,
      { languages: ["typescript", "go"] },
      ["first.ts", "missing.generated"],
      new Set(["typescript"]),
    );
    TestValidator.equals(
      "provider-owned source contents are coordinator-fenced too",
      manifest.get(second) !== undefined &&
        manifest.get(second) !== "missing",
      true,
    );
    TestValidator.predicate(
      "a declared input overrides source opacity and is hashed",
      manifest.get(first) !== undefined &&
        manifest.get(first) !== "provider-owned" &&
        manifest.get(first) !== "missing",
    );
    TestValidator.predicate(
      "ordinary source contents are hashed",
      manifest.get(go) !== undefined &&
        manifest.get(go) !== "provider-owned" &&
        manifest.get(go) !== "missing",
    );
    TestValidator.equals(
      "a missing declared input remains part of the manifest",
      manifest.get(missing),
      "missing",
    );
    const defaultManifest = projectInputManifest(
      root,
      { languages: ["typescript"] },
      [],
    );
    TestValidator.predicate(
      "the default manifest hashes selected source contents",
      defaultManifest.get(first) !== "provider-owned",
    );
    TestValidator.predicate(
      "equal manifests compare equal",
      sameProjectInputManifest(manifest, new Map(manifest)),
    );
    const changedManifest = new Map(manifest);
    changedManifest.set(second, "different");
    TestValidator.predicate(
      "different manifest values compare unequal",
      !sameProjectInputManifest(manifest, changedManifest),
    );
    TestValidator.predicate(
      "different manifest sizes compare unequal",
      !sameProjectInputManifest(manifest, new Map()),
    );

    const consumed = fs.readFileSync(first, "utf8");
    TestValidator.equals(
      "an unchanged consumed source does not move",
      movedConsumedSource(new Map([[first, consumed]])),
      undefined,
    );
    fs.writeFileSync(first, `${consumed}// moved\n`);
    TestValidator.equals(
      "the first changed consumed source is named",
      movedConsumedSource(new Map([[first, consumed]])),
      first,
    );
    fs.writeFileSync(first, consumed);

    const committed = await commitProjectInputGeneration(
      { cwd: root, languages: ["typescript", "go"] },
      providers,
      () => ({
        ...resultOf(root),
        sources: new Map([
          [first, consumed],
          [second, fs.readFileSync(second, "utf8")],
          [go, fs.readFileSync(go, "utf8")],
        ]),
      }),
    );
    TestValidator.equals(
      "the coordinator no longer excludes provider-owned languages",
      committed.inputManifestLanguages,
      [],
    );
    TestValidator.equals(
      "a stable generation retains the selected providers' build inputs",
      committed.buildInputs,
      providerBuildInputs(["typescript", "go"], providers, root),
    );

    const cleanupRoot = GraphPaths.createTempDirectory(
      "samchon-graph-input-cleanup-",
    );
    const cleanupFile = path.join(cleanupRoot, "index.ts");
    fs.writeFileSync(cleanupFile, "export const value = 1;\n");
    const closeError = new Error("candidate close failed");
    let cleanupFailure: unknown;
    try {
      await commitProjectInputGeneration(
        { cwd: cleanupRoot, languages: ["typescript"] },
        [],
        () => {
          fs.writeFileSync(cleanupFile, "export const value = 2;\n");
          return resultOf(cleanupRoot);
        },
        async () => [closeError],
      );
    } catch (error) {
      cleanupFailure = error;
    }
    TestValidator.predicate(
      "a stale candidate's cleanup failure is retained",
      cleanupFailure instanceof AggregateError &&
        cleanupFailure.errors[0] === closeError,
    );

    const restlessRoot = GraphPaths.createTempDirectory(
      "samchon-graph-input-restless-",
    );
    const restlessFile = path.join(restlessRoot, "index.ts");
    fs.writeFileSync(restlessFile, "export const value = 0;\n");
    let attempts = 0;
    let exhaustion: unknown;
    try {
      await commitProjectInputGeneration(
        { cwd: restlessRoot, languages: ["typescript"] },
        [],
        () => {
          attempts += 1;
          fs.writeFileSync(
            restlessFile,
            `export const value = ${String(attempts)};\n`,
          );
          return resultOf(restlessRoot);
        },
      );
    } catch (error) {
      exhaustion = error;
    }
    TestValidator.predicate(
      "a project that moves through all bounded attempts publishes nothing",
      attempts === 3 &&
        exhaustion instanceof Error &&
        exhaustion.message.includes("all 3 bounded attempts"),
    );

    const unboundRoot = GraphPaths.createTempDirectory(
      "samchon-graph-provider-digest-",
    );
    const unboundFile = path.join(unboundRoot, "index.ts");
    fs.writeFileSync(unboundFile, "export const value = 1;\n");
    let unboundAttempts = 0;
    let unboundFailure: unknown;
    try {
      await commitProjectInputGeneration(
        { cwd: unboundRoot, languages: ["typescript"] },
        [],
        () => {
          unboundAttempts += 1;
          return {
            ...resultOf(unboundRoot),
            providerSourceDigests: new Map([
              [
                unboundFile,
                {
                  checkerDigest: "a".repeat(64),
                  diskDigest: "b".repeat(64),
                },
              ],
            ]),
          };
        },
      );
    } catch (error) {
      unboundFailure = error;
    }
    TestValidator.predicate(
      "a provider digest outside the coordinator generation never publishes",
      unboundAttempts === 3 &&
        unboundFailure instanceof Error &&
        unboundFailure.message.includes("does not bind the provider snapshot"),
    );

    const siblingRoot = GraphPaths.createTempDirectory(
      "samchon-graph-provider-sibling-",
    );
    const siblingFile = path.join(siblingRoot, "shared.ts");
    fs.writeFileSync(siblingFile, "export const shared = 0;\n");
    let siblingAttempts = 0;
    let siblingFailure: unknown;
    try {
      await commitProjectInputGeneration(
        { cwd: unboundRoot, languages: ["typescript"] },
        [],
        () => {
          const consumed = fs.readFileSync(siblingFile);
          siblingAttempts += 1;
          fs.writeFileSync(
            siblingFile,
            `export const shared = ${String(siblingAttempts)};\n`,
          );
          return {
            ...resultOf(unboundRoot),
            providerSourceDigests: new Map([
              [
                siblingFile,
                {
                  checkerDigest: digest(consumed),
                  diskDigest: digest(consumed),
                },
              ],
            ]),
          };
        },
      );
    } catch (error) {
      siblingFailure = error;
    }
    TestValidator.predicate(
      "an external sibling that moves after provider consumption never publishes",
      siblingAttempts === 3 &&
        siblingFailure instanceof Error &&
        siblingFailure.message.includes("does not bind the provider snapshot"),
    );
  };

function digest(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function resultOf(root: string): IIndexerResult {
  return {
    dump: {
      project: root,
      languages: ["typescript"],
      indexer: "static",
      nodes: [],
      edges: [],
    },
    warnings: [],
  };
}
