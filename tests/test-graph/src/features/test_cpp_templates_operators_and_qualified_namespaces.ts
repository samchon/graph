import { TestValidator } from "@nestia/e2e";

import { CppDeclarations } from "@samchon/graph-sitter";

/**
 * A C++ head puts the declared name last, after a return type that may itself
 * be a template, a qualifier, or a pointer. The parser must find the name
 * without mistaking the return type, an operator token, or a parenthesis
 * inside a string for one.
 */
export const test_cpp_templates_operators_and_qualified_namespaces = () => {
  const parse = CppDeclarations.parseCppDeclaration;

  // A namespace may be written with its whole path at once, and an `inline`
  // namespace is still an ordinary named scope.
  TestValidator.equals(
    "a qualified namespace names its own final segment under its parents",
    [
      parse("namespace storage::detail {"),
      parse("inline namespace v1 {"),
      parse("namespace {"),
    ],
    [
      { kind: "namespace", name: "detail", ownerNames: ["storage"] },
      { kind: "namespace", name: "v1" },
      { kind: "namespace", name: "(anonymous namespace)", exported: false },
    ],
  );

  // `template <...>` is a prefix, not the declaration: reading it as the head
  // loses every generic type and function in the file.
  TestValidator.equals(
    "a template prefix does not hide the class or function it introduces",
    [
      parse("template <typename T> class Box {"),
      parse("template <typename T, typename U> struct Pair {"),
      parse("template <typename T> T identity(T value) {"),
    ],
    [
      { kind: "class", name: "Box" },
      { kind: "class", name: "Pair" },
      { kind: "function", name: "identity", exported: true },
    ],
  );
  // A specialization names the *arguments* it specializes on, not a new type.
  // `Box<int>` is not an identifier, so the parser must decline rather than
  // invent a declaration called `Box<int>`, `int`, or `Box`.
  TestValidator.equals(
    "an explicit template specialization is not indexed under a fabricated name",
    [parse("template <> class Box<int> {"), parse("template <> struct Pair<int, int> {")],
    [undefined, undefined],
  );

  // `enum` and `enum class` are enums; `struct` and `union` are class-shaped.
  TestValidator.equals(
    "enum, enum class, struct, and union keep their declaration kinds",
    [
      parse("enum Color { Red };"),
      parse("enum class Level : uint8_t { Low };"),
      parse("struct Status {};"),
      parse("union Payload { int i; };"),
    ],
    [
      { kind: "enum", name: "Color" },
      { kind: "enum", name: "Level" },
      { kind: "class", name: "Status" },
      { kind: "class", name: "Payload" },
    ],
  );

  // A free `static` function has internal linkage: it is file-local, so it is
  // not part of the translation unit's exported surface.
  TestValidator.equals(
    "a static free function is file-local, a plain one is exported",
    [
      parse("static int helper(int x) { return x; }"),
      parse("int visible(int x) { return x; }"),
    ],
    [
      { kind: "function", name: "helper", exported: false, modifiers: ["static"] },
      { kind: "function", name: "visible", exported: true },
    ],
  );

  // `operator` declarations spell their name with punctuation the parser has
  // no name rule for, and `new`/`delete` are keywords. Neither may be indexed
  // under a fabricated name such as `new`, `delete`, or an empty token.
  TestValidator.equals(
    "operator overloads are never indexed under a keyword or punctuation name",
    [
      parse("bool operator==(const Event& other) const;", "Event", "class"),
      parse("void* operator new(size_t size);", "Arena", "class"),
      parse("void operator delete(void* p) noexcept;", "Arena", "class"),
    ],
    [undefined, undefined, undefined],
  );

  // A `(` inside a string literal is text, not a parameter list. Reading it as
  // one leaves the parser hunting for a `)` that never arrives.
  TestValidator.equals(
    "a parenthesis inside a string literal is not a parameter list",
    [
      parse('const char* kOpenParen = "(";'),
      parse("int total = compute(3);"),
      parse("DISALLOW_COPY_AND_ASSIGN(Engine);", "Engine", "class"),
    ],
    [undefined, undefined, undefined],
  );

  // A declaration inside a function body belongs to that body, not to the file.
  TestValidator.equals(
    "a callable inside a function body is not a sibling declaration",
    [
      parse("void helper(int x) { }", "run", "function"),
      parse("void helper(int x) { }", "Engine.run", "method"),
    ],
    [undefined, undefined],
  );

  // A head with nothing after its parameter list is still a declaration: the
  // brace may simply live on the next line.
  TestValidator.equals(
    "a head whose body has not started yet is still a declaration",
    parse("int compute()"),
    { kind: "function", name: "compute", exported: true },
  );

  // The joiner must not treat a preprocessor line, a comment, or an access
  // label as a head that reaches forward into the next declaration.
  TestValidator.equals(
    "preprocessor, comment, and access-label lines are never joined into a head",
    [
      CppDeclarations.cppDeclarationHeader(["#include <vector>", "class Engine {"], 0),
      CppDeclarations.cppDeclarationHeader(["", "class Engine {"], 0),
      CppDeclarations.cppDeclarationHeader(["// comment", "class Engine {"], 0),
      CppDeclarations.cppDeclarationHeader(["/* block */", "class Engine {"], 0),
      CppDeclarations.cppDeclarationHeader([" * doc", "class Engine {"], 0),
      CppDeclarations.cppDeclarationHeader([" public:", "Status Get();"], 0),
    ],
    ["#include <vector>", "", "// comment", "/* block */", " * doc", " public:"],
  );
  // A `//` comment and a string are masked while the head is joined, so a
  // brace or parenthesis inside either cannot end it early.
  TestValidator.equals(
    "a multiline head joins to its own terminator across masked text",
    CppDeclarations.cppDeclarationHeader(
      ['Status Put(  // takes (key, value)', '    int key,', '    const char* tag = ")",', "    int value) {"],
      0,
    ),
    'Status Put(  // takes (key, value) int key, const char* tag = ")", int value) {',
  );
};
