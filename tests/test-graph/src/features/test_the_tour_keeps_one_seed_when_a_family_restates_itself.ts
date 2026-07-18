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
 * A family of names that restate each other takes one tour seed, not all of
 * them.
 *
 * `paint`, `paintScene`, and `paintSceneNow` live in one file and each name
 * contains the shorter one word for word — the same shape as Excalidraw's
 * `handlePointerMove` beside its `...InEditMode` sibling, where four of the five
 * seeds went to one gesture and the mutation and history layers the question
 * named took none. The greedy set cover picks the highest scorer, and every
 * remaining candidate only says again what that pick already says, so the cover
 * runs out of anything new to add and stops with the one seed. An unranked tour
 * would have spent three of its slots restating a single fact.
 */
export const test_the_tour_keeps_one_seed_when_a_family_restates_itself =
  async () => {
    const root = GraphPaths.createTempDirectory("samchon-graph-restate-");
    write(root, "src/paint.ts", [
      "function stroke(): void {}",
      "export function paint(): void { stroke(); }",
      "export function paintScene(): void { stroke(); }",
      "export function paintSceneNow(): void { stroke(); }",
    ]);

    const dump = await buildGraphDump({
      cwd: root,
      mode: "static",
      languages: ["typescript"],
    });
    const app = new SamchonGraphApplication(SamchonGraphMemory.from(dump));
    const tour = (
      await app.inspect_code_graph({
        question: "how does the project paint a scene",
        draft: { reason: "Orientation.", type: "tour" },
        review: "Tour.",
        request: { type: "tour", reinterpretations: ["paint scene now"] },
      })
    ).result as ISamchonGraphTour;

    const family = tour.entrypoints.filter((node) =>
      node.name.startsWith("paint"),
    );
    TestValidator.equals(
      "restating siblings collapse to one tour seed",
      family.map((node) => node.name),
      ["paintSceneNow"],
    );
  };

const write = (root: string, file: string, lines: string[]): void => {
  const abs = path.join(root, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${lines.join("\n")}\n`);
};
