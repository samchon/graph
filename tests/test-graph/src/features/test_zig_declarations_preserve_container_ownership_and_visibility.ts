import { TestValidator } from "@nestia/e2e";

import { ZigDeclarations } from "@samchon/graph-sitter";

export const test_zig_declarations_preserve_container_ownership_and_visibility = () => {
  const parse = ZigDeclarations.parseZigDeclaration;

  TestValidator.equals(
    "Zig value-declared containers keep their graph kinds and publication",
    [
      parse("pub const Parser = packed struct {"),
      parse("const Mode = enum(u8) {"),
      parse("pub const Failure = error{Invalid};"),
      parse("const Payload = union(enum) {"),
    ],
    [
      {
        kind: "class",
        name: "Parser",
        exported: true,
        modifiers: ["public", "const"],
      },
      { kind: "enum", name: "Mode", modifiers: ["private", "const"] },
      {
        kind: "enum",
        name: "Failure",
        exported: true,
        modifiers: ["public", "const"],
      },
      {
        kind: "class",
        name: "Payload",
        modifiers: ["private", "const"],
      },
    ],
  );
  TestValidator.equals(
    "top-level and container callables have distinct kinds and visibility",
    [
      parse("pub fn parse(value: []const u8) void {"),
      parse("export fn entry() callconv(.c) void {"),
      parse("pub fn run(self: *Parser) void {", "Parser", "class"),
      parse("fn helper() void {", "Parser", "class"),
    ],
    [
      {
        kind: "function",
        name: "parse",
        exported: true,
        modifiers: ["public"],
      },
      {
        kind: "function",
        name: "entry",
        exported: true,
        modifiers: ["public", "export"],
      },
      { kind: "method", name: "run", modifiers: ["public"] },
      { kind: "method", name: "helper", modifiers: ["private"] },
    ],
  );
  TestValidator.equals(
    "container fields and namespace constants survive while callable locals do not",
    [
      parse("value: usize = 0,", "Parser", "class"),
      parse("const Self = @This();", "Parser", "class"),
      parse("const temporary = 1;", "run", "method"),
    ],
    [
      { kind: "field", name: "value", modifiers: ["public"] },
      {
        kind: "variable",
        name: "Self",
        modifiers: ["private", "const"],
      },
      undefined,
    ],
  );

  const lines = [
    "pub const Parser = struct {",
    "    value: usize = 0,",
    "    pub const Mode = enum { fast, slow };",
    "    pub fn parse(",
    "        self: *Parser,",
    "    ) void {",
    "        const Local = struct {",
    "            pub fn hidden() void {}",
    "        };",
    '        const fake = "pub fn stringGhost() void { }";',
    "        const prose =",
    "            \\\\pub fn multilineGhost() void { }",
    "        ;",
    "        _ = self;",
    "    }",
    "    fn helper() void {}",
    "};",
    "",
    "pub fn Factory() type {",
    "    return struct {",
    "        pub fn create() void { helper(); }",
    "        const State = union(enum) { ready, failed };",
    "    };",
    "}",
    "",
    'test "parse: ignores { braces }" {',
    "    _ = Parser{};",
    "}",
  ];
  const scanned = [...ZigDeclarations.scan(lines).values()];
  const names = scanned.map((declaration) => [
    [...(declaration.ownerNames ?? []), declaration.name].join("."),
    declaration.kind,
  ]);
  TestValidator.equals(
    "named and returned containers retain direct declaration ownership",
    names,
    [
      ["Parser", "class"],
      ["Parser.value", "field"],
      ["Parser.Mode", "enum"],
      ["Parser.parse", "method"],
      ["Parser.helper", "method"],
      ["Factory", "function"],
      ["Factory.create", "method"],
      ["Factory.State", "class"],
      ["parse: ignores { braces }", "method"],
    ],
  );
  TestValidator.predicate(
    "callable-local containers and string/comment examples cannot become declarations",
    ["Local", "hidden", "stringGhost", "multilineGhost"].every(
      (name) => !scanned.some((declaration) => declaration.name === name),
    ),
  );
  TestValidator.equals(
    "multiline callable headers and lexical braces keep the full body boundary",
    [
      ZigDeclarations.zigDeclarationHeader(lines, 3),
      ZigDeclarations.zigDeclarationEndIndex(lines, 3),
      ZigDeclarations.zigDeclarationEndIndex(lines, 18),
    ],
    [
      "pub fn parse( self: *Parser, ) void {",
      14,
      23,
    ],
  );

  const errorReturnLines = [
    "pub fn validate(value: usize)",
    "    error{ Missing, Invalid }!void",
    "{",
    "    _ = value;",
    "}",
  ];
  TestValidator.equals(
    "error-set return types cannot truncate a callable header or body",
    [
      ZigDeclarations.zigDeclarationHeader(errorReturnLines, 0),
      ZigDeclarations.zigDeclarationEndIndex(errorReturnLines, 0),
      [...ZigDeclarations.scan(errorReturnLines).values()],
    ],
    [
      "pub fn validate(value: usize) error{ Missing, Invalid }!void {",
      4,
      [
        {
          kind: "function",
          name: "validate",
          endIndex: 4,
          exported: true,
          modifiers: ["public"],
        },
      ],
    ],
  );

  const errorFieldLines = [
    "const Holder = struct {",
    "    callback: fn () error{",
    "        Missing,",
    "    }!void,",
    "    next: usize,",
    "};",
  ];
  TestValidator.equals(
    "error-set field types keep the next container member at its real depth",
    [...ZigDeclarations.scan(errorFieldLines)].map(([start, declaration]) => [
      start,
      declaration.name,
      declaration.endIndex,
    ]),
    [
      [0, "Holder", 5],
      [1, "callback", 3],
      [4, "next", 4],
    ],
  );
  TestValidator.equals(
    "identifier-named tests follow ZLS identity while unnamed tests stay anonymous",
    [
      ...ZigDeclarations.scan([
        "test Parser {",
        "}",
        "test {",
        "}",
      ]).values(),
    ],
    [
      {
        kind: "method",
        name: "Parser",
        endIndex: 1,
        modifiers: ["private"],
      },
    ],
  );
  TestValidator.equals(
    "anonymous container return types cannot become the callable body",
    [
      ...ZigDeclarations.scan([
        "fn measure() struct { bytes: usize, codepoints: usize } {",
        "    return .{ .bytes = 0, .codepoints = 0 };",
        "}",
        "const after = 1;",
      ]).values(),
    ].map((declaration) => [
      declaration.name,
      declaration.kind,
      declaration.endIndex,
    ]),
    [
      ["measure", "function", 2],
      ["after", "variable", 3],
    ],
  );

  TestValidator.equals(
    "Zig imports preserve bindings without accepting comment or string examples",
    ZigDeclarations.zigImportsOf(
      [
        'const std = @import("std");',
        'pub const child = @import("child/module.zig");',
        '// const fake = @import("fake.zig");',
        'const text = "const ghost = @import(\\"ghost.zig\\");";',
      ].join("\n"),
    ),
    [
      { binding: "std", name: "std" },
      { binding: "child", name: "child/module.zig" },
    ],
  );
  TestValidator.equals(
    "only top-level pub/export declarations form the Zig module surface",
    [...ZigDeclarations.zigPublishedNames(lines.join("\n"))],
    ["Parser", "Factory"],
  );
  TestValidator.equals(
    "one-line enum and error sets expose every declared case",
    ZigDeclarations.zigEnumFieldNames(
      "const Failure = error{ Missing, Invalid = code(1, 2), Nested };",
    ),
    ["Missing", "Invalid", "Nested"],
  );
};
