/**
 * Best-effort syntax extraction kept separate from the semantic graph product.
 *
 * This package preserves the handwritten multi-language parser as a reusable
 * fallback and experiment surface. Its facts are not a substitute for the
 * compiler-resolved provider required by `ITtscGraphApplication` parity.
 */
export * from "./indexer";
export * from "./compareOrdinal";
export * from "./structures";
export * from "./typings";
