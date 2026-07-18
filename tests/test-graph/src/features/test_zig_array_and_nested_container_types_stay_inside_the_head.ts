import { TestValidator } from "@nestia/e2e";

import { ZigDeclarations } from "@samchon/graph-sitter";

export const test_zig_array_and_nested_container_types_stay_inside_the_head = () => {
  // Zig writes array and slice types with the same brackets it writes indexing
  // with, and both appear in the head the scan has to bound. A bracket the
  // parser does not track is one the brace walk can meet at the wrong depth.
  const buffer = [
    "pub const Buffer = struct {",
    "    bytes: [4]u8,",
    "    slice: []const u8,",
    "",
    "    pub fn at(self: *const Buffer, index: usize) u8 {",
    "        return self.bytes[index];",
    "    }",
    "};",
  ];
  TestValidator.equals(
    "array and slice fields keep their own bounds and the method after them",
    [...ZigDeclarations.scan(buffer)].map(([start, declaration]) => [
      start,
      [...(declaration.ownerNames ?? []), declaration.name].join("."),
      declaration.kind,
      declaration.endIndex,
    ]),
    [
      [0, "Buffer", "class", 7],
      [1, "Buffer.bytes", "field", 1],
      [2, "Buffer.slice", "field", 2],
      [4, "Buffer.at", "method", 6],
    ],
  );

  // An anonymous container in a return type is part of the signature, not the
  // body -- including when it nests. The first `{` after `struct` opens a type,
  // and only the `{` that follows the type's own `}` opens the function.
  const nested = [
    "fn describe() struct { inner: struct { depth: u8 }, count: usize } {",
    "    return .{ .inner = .{ .depth = 1 }, .count = 0 };",
    "}",
    "const after = 1;",
  ];
  TestValidator.equals(
    "a nested anonymous return container cannot be mistaken for the body",
    [
      ZigDeclarations.zigDeclarationHeader(nested, 0),
      ZigDeclarations.zigDeclarationEndIndex(nested, 0),
      [...ZigDeclarations.scan(nested)].map(([start, declaration]) => [
        start,
        declaration.name,
        declaration.kind,
        declaration.endIndex,
      ]),
    ],
    [
      "fn describe() struct { inner: struct { depth: u8 }, count: usize } {",
      2,
      [
        [0, "describe", "function", 2],
        [3, "after", "variable", 3],
      ],
    ],
  );
};
