import { GraphLanguage } from "../typings";

export function languageIdOf(language: GraphLanguage): string {
  if (language === "csharp") return "csharp";
  if (language === "cpp") return "cpp";
  return language;
}
