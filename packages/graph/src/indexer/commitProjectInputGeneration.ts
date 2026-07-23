import path from "node:path";

import { IBulkGraphSession } from "../provider/IBulkGraphSession";
import { IGraphProvider } from "../provider/IGraphProvider";
import { IBuildGraphOptions } from "./IBuildGraphOptions";
import { IIndexerResult } from "./IIndexerResult";
import { movedConsumedSource } from "./movedConsumedSource";
import { projectInputManifest } from "./projectInputManifest";
import { providerBuildInputs } from "./providerBuildInputs";
import { sameProjectInputManifest } from "./sameProjectInputManifest";
import { selectGraphSources } from "./selectGraphSources";

const INPUT_COMMIT_ATTEMPTS = 3;

/** Build one candidate and publish it only if its project generation holds. */
export async function commitProjectInputGeneration(
  options: IBuildGraphOptions,
  providers: readonly IGraphProvider[],
  build: () => Promise<IIndexerResult> | IIndexerResult,
  discard: (result: IIndexerResult) => Promise<Error[]> = async () => [],
): Promise<IIndexerResult> {
  const root = path.resolve(options.cwd ?? process.cwd());
  let lastMovement = "";
  for (let attempt = 1; attempt <= INPUT_COMMIT_ATTEMPTS; attempt++) {
    const beforeLanguages = selectGraphSources(root, options).languages;
    const buildInputs = providerBuildInputs(beforeLanguages, providers, root);
    const before = projectInputManifest(root, options, buildInputs);
    const result = await build();
    const afterLanguages = selectGraphSources(root, options).languages;
    const afterBuildInputs = providerBuildInputs(
      afterLanguages,
      providers,
      root,
    );
    const after = projectInputManifest(root, options, afterBuildInputs);
    const moved =
      result.sources === undefined
        ? undefined
        : movedConsumedSource(result.sources);
    const providerMovement = movedProviderSource(
      result.providerSourceDigests,
      before,
      after,
    );
    if (
      moved === undefined &&
      providerMovement === undefined &&
      sameProjectInputManifest(before, after)
    ) {
      return {
        ...result,
        inputManifest: after,
        inputManifestLanguages: [],
        buildInputs: afterBuildInputs,
      };
    }

    lastMovement =
      moved !== undefined
        ? `${moved} changed after this build consumed it`
        : providerMovement !== undefined
          ? providerMovement
          : "the selected source/config/build input manifest changed while the build was preparing";
    const closeErrors = await discard(result);
    if (closeErrors.length > 0) {
      throw new AggregateError(
        closeErrors,
        `@samchon/graph: ${lastMovement}, and the discarded candidate's sessions could not all close`,
      );
    }
  }
  throw new Error(
    `@samchon/graph: ${lastMovement} in all ${String(INPUT_COMMIT_ATTEMPTS)} bounded attempts, so no mixed-generation graph was published`,
  );
}

function movedProviderSource(
  digests: ReadonlyMap<
    string,
    IBulkGraphSession.ISourceDigest
  > | undefined,
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): string | undefined {
  if (digests === undefined) return undefined;
  for (const [file, digest] of digests) {
    const expectedBefore = before.get(file);
    const expectedAfter = after.get(file);
    if (expectedBefore === undefined && expectedAfter === undefined) continue;
    if (
      digest.diskDigest === "" ||
      digest.diskDigest !== expectedBefore ||
      digest.diskDigest !== expectedAfter
    ) {
      return `${file} does not bind the provider snapshot to the coordinator's input generation`;
    }
  }
  return undefined;
}
