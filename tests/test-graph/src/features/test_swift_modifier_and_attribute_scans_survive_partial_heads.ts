import { TestValidator } from "@nestia/e2e";

import { SwiftDeclarations } from "@samchon/graph-sitter";

/**
 * The Swift modifier and attribute scanners are handed fragments, not always a
 * whole declaration. A fragment that carries only modifiers (no declaration
 * keyword) still resolves its visibility, and a fragment that is only whitespace
 * carries no attributes rather than reading off its end.
 */
export const test_swift_modifier_and_attribute_scans_survive_partial_heads = () => {
  // No declaration keyword follows the modifiers, so the head-boundary search
  // finds none and the whole fragment is treated as the modifier prefix.
  TestValidator.equals(
    "a keyword-less modifier fragment still resolves its visibility and staticness",
    SwiftDeclarations.swiftGraphModifiersOf("public static"),
    ["public", "static"],
  );

  // A whitespace-only source has no attributes; the leading-whitespace scan runs
  // to the end of the string without reading past it.
  TestValidator.equals(
    "whitespace carries no attributes",
    SwiftDeclarations.swiftDecoratorNames("   "),
    [],
  );
};
