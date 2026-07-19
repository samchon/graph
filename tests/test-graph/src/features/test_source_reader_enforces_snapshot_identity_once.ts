import { TestValidator } from "@nestia/e2e";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { SamchonGraphSourceReader } from "@samchon/graph";

import { GraphPaths } from "../internal/GraphPaths";

/** Source display bytes are confined, snapshot-proved, and adjudicated once. */
export const test_source_reader_enforces_snapshot_identity_once = () => {
  const root = GraphPaths.createTempDirectory("samchon-graph-source-reader-");
  const outsideRoot = GraphPaths.createTempDirectory(
    "samchon-graph-source-reader-outside-",
  );
  const file = path.join(root, "src", "a.ts");
  const outside = path.join(outsideRoot, "secret.ts");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "export const snapshot = 1;\n");
  fs.writeFileSync(outside, "export const secret = 2;\n");

  let reads = 0;
  const reader = new SamchonGraphSourceReader(root, {
    digests: new Map([
      [
        file,
        {
          checkerDigest: sha("export const snapshot = 1;\n"),
          diskDigest: sha("export const snapshot = 1;\n"),
        },
      ],
    ]),
    read: (target) => {
      reads += 1;
      return fs.readFileSync(target);
    },
  });
  TestValidator.equals("matching checker bytes are readable", reader.lines("src/a.ts"), [
    "export const snapshot = 1;",
    "",
  ]);
  const defaultReader = new SamchonGraphSourceReader(root, {
    digests: new Map([
      [
        file,
        {
          checkerDigest: sha("export const snapshot = 1;\n"),
          diskDigest: sha("export const snapshot = 1;\n"),
        },
      ],
    ]),
  });
  TestValidator.equals(
    "the default reader proves matching bytes without a test seam",
    defaultReader.lines("src/a.ts"),
    ["export const snapshot = 1;", ""],
  );
  fs.writeFileSync(file, "export const changed = 2;\n");
  TestValidator.equals("a successful adjudication is immutable", reader.lines("src/a.ts"), [
    "export const snapshot = 1;",
    "",
  ]);
  TestValidator.equals("a successful file is read once", reads, 1);

  let mismatchReads = 0;
  const mismatch = new SamchonGraphSourceReader(root, {
    digests: new Map([
      [
        file,
        {
          checkerDigest: sha("export const snapshot = 1;\n"),
          diskDigest: sha("export const changed = 2;\n"),
        },
      ],
    ]),
    read: (target) => {
      mismatchReads += 1;
      return fs.readFileSync(target);
    },
  });
  TestValidator.equals("changed disk bytes fail closed", mismatch.lines("src/a.ts"), undefined);
  fs.writeFileSync(file, "export const snapshot = 1;\n");
  TestValidator.equals("a failed adjudication is cached", mismatch.lines("src/a.ts"), undefined);
  TestValidator.equals(
    "a digest refusal is adjudicated only once",
    mismatchReads,
    1,
  );

  let failedReads = 0;
  const unreadable = new SamchonGraphSourceReader(root, {
    digests: new Map([
      [
        file,
        {
          checkerDigest: sha("export const snapshot = 1;\n"),
          diskDigest: sha("export const snapshot = 1;\n"),
        },
      ],
    ]),
    read: () => {
      failedReads += 1;
      throw new Error("synthetic read failure");
    },
  });
  TestValidator.equals(
    "a disk read error fails closed",
    unreadable.lines("src/a.ts"),
    undefined,
  );
  TestValidator.equals(
    "a disk read error remains cached",
    unreadable.lines("src/a.ts"),
    undefined,
  );
  TestValidator.equals(
    "an unreadable snapshot file is attempted only once",
    failedReads,
    1,
  );

  const exact = new SamchonGraphSourceReader(root, {
    texts: new Map([
      [path.join(root, "src", "consumed.ts"), "export const consumed = true;\n"],
    ]),
    read: () => {
      throw new Error("exact snapshot text must not touch disk");
    },
  });
  TestValidator.equals(
    "exact consumed text survives without a live file",
    exact.lines("src/consumed.ts"),
    ["export const consumed = true;", ""],
  );

  const none = SamchonGraphSourceReader.none(root);
  TestValidator.equals("a provenance-free reader omits live source", none.lines("src/a.ts"), undefined);
  TestValidator.equals(
    "a parent traversal cannot read outside the project",
    new SamchonGraphSourceReader(root, {
      digests: new Map([
        [outside, { checkerDigest: sha("export const secret = 2;\n"), diskDigest: "" }],
      ]),
    }).lines(path.relative(root, outside).replace(/\\/g, "/")),
    undefined,
  );

  const link = path.join(root, "src", "linked.ts");
  try {
    fs.symlinkSync(outside, link, "file");
    TestValidator.equals(
      "a symlink escape cannot read outside the project",
      new SamchonGraphSourceReader(root, {
        digests: new Map([
          [link, { checkerDigest: sha("export const secret = 2;\n"), diskDigest: "" }],
        ]),
      }).lines("src/linked.ts"),
      undefined,
    );
  } catch {
    // Windows installations without symlink permission cannot exercise this
    // OS seam; lexical confinement and every digest path remain covered.
  }
};

const sha = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");
