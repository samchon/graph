import fs from "node:fs";
import path from "node:path";

import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";

import { GraphPaths } from "../internal/GraphPaths";

export const test_swift_cross_file_extensions_preserve_semantic_ownership =
  async () => {
    const root = GraphPaths.createTempDirectory("samchon-swift-extension-");
    const write = (file: string, source: string): void => {
      fs.writeFileSync(path.join(root, file), source);
    };

    write("Box.swift", "struct Box {}\n");
    write("Runner.swift", "protocol Runner {}\n");
    write(
      "Box+Extension.swift",
      ["extension Box: Runner {", "  func doubled() -> Int { 2 }", "}"].join("\n"),
    );
    write(
      "Local.swift",
      [
        "struct Local {}",
        "extension Local {",
        "  func sameFile() {}",
        "}",
      ].join("\n"),
    );
    write("OtherLocal.swift", "struct Local {}\n");
    write("SharedA.swift", "struct Shared {}\n");
    write("SharedB.swift", "struct Shared {}\n");
    write(
      "Shared+Extension.swift",
      ["extension Shared: Runner {", "  func ambiguous() {}", "}"].join("\n"),
    );

    const dump = await buildGraphDump({
      cwd: root,
      mode: "static",
      languages: ["swift"],
    });
    const node = (file: string, name: string) =>
      dump.nodes.find((candidate) =>
        candidate.file === file && candidate.name === name
      );
    const containedBy = (owner: string | undefined, child: string | undefined) =>
      dump.edges.some(
        (edge) =>
          edge.kind === "contains" &&
          edge.from === owner &&
          edge.to === child,
      );

    const box = node("Box.swift", "Box");
    const runner = node("Runner.swift", "Runner");
    const doubled = node("Box+Extension.swift", "doubled");
    TestValidator.predicate(
      "a cross-file Swift extension attaches its method to the unique receiver",
      doubled?.qualifiedName === "Box.doubled" &&
        containedBy(box?.id, doubled.id),
    );
    TestValidator.predicate(
      "a cross-file Swift extension preserves conformance on its unique receiver",
      dump.edges.some(
        (edge) =>
          edge.kind === "implements" &&
          edge.from === box?.id &&
          edge.to === runner?.id &&
          edge.evidence?.file === "Box+Extension.swift",
      ),
    );

    const local = node("Local.swift", "Local");
    const otherLocal = node("OtherLocal.swift", "Local");
    const sameFile = node("Local.swift", "sameFile");
    TestValidator.predicate(
      "a same-file receiver wins even when another file declares the same name",
      containedBy(local?.id, sameFile?.id) &&
        !containedBy(otherLocal?.id, sameFile?.id),
    );

    const ambiguous = node("Shared+Extension.swift", "ambiguous");
    const shared = dump.nodes.filter(
      (candidate) => candidate.name === "Shared" && candidate.kind === "class",
    );
    TestValidator.predicate(
      "an ambiguous cross-file receiver remains transparent",
      ambiguous?.qualifiedName === "Shared.ambiguous" &&
        shared.length === 2 &&
        shared.every((candidate) =>
          !containedBy(candidate.id, ambiguous.id)
        ),
    );
    TestValidator.predicate(
      "an ambiguous Swift extension does not assign conformance to either receiver",
      shared.every((candidate) =>
        !dump.edges.some(
          (edge) =>
            edge.kind === "implements" &&
            edge.from === candidate.id &&
            edge.to === runner?.id,
        )
      ),
    );
  };
