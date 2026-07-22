import path from "node:path";

import { IGraphProvider } from "../provider/IGraphProvider";
import { GraphLanguage } from "../typings";
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
  const opaqueLanguages = new Set<GraphLanguage>(
    providers.flatMap((provider) => [...provider.languages]),
  );
  let lastMovement = "";
  for (let attempt = 1; attempt <= INPUT_COMMIT_ATTEMPTS; attempt++) {
    const beforeLanguages = selectGraphSources(root, options).languages;
    const buildInputs = providerBuildInputs(beforeLanguages, providers);
    const before = projectInputManifest(
      root,
      options,
      buildInputs,
      opaqueLanguages,
    );
    const result = await build();
    const afterLanguages = selectGraphSources(root, options).languages;
    const afterBuildInputs = providerBuildInputs(afterLanguages, providers);
    const after = projectInputManifest(
      root,
      options,
      afterBuildInputs,
      opaqueLanguages,
    );
    const moved =
      result.sources === undefined
        ? undefined
        : movedConsumedSource(result.sources);
    if (moved === undefined && sameProjectInputManifest(before, after)) {
      return {
        ...result,
        inputManifest: after,
        inputManifestLanguages: [...opaqueLanguages].sort(compareOrdinal),
        buildInputs: afterBuildInputs,
      };
    }

    lastMovement =
      moved === undefined
        ? "the selected source/config/build input manifest changed while the build was preparing"
        : `${moved} changed after this build consumed it`;
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

function compareOrdinal(left: string, right: string): number {
  /* c8 ignore next 2 -- provider language identities are distinct set members. */
  return left < right ? -1 : left > right ? 1 : 0;
}
