import { TestValidator } from "@nestia/e2e";

import { ZigDeclarations } from "@samchon/graph-sitter";

export const test_zig_container_members_and_truncated_heads_keep_their_facts = () => {
  // Zig has no `static` and no member visibility: a container's fields are
  // reachable wherever the container is, and a `const` written in a container
  // belongs to the type rather than to an instance of it. Those are the facts
  // the graph's shared modifier vocabulary has to carry across from Zig, and
  // they are the facts `pub` alone cannot answer.
  TestValidator.equals(
    "a container member is public, and a container `const` is also static",
    [
      ZigDeclarations.zigGraphModifiersOf("value: usize = 0,", true),
      ZigDeclarations.zigGraphModifiersOf("const Mode = enum { fast };", true),
      ZigDeclarations.zigGraphModifiersOf("var cursor: usize = 0;", true),
    ],
    [
      ["public"],
      ["public", "const", "static"],
      ["public", "static"],
    ],
  );
  TestValidator.equals(
    "outside a container the same declarations answer to `pub` and nothing else",
    [
      ZigDeclarations.zigGraphModifiersOf("const Mode = enum { fast };"),
      ZigDeclarations.zigGraphModifiersOf("pub const Mode = enum { fast };"),
      ZigDeclarations.zigGraphModifiersOf("threadlocal var counter: usize = 0;"),
    ],
    [
      ["private", "const"],
      ["public", "const"],
      ["private"],
    ],
  );

  // A repository holds files that are mid-edit, generated, or simply wrong, and
  // the static lane has no compiler to refuse them. A head that never closes
  // must bound itself to where it started: running to the end of the file would
  // hand every later declaration to a container that was never written.
  const truncated = ["pub fn parse(", "    value: []const u8,"];
  TestValidator.equals(
    "a Zig head left unterminated at end of file bounds itself, not the file",
    [
      ZigDeclarations.zigDeclarationHeader(truncated, 0),
      ZigDeclarations.zigDeclarationEndIndex(truncated, 0),
      [...ZigDeclarations.scan(truncated).values()],
    ],
    [
      "pub fn parse( value: []const u8,",
      0,
      [
        {
          kind: "function",
          name: "parse",
          endIndex: 0,
          exported: true,
          modifiers: ["public"],
        },
      ],
    ],
  );
};
