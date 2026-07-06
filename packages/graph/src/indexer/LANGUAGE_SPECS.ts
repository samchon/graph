import { ILanguageSpec } from "./ILanguageSpec";

export const LANGUAGE_SPECS: ILanguageSpec[] = [
  {
    language: "typescript",
    extensions: [".ts", ".tsx", ".mts", ".cts"],
    lsp: { command: "typescript-language-server", args: ["--stdio"] },
    lineComment: "//",
  },
  {
    language: "javascript",
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
    lsp: { command: "typescript-language-server", args: ["--stdio"] },
    lineComment: "//",
  },
  {
    language: "go",
    extensions: [".go"],
    lsp: { command: "gopls", args: [] },
    lineComment: "//",
  },
  {
    language: "rust",
    extensions: [".rs"],
    lsp: { command: "rust-analyzer", args: [] },
    lineComment: "//",
  },
  {
    language: "cpp",
    extensions: [".cc", ".cpp", ".cxx", ".c++", ".hh", ".hpp", ".hxx", ".h++"],
    lsp: { command: "clangd", args: [] },
    lineComment: "//",
  },
  {
    language: "c",
    extensions: [".c", ".h"],
    lsp: { command: "clangd", args: [] },
    lineComment: "//",
  },
  {
    language: "java",
    extensions: [".java"],
    lsp: { command: "jdtls", args: [] },
    lineComment: "//",
  },
  {
    language: "csharp",
    extensions: [".cs"],
    lsp: { command: "csharp-ls", args: [] },
    lineComment: "//",
  },
  {
    language: "kotlin",
    extensions: [".kt", ".kts"],
    lsp: { command: "kotlin-language-server", args: [] },
    lineComment: "//",
  },
  {
    language: "swift",
    extensions: [".swift"],
    lsp: { command: "sourcekit-lsp", args: [] },
    lineComment: "//",
  },
  {
    language: "scala",
    extensions: [".scala", ".sc"],
    lsp: { command: "metals", args: [] },
    lineComment: "//",
  },
  {
    language: "zig",
    extensions: [".zig"],
    lsp: { command: "zls", args: [] },
    lineComment: "//",
  },
];
