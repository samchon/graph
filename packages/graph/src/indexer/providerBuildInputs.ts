import { IGraphProvider } from "../provider/IGraphProvider";
import { GraphLanguage } from "../typings";
import { languageBuildInputs } from "./languageBuildInputs";
import { confinedProjectInput } from "./confinedProjectInput";

/** Every provider-declared non-source input relevant to these languages. */
export function providerBuildInputs(
  languages: readonly GraphLanguage[],
  providers: readonly IGraphProvider[],
  root: string = process.cwd(),
): string[] {
  const requested = new Set(languages);
  return [
    ...new Set(
      [
        ...languageBuildInputs(root, languages),
        ...providers.flatMap((provider) =>
          provider.languages.some((language) => requested.has(language))
            ? buildInputsOf(provider, root)
            : [],
        ),
      ].map((input) => confinedProjectInput.relative(root, input)),
    ),
  ].sort(compareOrdinal);
}

function buildInputsOf(provider: IGraphProvider, root: string): string[] {
  const declared = provider.buildInputs;
  if (declared === undefined) return [];
  return [...(typeof declared === "function" ? declared(root) : declared)];
}

function compareOrdinal(left: string, right: string): number {
  /* c8 ignore next 2 -- sets contain distinct build-input identities. */
  return left < right ? -1 : left > right ? 1 : 0;
}
