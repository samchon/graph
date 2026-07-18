import { TestValidator } from "@nestia/e2e";
import { ZigDeclarations } from "@samchon/graph-sitter";

/**
 * A `const x = @import("y");` written inside a Zig multiline string is text,
 * not an import.
 *
 * `zigImportsOf` matches the `@import` shape against the raw source so a match's
 * columns stay true, then confirms the `@import` survives in the lexically
 * masked source before trusting it — Zig's `\\` multiline strings and `//` line
 * comments are blanked in that masked copy. Without the confirm, a fake import
 * embedded in string data would surface a phantom module edge.
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
