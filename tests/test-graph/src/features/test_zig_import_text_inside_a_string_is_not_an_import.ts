import { TestValidator } from "@nestia/e2e";
import { ZigDeclarations } from "@samchon/graph-sitter";

/**
 * A `const x = @import("y");` written inside a Zig multiline string or a line
 * comment is text, not an import.
 *
 * `zigImportsOf` matches the `@import` shape against the raw source with a
 * `^\s*(?:pub\s+)?const` anchor, so `const` must be the first token on its line.
 * A `\\` multiline-string line begins with `\` and a `//` comment line begins
 * with `/`, so neither can ever open the match — the anchor alone rejects the
 * phantom module edges these fakes would otherwise surface.
 */
export const test_zig_import_text_inside_a_string_is_not_an_import = () => {
  const real = 'const std = @import("std");\n';
  const insideMultilineString =
    "const doc =\n" +
    '    \\\\const fake = @import("not_a_module");\n' +
    "    ;\n";
  const insideLineComment = '// const also = @import("commented");\n';

  const imports = ZigDeclarations.zigImportsOf(
    real + insideMultilineString + insideLineComment,
  );

  TestValidator.equals(
    "only the real @import outside any string or comment is an import",
    imports.map((entry) => entry.name),
    ["std"],
  );
  TestValidator.equals(
    "the real import keeps its binding",
    imports.map((entry) => entry.binding),
    ["std"],
  );
};
