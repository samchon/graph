import { TestValidator } from "@nestia/e2e";
import { pathToFileURL } from "node:url";
import path from "node:path";

import { GraphPaths } from "../internal/GraphPaths";

export const test_language_display_name_of_names_or_falls_back_to_code = async () => {
  const { languageDisplayNameOf } = (await import(
    pathToFileURL(
      path.join(GraphPaths.graphPackageRoot, "lib", "mcp", "languageDisplayNameOf.js"),
    ).href
  )) as {
    languageDisplayNameOf: (languages: readonly string[]) => string;
  };

  TestValidator.equals("a single known language is named", languageDisplayNameOf(["kotlin"]), "Kotlin");
  TestValidator.equals("cpp gets its symbolic display name", languageDisplayNameOf(["cpp"]), "C++");
  TestValidator.equals("csharp gets its symbolic display name", languageDisplayNameOf(["csharp"]), "C#");
  TestValidator.equals("duplicates of one language still name it", languageDisplayNameOf(["go", "go"]), "Go");
  TestValidator.equals("no languages falls back to code", languageDisplayNameOf([]), "code");
  TestValidator.equals("only unknown falls back to code", languageDisplayNameOf(["unknown"]), "code");
  TestValidator.equals(
    "several distinct languages fall back to code",
    languageDisplayNameOf(["typescript", "go"]),
    "code",
  );
};
