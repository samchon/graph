import { GraphLanguage } from "../typings";
import { ILanguageSpec } from "./ILanguageSpec";
import { LANGUAGE_SPECS } from "./LANGUAGE_SPECS";

export function specOf(language: GraphLanguage): ILanguageSpec | undefined {
  return LANGUAGE_SPECS.find((spec) => spec.language === language);
}
