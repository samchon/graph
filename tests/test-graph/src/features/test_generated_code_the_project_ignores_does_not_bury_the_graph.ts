import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";
import cp from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

/**
 * Generated code the project does not check in does not get to bury the graph.
 *
 * The source walk already skips the directories generated code conventionally
 * lives in, and that covers most of it. What it cannot cover is codegen emitted
 * *into the source tree* — a Prisma client, an OpenAPI stub — which is real
 * source by every test the walk applies, is routinely larger than the code that
 * uses it, and would otherwise dominate every ranking the graph does.
 *
 * The project has already said which files those are: they are the ones it does
 * not check in. So the question goes to git rather than to a filename guess —
 * the same answer in a repository whose directories are named in Japanese, and
 * the same mechanism the reference's own builder uses.
 *
 * The four demotions the operations layer applies to `ignored` nodes were dead
 * code until this: nothing in the port ever set the flag, so a schema promised a
 * fact the code never established.
 */
export const test_generated_code_the_project_ignores_does_not_bury_the_graph =
  async () => {
    const root = GraphPaths.createTempDirectory("samchon-graph-ignored-");
    // A generated client emitted straight into src/, and a .gitignore that says
    // so. Nothing about the path looks generated; only the project knows.
    write(root, ".gitignore", ["src/client.ts"]);
    write(root, "src/client.ts", [
      "export class GeneratedClient {",
      "  send(): void {}",
      "}",
    ]);
    write(root, "src/order.ts", [
      "export class OrderService {",
      "  create(): void {}",
      "}",
    ]);
    if (!gitInit(root)) return;

    const dump = await buildGraphDump({
      cwd: root,
      mode: "static",
      languages: ["typescript"],
    });
    const flagOf = (name: string): boolean | undefined =>
      dump.nodes.find((node) => node.name === name)?.ignored;

    TestValidator.equals(
      "a file the project does not check in is generated code",
      flagOf("GeneratedClient"),
      true,
    );
    TestValidator.equals(
      "and a file it does check in is not",
      flagOf("OrderService"),
      undefined,
    );

    await scenario_a_project_git_cannot_answer_for();
  };

/**
 * A project that is not a git repository has no such fact, and nothing is
 * flagged. That is not a failure — it is the honest answer to a question nobody
 * here can answer, and it is what §0 means by never inventing one.
 */
const scenario_a_project_git_cannot_answer_for = async () => {
  const root = GraphPaths.createTempDirectory("samchon-graph-nogit-");
  write(root, "src/order.ts", ["export class OrderService {}"]);
  const dump = await buildGraphDump({
    cwd: root,
    mode: "static",
    languages: ["typescript"],
  });
  TestValidator.equals(
    "a project git cannot answer for flags nothing",
    dump.nodes.filter((node) => node.ignored === true),
    [],
  );
};

/** True when a repository could actually be created here. */
const gitInit = (root: string): boolean => {
  const run = (...args: string[]): boolean =>
    cp.spawnSync("git", args, { cwd: root, windowsHide: true }).status === 0;
  return run("init") && run("config", "user.email", "t@t") && run("config", "user.name", "t");
};

const write = (root: string, file: string, lines: string[]): void => {
  const abs = path.join(root, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${lines.join("\n")}\n`);
};
