import { GraphLanguage } from "../typings";

export interface ILanguageSpec {
  language: GraphLanguage;
  extensions: string[];
  lsp?: {
    command: string;
    args: string[];
  };
  lineComment: string;
}
