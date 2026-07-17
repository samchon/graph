import { TestValidator } from "@nestia/e2e";

import { ZigDeclarations } from "@samchon/graph-sitter";

export const test_zig_enum_bodies_expose_every_case_as_a_field = () => {
  // A Zig enum's cases are its whole public surface, and an enum body carries
  // them one per line as readily as inline. A case has no `const`, no `fn`, and
  // no `:` -- nothing that the container rules recognise -- so the enum's own
  // body is the only thing that makes `fast` a member rather than a stray
  // identifier the scan should ignore.
  const lines = [
    "const Mode = enum(u8) {",
    "    fast,",
    "    slow = 3,",
    "};",
  ];
  TestValidator.equals(
    "each case of a multi-line Zig enum is a field of that enum",
    [...ZigDeclarations.scan(lines)].map(([start, declaration]) => [
      start,
      [...(declaration.ownerNames ?? []), declaration.name].join("."),
      declaration.kind,
      declaration.endIndex,
      declaration.modifiers,
    ]),
    [
      [0, "Mode", "enum", 3, ["private", "const"]],
      [1, "Mode.fast", "field", 1, ["public", "const"]],
      [2, "Mode.slow", "field", 2, ["public", "const"]],
    ],
  );

  // The factory rule that gives an anonymous `return struct` its caller's
  // identity is about containers, not about `struct`: an enum returned the same
  // way is the same stable type under the same name.
  const factory = [
    "pub fn Flag(comptime T: type) type {",
    "    _ = T;",
    "    return enum {",
    "        off,",
    "        on,",
    "    };",
    "}",
  ];
  TestValidator.equals(
    "an anonymous `return enum` is an enum owned by the factory that returns it",
    [...ZigDeclarations.scan(factory)].map(([start, declaration]) => [
      start,
      [...(declaration.ownerNames ?? []), declaration.name].join("."),
      declaration.kind,
    ]),
    [
      [0, "Flag", "function"],
      [3, "Flag.off", "field"],
      [4, "Flag.on", "field"],
    ],
  );

  // `zigEnumFieldNames` reads one declaration's body as a case list, so every
  // comma it splits on has to be a case separator. Zig writes comptime values
  // with index expressions and struct literals, both of which carry commas of
  // their own.
  TestValidator.equals(
    "an index expression or struct literal in a case value does not split the list",
    ZigDeclarations.zigEnumFieldNames(
      "const Mode = enum(u8) { first = codes[1], second = Sizes{ .x = 2, .y = 3 }.x, third };",
    ),
    ["first", "second", "third"],
  );
  TestValidator.equals(
    "a declaration with no body, or an unterminated one, exposes no cases",
    [
      ZigDeclarations.zigEnumFieldNames("const Empty = void;"),
      ZigDeclarations.zigEnumFieldNames("const Failure = error{"),
    ],
    [[], []],
  );
};
