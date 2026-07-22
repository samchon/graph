import { IGraphProvider } from "../provider/IGraphProvider";
import { GraphLanguage } from "../typings";

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

function compareOrdinal(left: string, right: string): number {
  /* c8 ignore next 2 -- sets contain distinct build-input identities. */
  return left < right ? -1 : left > right ? 1 : 0;
}
