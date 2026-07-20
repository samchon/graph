import { IBuildGraphOptions } from "../indexer/IBuildGraphOptions";
import { GraphLanguage } from "../typings";
import { GRAPH_PROVIDERS } from "./GRAPH_PROVIDERS";
import { IGraphProvider } from "./IGraphProvider";

/** One provider that can serve this build, and the languages it will own. */
export interface IGraphProviderCandidate {
  provider: IGraphProvider;

  /**
   * The subset of the provider's languages this build actually selected.
   *
   * A Clang provider registered for C and C++ owns only C in a project with no
   * C++ sources, and its session must say so: publishing an empty C++ slice
   * would delete nothing but would claim the language was indexed.
   */
  languages: GraphLanguage[];

  command: IGraphProvider.ICommand;
}

export interface IGraphProviderSelection {
  /** Providers that can serve this build, in registry order. */
  candidates: IGraphProviderCandidate[];

  /**
   * One sentence per language that a registered provider could have served but
   * will not, naming the provider and the reason.
   *
   * Every declined candidate produces exactly one of these. The condition this
   * replaces was folded into the indexer's language loop with no `else`, so a
   * caller whose options disabled the compiler-owned lane got a generic-LSP
   * success that read exactly like the strict result it had silently replaced.
   * A fallback nobody can see is the failure; the sentence is the fix.
   */
  warnings: string[];
}

/**
 * Choose which registered providers serve which languages for one build.
 *
 * Discovery is data-driven: this function reads {@link GRAPH_PROVIDERS} and
 * asks each entry about itself, in order. It never names a language, and
 * adding a provider never edits it.
 */
export function selectGraphProviders(
  root: string,
  languages: readonly GraphLanguage[],
  options: IBuildGraphOptions,
  env: NodeJS.ProcessEnv = process.env,
  registry: readonly IGraphProvider[] = GRAPH_PROVIDERS,
): IGraphProviderSelection {
  assertOneOwnerPerLanguage(registry);
  const requested = new Set(languages);
  const candidates: IGraphProviderCandidate[] = [];
  const warnings: string[] = [];

  for (const provider of registry) {
    const owned = provider.languages.filter((language) =>
      requested.has(language),
    );
    if (owned.length === 0) continue;

    const refusal = provider.refuse(options);
    if (refusal !== undefined) {
      warnings.push(refusal);
      continue;
    }

    const command = provider.resolve(root, env);
    if (command === undefined) {
      warnings.push(
        `${owned.join(", ")}: the ${provider.name} ${provider.authority} provider was not found for this project; falling back to the generic language-server lane.`,
      );
      continue;
    }

    if (provider.prepare !== undefined) {
      try {
        provider.prepare(root, options);
      } catch (error) {
        warnings.push(
          `${owned.join(", ")}: the ${provider.name} ${provider.authority} provider could not prepare this project, so it cannot answer for it: ${(error as Error).message}`,
        );
        continue;
      }
    }

    candidates.push({ provider, languages: owned, command });
  }

  return { candidates, warnings };
}

/**
 * No language may have two registered owners.
 *
 * Checked over the whole registry rather than over the providers that happened
 * to resolve, because the defect is static: a registry where two entries claim
 * Go is malformed whether or not both indexers are installed today. Deferring
 * the check to the resolved set would let it pass on every machine missing one
 * of them and fail on the one machine that has both.
 */
function assertOneOwnerPerLanguage(
  registry: readonly IGraphProvider[],
): void {
  const owners = new Map<GraphLanguage, IGraphProvider>();
  for (const provider of registry) {
    if (provider.languages.length === 0) {
      throw new Error(
        `@samchon/graph: provider "${provider.name}" owns no language, so nothing can select it`,
      );
    }
    for (const language of provider.languages) {
      const existing = owners.get(language);
      if (existing !== undefined) {
        throw new Error(
          `@samchon/graph: providers "${existing.name}" and "${provider.name}" both claim ${language}; one language cannot have two owners`,
        );
      }
      owners.set(language, provider);
    }
  }
}
