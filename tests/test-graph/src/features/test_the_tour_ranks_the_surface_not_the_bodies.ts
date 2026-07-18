import { TestValidator } from "@nestia/e2e";
import {
  buildGraphDump,
  SamchonGraphApplication,
  SamchonGraphMemory,
} from "@samchon/graph";
import type { ISamchonGraphTour } from "@samchon/graph";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

/**
 * A tour ranks and walks the project's surface, and a closure is not on it.
 *
 * Not because a closure is beneath an index — a trace, a lookup, or a details
 * request answers with one. It is because the seed score leans on reach, and
 * reach breaks when it counts them: reach stands in for "gets to the code that
 * does the work", and a method whose body is full of callbacks lands in more
 * files than one that calls three things and means them. A query builder
 * outranked its own insert path on breadth alone, and the tour it led came back a
 * walk through the builder's fluent API while the flow that reaches the driver
 * fell out of the tour entirely. Wide and shallow beat deep and few, and the
 * model went back to the files.
 *
 * So the surface is scored by the surface, and the body is answered when it is
 * asked for.
 */
export const test_the_tour_ranks_the_surface_not_the_bodies = async () => {
  const root = GraphPaths.createTempDirectory("samchon-graph-closure-");
  write(root, "src/engine.ts", [
    "export function runEngine(): void {",
    "  function innerStep(): void {",
    "    leaf();",
    "  }",
    "  innerStep();",
    "}",
    "export function leaf(): void {}",
  ]);

  const dump = await buildGraphDump({ cwd: root, mode: "static", languages: ["typescript"] });
  const inner = dump.nodes.find((node) => node.name === "innerStep");
  const outer = dump.nodes.find((node) => node.name === "runEngine");

  TestValidator.equals(
    "a declaration made inside another declaration's body is a closure",
    inner?.closure,
    true,
  );
  TestValidator.equals(
    "a top-level declaration is not",
    outer?.closure,
    undefined,
  );

  // The closure stays in the index — a trace, a lookup, or a details request
  // answers with it — but the tour does not rank it.
  const app = new SamchonGraphApplication(SamchonGraphMemory.from(dump));
  const tour = (
    await app.inspect_code_graph({
      question: "how does the engine run",
      draft: { reason: "Orientation.", type: "tour" },
      review: "Tour.",
      request: { type: "tour", reinterpretations: [] },
    })
  ).result as ISamchonGraphTour;
  TestValidator.equals(
    "a closure never becomes a tour entrypoint",
    tour.entrypoints.filter((node) => node.name === "runEngine.innerStep"),
    [],
  );

  const lookup = await app.inspect_code_graph({
    question: "where is innerStep declared",
    draft: { reason: "A named symbol.", type: "lookup" },
    review: "Lookup.",
    request: { type: "lookup", query: "innerStep" },
  });
  TestValidator.predicate(
    "but a lookup still answers with it",
    (lookup.result as { hits: { name: string }[] }).hits.some(
      (hit) => hit.name === "runEngine.innerStep",
    ),
  );
};

const write = (root: string, file: string, lines: string[]): void => {
  const abs = path.join(root, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${lines.join("\n")}\n`);
};
