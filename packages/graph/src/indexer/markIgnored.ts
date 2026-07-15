import { spawnSync } from "node:child_process";
import path from "node:path";
import { ISamchonGraphNode } from "../structures";

/**
 * Flag every node the project itself says is generated.
 *
 * `walkSourceFiles` already skips the directories generated code conventionally
 * lives in, and that covers most of it. What it cannot cover is codegen emitted
 * *into the source tree* — a Prisma client, an OpenAPI stub, a `*.g.dart` — which
 * is real source by every test the walk applies, is often larger than the code
 * that uses it, and would otherwise dominate the ranking and bury the authored
 * graph under it.
 *
 * The project has already said which files those are: they are the ones it does
 * not check in. So the question is asked of git rather than guessed from a
 * filename — which is the same answer in a repository whose directories are named
 * in Japanese, and which is what the reference's own builder does.
 *
 * A project that is not a git repository, or a machine with no git, simply has no
 * such fact, and nothing is flagged. That is not a failure: it is the honest
 * answer to a question nobody can answer here.
 */
export function markIgnored(
  root: string,
  nodes: readonly ISamchonGraphNode[],
): void {
  const files = [
    ...new Set(
      nodes
        .filter((node) => !node.external && node.file !== "")
        .map((node) => node.file),
    ),
  ];
  if (files.length === 0) return;
  const ignored = gitIgnoredFiles(root, files);
  if (ignored.size === 0) return;
  for (const node of nodes) {
    if (ignored.has(node.file)) node.ignored = true;
  }
}

/**
 * Which of these project-relative paths git ignores.
 *
 * One `git check-ignore --stdin` over the whole list: git answers with the
 * subset it ignores, and it applies every rule the project actually has —
 * `.gitignore` at any depth, `.git/info/exclude`, the global excludes file — in
 * the order git itself resolves them. Reimplementing that is a guess; asking is
 * a fact.
 */
function gitIgnoredFiles(
  root: string,
  files: readonly string[],
): ReadonlySet<string> {
  const result = spawnSync("git", ["check-ignore", "--stdin"], {
    cwd: root,
    input: files.join("\n"),
    encoding: "utf8",
    windowsHide: true,
    // A generated tree can be very large, and the answer is one path per line.
    maxBuffer: 64 * 1024 * 1024,
  });
  // Exit 0 means some paths are ignored, 1 means none are, and anything else —
  // no git, not a repository, a broken index — means the project cannot answer,
  // so nothing is flagged rather than everything being guessed at.
  /* c8 ignore next */
  if (result.status !== 0 || result.stdout === undefined) return new Set();
  return new Set(
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .map((line) => path.posix.normalize(line.split("\\").join("/"))),
  );
}
