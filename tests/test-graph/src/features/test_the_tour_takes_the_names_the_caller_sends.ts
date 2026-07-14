import { TestValidator } from "@nestia/e2e";
import { SamchonGraphApplication, SamchonGraphMemory } from "@samchon/graph";
import type { ISamchonGraphDump, ISamchonGraphTour } from "@samchon/graph";

/**
 * §4h: let the caller name the machinery — as names, not as words, and let the
 * graph adjudicate.
 *
 * A tour ranked on the question's vocabulary lets the question's *words* pick it,
 * and a codebase names many things alike: a question about tracking matches the
 * debug hook named after tracking as readily as the function that does it. So the
 * caller says which one it means, in `reinterpretations`.
 *
 * Everything that matters is in how they are consumed:
 *
 * - **Resolve each name; never rank its words.** A name is not a word. Ranked as
 *   text, `setupRenderEffect` is shredded into "setup", "render", "effect", and
 *   the tour opens on `queuePostRenderEffect` instead.
 * - **Drop what the graph cannot pin down.** A name it has never heard of is
 *   dropped, and so is one it holds several of — resolving to the first candidate
 *   is the graph inventing a belief the caller did not have. Dropping is what
 *   makes a wrong guess free, and what makes prose harmless.
 * - **Give the names half the seeds, and keep the other half honest.** A caller
 *   cannot name what it does not know is there.
 */
export const test_the_tour_takes_the_names_the_caller_sends = async () => {
  const app = new SamchonGraphApplication(SamchonGraphMemory.from(dumpOf()));
  const tourOf = async (reinterpretations: string[]): Promise<ISamchonGraphTour> =>
    (
      await app.inspect_code_graph({
        question: "how does a reactive state change reach the DOM",
        draft: { reason: "One tour is the whole orientation.", type: "tour" },
        review: "Tour.",
        request: { type: "tour", reinterpretations, limit: 4 },
      })
    ).result as ISamchonGraphTour;

  // A name the graph holds is the caller's belief about where the answer lives,
  // and it is worth a seat.
  const named = await tourOf(["setupRenderEffect"]);
  TestValidator.predicate(
    "a resolved name takes one of the tour's seats",
    named.entrypoints.some((node) => node.name === "setupRenderEffect"),
  );
  // Half the seeds stay with what the graph finds central, so the symbol the
  // caller did not think to name is still on the tour.
  TestValidator.predicate(
    "the graph's own centre keeps the other half",
    named.entrypoints.some((node) => node.name === "patch"),
  );

  // A name the graph has never heard of is dropped without ceremony, so a wrong
  // guess costs nothing and a repository the caller has never seen is safe to
  // guess about. Prose resolves to nothing, so it is harmless too.
  const guessed = await tourOf([
    "NoSuchSymbolInThisRepository",
    "the public API and its runtime path",
  ]);
  TestValidator.equals(
    "a name the graph does not know costs the tour nothing",
    guessed.entrypoints.map((node) => node.name).sort(),
    (await tourOf([])).entrypoints.map((node) => node.name).sort(),
  );

  // A name the project declares more than once is a word, and the graph does not
  // get to decide which one was meant: resolving to the first candidate hands the
  // tour to whichever declaration it visited first.
  const ambiguous = await tourOf(["render"]);
  TestValidator.equals(
    "an ambiguous name is dropped exactly like an unknown one",
    ambiguous.entrypoints.map((node) => node.name).sort(),
    (await tourOf([])).entrypoints.map((node) => node.name).sort(),
  );

  // The tour asks for no question of its own, and echoes none back: returning the
  // caller's own string, two lines below where it wrote it, is bytes for nothing.
  TestValidator.equals(
    "the tour echoes no query back at the caller that wrote it",
    "query" in (named as object),
    false,
  );
};

/**
 * A graph whose centre (`patch`, published and load-bearing) is not what the
 * caller would name, beside a symbol the caller *would* name
 * (`setupRenderEffect`), beside a name the project declares twice (`render`).
 */
const dumpOf = (): ISamchonGraphDump => ({
  project: "/reactive",
  languages: ["typescript"],
  indexer: "static",
  nodes: [
    symbol("src/renderer.ts#setupRenderEffect:function", "setupRenderEffect", 1),
    symbol("src/renderer.ts#queuePostRenderEffect:function", "queuePostRenderEffect", 5),
    symbol("src/renderer.ts#patch:function", "patch", 9),
    symbol("src/renderer.ts#mount:function", "mount", 13),
    symbol("src/renderer.ts#unmount:function", "unmount", 17),
    // Two `render`s: a name the project declares twice is not a name it does not
    // declare, but it is not a name the caller can hand the tour either.
    symbol("src/renderer.ts#render:function", "render", 21),
    symbol("src/compiler.ts#render:function", "render", 1),
  ],
  edges: [
    // A barrel publishes the surface, so the export fan-in is a real count.
    exportsEdge("src/index.ts", "src/renderer.ts#patch:function"),
    exportsEdge("src/renderer.ts", "src/renderer.ts#patch:function"),
    exportsEdge("src/renderer.ts", "src/renderer.ts#setupRenderEffect:function"),
    exportsEdge("src/renderer.ts", "src/renderer.ts#queuePostRenderEffect:function"),
    exportsEdge("src/renderer.ts", "src/renderer.ts#mount:function"),
    exportsEdge("src/renderer.ts", "src/renderer.ts#unmount:function"),
    exportsEdge("src/renderer.ts", "src/renderer.ts#render:function"),
    exportsEdge("src/compiler.ts", "src/compiler.ts#render:function"),
    // `patch` is the spine: everything runs through it.
    callsEdge("src/renderer.ts#setupRenderEffect:function", "src/renderer.ts#patch:function"),
    callsEdge("src/renderer.ts#queuePostRenderEffect:function", "src/renderer.ts#patch:function"),
    callsEdge("src/renderer.ts#render:function", "src/renderer.ts#patch:function"),
    callsEdge("src/renderer.ts#patch:function", "src/renderer.ts#mount:function"),
    callsEdge("src/renderer.ts#patch:function", "src/renderer.ts#unmount:function"),
  ],
});

const symbol = (id: string, name: string, line: number) => ({
  id,
  kind: "function" as const,
  language: "typescript" as const,
  name,
  file: id.slice(0, id.indexOf("#")),
  external: false,
  exported: true,
  evidence: { startLine: line, endLine: line + 2 },
});

const callsEdge = (from: string, to: string) => ({
  from,
  to,
  kind: "calls" as const,
  evidence: { startLine: 2 },
});

const exportsEdge = (from: string, to: string) => ({
  from,
  to,
  kind: "exports" as const,
});
