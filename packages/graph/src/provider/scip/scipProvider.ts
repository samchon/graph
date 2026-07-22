import { GraphLanguage, GraphProviderAuthority } from "../../typings";
import { IGraphProvider } from "../IGraphProvider";
import { adaptScipIndex } from "./adaptScipIndex";
import { ScipSession } from "./ScipSession";

/**
 * Build a registry entry for one language-owned SCIP indexer.
 *
 * The ingestion, validation, and lifecycle are the same for every SCIP
 * indexer; what differs is which executable to run, what to pass it, and which
 * files decide its output. Those three are what a caller supplies here, so a
 * language provider is a description rather than a class — and the fourteen of
 * them cannot drift apart in the parts that are supposed to be identical.
 *
 * Every entry built this way inherits {@link adaptScipIndex.EDGE_KINDS} as its
 * provable facts, which is the point: a bare SCIP index cannot prove a call, a
 * construction, or a decorator, and a provider that claimed one
 * would be rejected by its own snapshot contract. A language that can prove
 * more does it through typed enrichment, not by widening this list.
 */
export function scipProvider(props: scipProvider.IProps): IGraphProvider {
  const configuration = props.configuration;
  return {
    name: props.name,
    languages: props.languages,
    authority: props.authority ?? "semantic-index",
    facts: adaptScipIndex.EDGE_KINDS,
    ...(props.buildInputs === undefined
      ? {}
      : { buildInputs: props.buildInputs }),

    // A SCIP indexer answers with a whole-workspace artifact and has no
    // bounded mode, so the same refusal the compiler-owned lane makes applies:
    // honouring a cap would mean indexing everything and then deleting facts,
    // which costs what the cap was meant to save and leaves missing edges
    // indistinguishable from absent ones.
    refuse: (options) => {
      const refused: string[] = [];
      if (options.server !== undefined) refused.push("server");
      if (options.maxFiles !== undefined) refused.push("maxFiles");
      if (options.lspReferenceLimit !== undefined) {
        refused.push("lspReferenceLimit");
      }
      if (refused.length === 0) return undefined;
      // Names the authority as well as the provider, because that is what a
      // reader loses: the sentence has to say which grade of fact the build
      // gave up, not merely which program it did not run.
      const authority = props.authority ?? "semantic-index";
      return (
        `${props.languages.join(", ")}: the ${props.name} ${authority} provider is disabled by ${refused.join(", ")}; ` +
        `it publishes whole-workspace indexes and has no bounded mode, so these languages fall through to the generic language-server lane. ` +
        `Drop ${refused.length === 1 ? "that option" : "those options"} for a strict index.`
      );
    },

    resolve: props.resolve,
    ...(props.prepare === undefined ? {} : { prepare: props.prepare }),

    open: (open) =>
      new ScipSession({
        root: open.root,
        languages: open.languages,
        provider: props.name,
        authority: props.authority ?? "semantic-index",
        command: open.command,
        decode: props.decode(open.root),
        indexArgs: props.indexArgs,
        inputs: () => props.inputs(open.root, open.languages),
        ...(configuration === undefined
          ? {}
          : {
              configuration: () =>
                configuration(open.root, open.languages),
            }),
        languageOf: props.languageOf,
      }),
  };
}

export namespace scipProvider {
  export interface IProps {
    /** Registry name, such as `scip-go`. */
    name: string;

    /** Every language this indexer owns. Never empty. */
    languages: readonly GraphLanguage[];

    /**
     * What its facts are grounded in.
     *
     * `semantic-index` unless the indexer is the language's own compiler
     * driving its real checker, in which case it is entitled to say so.
     */
    authority?: GraphProviderAuthority;

    /** Inputs outside the language's own extensions that invalidate a build. */
    buildInputs?: IGraphProvider["buildInputs"];

    resolve: IGraphProvider["resolve"];
    prepare?: IGraphProvider["prepare"];

    /** The pinned helper that decodes a binary index to JSON. */
    decode: (root: string) => { command: string; args: readonly string[] };

    /** Arguments that direct the indexer's output to one isolated artifact. */
    indexArgs: (artifact: string) => string[];

    /** Every project-relative input whose change invalidates the artifact. */
    inputs: (root: string, languages: readonly GraphLanguage[]) => string[];

    /** Non-file build settings whose change invalidates the artifact. */
    configuration?: (
      root: string,
      languages: readonly GraphLanguage[],
    ) => readonly string[];

    languageOf: (file: string) => GraphLanguage;
  }
}
