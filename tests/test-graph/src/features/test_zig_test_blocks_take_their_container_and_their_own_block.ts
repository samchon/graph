import { TestValidator } from "@nestia/e2e";

import { ZigDeclarations } from "@samchon/graph-sitter";

export const test_zig_test_blocks_take_their_container_and_their_own_block = () => {
  // Zig allows `test` inside a container, and ZLS reports it there. A test that
  // floated to the file's top level would collide by name with the tests of
  // every other container in the same file, so the container it is written in
  // has to own it -- while its body stays a body, publishing nothing.
  const lines = [
    "pub const Parser = struct {",
    "    pub fn parse() void {}",
    "",
    '    test "parses" {',
    "        const helper = Parser;",
    "        _ = helper;",
    "    }",
    "};",
  ];
  TestValidator.equals(
    "a Zig test written inside a container is owned by that container",
    [...ZigDeclarations.scan(lines)].map(([start, declaration]) => [
      start,
      [...(declaration.ownerNames ?? []), declaration.name].join("."),
      declaration.kind,
      declaration.endIndex,
    ]),
    [
      [0, "Parser", "class", 7],
      [1, "Parser.parse", "method", 1],
      [3, "Parser.parses", "method", 6],
    ],
  );

  // `test "name"` is complete without a terminator: no `;`, no `,`, and its
  // block may open on the next line. Reading only the first line would leave
  // the head unbounded and the block unattached.
  const detached = [
    'test "brace on the next line"',
    "{",
    "    const value = 1;",
    "    _ = value;",
    "}",
    "const after = 2;",
  ];
  TestValidator.equals(
    "a Zig test whose block opens on the next line still owns that block",
    [
      ZigDeclarations.zigDeclarationHeader(detached, 0),
      ZigDeclarations.zigDeclarationEndIndex(detached, 0),
      [...ZigDeclarations.scan(detached)].map(([start, declaration]) => [
        start,
        declaration.name,
        declaration.kind,
        declaration.endIndex,
      ]),
    ],
    [
      'test "brace on the next line"',
      4,
      [
        [0, "brace on the next line", "method", 4],
        [5, "after", "variable", 5],
      ],
    ],
  );
};
