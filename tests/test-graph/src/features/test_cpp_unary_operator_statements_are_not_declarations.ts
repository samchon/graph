import { TestValidator } from "@nestia/e2e";

import { CppDeclarations } from "@samchon/graph-sitter";

/**
 * A C++ statement head that begins with a unary operator applied to a call --
 * `*it()`, `&handler()`, `!ready()` -- is an expression, not a declaration. The
 * text before the callee is then pure operator punctuation carrying no
 * return-type word, so it names no function and the extractor must decline
 * rather than manufacture one from the callee's name.
 */
export const test_cpp_unary_operator_statements_are_not_declarations = () => {
  const parse = CppDeclarations.parseCppDeclaration;

  TestValidator.equals(
    "a leading unary operator marks an expression statement, not a declaration",
    [parse("*it();"), parse("&handler();"), parse("!ready();")],
    [undefined, undefined, undefined],
  );

  // The negative twin: a pointer or reference is part of a real return type
  // only when a type word precedes the callee. `int* clone()` declares a
  // function; a bare `*clone()` only dereferences the call's result.
  TestValidator.equals(
    "a pointer return type still declares a function, unlike a bare dereference",
    [parse("int* clone();"), parse("*clone();")],
    [{ kind: "function", name: "clone", exported: true }, undefined],
  );
};
