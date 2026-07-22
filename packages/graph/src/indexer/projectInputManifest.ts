import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { GraphLanguage } from "../typings";
import { IGraphProvider } from "../provider/IGraphProvider";
import { IBuildGraphOptions } from "./IBuildGraphOptions";
import { selectGraphSources } from "./selectGraphSources";

/** Every provider-declared non-source input relevant to these languages. */
export function providerBuildInputs(
  languages: readonly GraphLanguage[],
  providers: readonly IGraphProvider[],
): string[] {
  const requested = new Set(languages);
  return [
    ...new Set(
      providers.flatMap((provider) =>
        provider.languages.some((language) => requested.has(language))
          ? [...(provider.buildInputs ?? [])]
          : [],
      ),
    ),
  ].sort(compareOrdinal);
}

/**
 * Content tokens for the selected source set and declared build inputs.
 *
 * Missing inputs are entries too. Creating `tsconfig.json` can change a
 * program as decisively as editing it, so absence must compare differently
 * from an empty file and from a path the manifest never watched.
 */
export function projectInputManifest(
  root: string,
  options: IBuildGraphOptions,
  buildInputs: readonly string[],
): Map<string, string> {
  const files = new Set(
    selectGraphSources(root, options).files.map((file) => path.resolve(file)),
  );
  for (const input of buildInputs) files.add(path.resolve(root, input));

  const manifest = new Map<string, string>();
  for (const file of [...files].sort(compareOrdinal)) {
    try {
      manifest.set(
        file,
        createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
      );
    } catch {
      manifest.set(file, "missing");
    }
  }
  return manifest;
}

export function sameProjectInputManifest(
  left: ReadonlyMap<string, string>,
  right: ReadonlyMap<string, string>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [file, digest] of left) {
    if (right.get(file) !== digest) return false;
  }
  return true;
}

function compareOrdinal(left: string, right: string): number {
  /* c8 ignore next 2 -- sets contain distinct normalized path identities. */
  return left < right ? -1 : left > right ? 1 : 0;
}
