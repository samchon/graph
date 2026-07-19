import fs from "node:fs";
import path from "node:path";

import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";

import { GraphPaths } from "../internal/GraphPaths";

/**
 * Swift writes a superclass and a protocol conformance in one `:` list --
 * `class Child: Base, Runner` -- so the head alone cannot say which is an
 * `extends` and which an `implements`. The static lane reads every entry of the
 * list as a provisional supertype and lets each target's own kind settle the
 * relation: a class base extends, a protocol conformance implements.
 */
export const test_swift_static_inheritance_links_classes_and_protocols =
  async () => {
    const root = GraphPaths.createTempDirectory("samchon-swift-inherit-");
    fs.writeFileSync(
      path.join(root, "types.swift"),
      [
        "class Base {}",
        "protocol Runner {}",
        "class Child: Base, Runner {}",
        "enum Outcome: Runner { case ready }",
      ].join("\n"),
    );
    const dump = await buildGraphDump({
      cwd: root,
      mode: "static",
      languages: ["swift"],
    });

    const child = dump.nodes.find(
      (node) => node.name === "Child" && node.kind === "class",
    );
    const base = dump.nodes.find(
      (node) => node.name === "Base" && node.kind === "class",
    );
    const runner = dump.nodes.find((node) => node.name === "Runner");
    const outcome = dump.nodes.find(
      (node) => node.name === "Outcome" && node.kind === "enum",
    );

    TestValidator.predicate(
      "a swift class extends the class in its inheritance list",
      dump.edges.some(
        (edge) =>
          edge.kind === "extends" &&
          edge.from === child?.id &&
          edge.to === base?.id,
      ),
    );
    TestValidator.predicate(
      "a swift class implements the protocol in the same list",
      dump.edges.some(
        (edge) =>
          edge.kind === "implements" &&
          edge.from === child?.id &&
          edge.to === runner?.id,
      ),
    );
    TestValidator.predicate(
      "a swift enum preserves its protocol conformance",
      dump.edges.some(
        (edge) =>
          edge.kind === "implements" &&
          edge.from === outcome?.id &&
          edge.to === runner?.id,
      ),
    );
  };
