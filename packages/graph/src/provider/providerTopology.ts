import { IBuildGraphOptions } from "../indexer/IBuildGraphOptions";
import { GraphLanguage } from "../typings";
import { GRAPH_PROVIDERS } from "./GRAPH_PROVIDERS";
import { IGraphProvider } from "./IGraphProvider";
import { selectGraphProviders } from "./selectGraphProviders";

export namespace providerTopology {
  export interface IRow {
    provider: string;
    languages: GraphLanguage[];
    command: string;
    args: string[];
    windowsVerbatimArguments: boolean;
    windowsDoubleEscapeArguments: boolean;
    configuration: string[];
  }

  /** Non-mutating provider eligibility/command/configuration snapshot. */
  export function available(
    root: string,
    languages: readonly GraphLanguage[],
    options: IBuildGraphOptions,
    env: NodeJS.ProcessEnv = process.env,
    registry: readonly IGraphProvider[] = GRAPH_PROVIDERS,
  ): IRow[] {
    if (options.mode === "static") return [];
    return selectGraphProviders(
      root,
      languages,
      options,
      env,
      registry,
      false,
    ).candidates.map((candidate) => ({
      provider: candidate.provider.name,
      languages: [...candidate.languages].sort(compareOrdinal),
      command: candidate.command.command,
      args: [...candidate.command.args],
      windowsVerbatimArguments:
        candidate.command.windowsVerbatimArguments === true,
      windowsDoubleEscapeArguments:
        candidate.command.windowsDoubleEscapeArguments === true,
      configuration:
        candidate.provider.configuration === undefined
          ? []
          : [...candidate.provider.configuration(root, env)].sort(
              compareOrdinal,
            ),
    }));
  }

  export function serialize(available: readonly IRow[]): string {
    return JSON.stringify(available);
  }
}

function compareOrdinal(left: string, right: string): number {
  /* c8 ignore next 2 -- topology values are distinct set members. */
  return left < right ? -1 : left > right ? 1 : 0;
}
