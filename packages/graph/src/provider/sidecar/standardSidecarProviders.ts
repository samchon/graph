import { GraphLanguage, GraphProviderAuthority } from "../../typings";
import { dartPackageConfigInputs } from "../../indexer/dartPackageConfigInputs";
import { providerInputFiles } from "../providerInputFiles";
import { resolveProviderCommand } from "../resolveProviderCommand";
import { sidecarProvider } from "./sidecarProvider";

const swiftGraphProvider = externalSidecar({
  language: "swift",
  authority: "analyzer",
  buildFiles: ["Package.swift", "Package.resolved", "project.pbxproj"],
});

const zigGraphProvider = externalSidecar({
  language: "zig",
  authority: "analyzer",
  buildFiles: ["build.zig", "build.zig.zon"],
});

const phpGraphProvider = externalSidecar({
  language: "php",
  authority: "analyzer",
  buildFiles: [
    "composer.json",
    "composer.lock",
    "phpstan.neon",
    "phpstan.neon.dist",
  ],
});

const luaGraphProvider = externalSidecar({
  language: "lua",
  authority: "analyzer",
  buildFiles: [".luarc.json", ".luarc.jsonc"],
  buildExtensions: [".rockspec"],
});

const dartGraphProvider = externalSidecar({
  language: "dart",
  authority: "analyzer",
  buildFiles: [
    "pubspec.yaml",
    "pubspec.lock",
    "analysis_options.yaml",
  ],
  derivedInputs: dartPackageConfigInputs,
});

/** External analyzer sidecars in deterministic registry order. */
export const standardSidecarProviders = [
  swiftGraphProvider,
  zigGraphProvider,
  phpGraphProvider,
  luaGraphProvider,
  dartGraphProvider,
] as const;

interface IExternalSidecar {
  language: GraphLanguage;
  authority: GraphProviderAuthority;
  buildFiles: readonly string[];
  buildExtensions?: readonly string[];
  derivedInputs?: (root: string) => readonly string[];
}

function externalSidecar(props: IExternalSidecar) {
  const name = `samchon-graph-${props.language}`;
  return sidecarProvider({
    name,
    languages: [props.language],
    authority: props.authority,
    facts: [
      "contains",
      "exports",
      "imports",
      "calls",
      "accesses",
      "instantiates",
      "type_ref",
      "implements",
      "overrides",
      "dispatches",
      "decorates",
      "tests",
      "references",
    ],
    buildInputs: (root) =>
      mergeInputs(
        providerInputFiles(
          root,
          [],
          props.buildFiles,
          props.buildExtensions,
        ),
        props.derivedInputs?.(root) ?? [],
      ),
    resolve: (root, env) =>
      resolveProviderCommand(root, env, {
        command: name,
        override: `SAMCHON_GRAPH_${props.language.toUpperCase()}`,
      }),
    indexArgs: (artifact) => [`--output=${artifact}`, "--project=."],
    inputs: (root, languages) =>
      mergeInputs(
        providerInputFiles(
          root,
          languages,
          props.buildFiles,
          props.buildExtensions,
        ),
        props.derivedInputs?.(root) ?? [],
      ),
  });
}

function mergeInputs(
  left: readonly string[],
  right: readonly string[],
): string[] {
  return [...new Set([...left, ...right])].sort(compareOrdinal);
}

function compareOrdinal(left: string, right: string): number {
  /* c8 ignore next 2 -- merged input identities are distinct set members. */
  return left < right ? -1 : left > right ? 1 : 0;
}
