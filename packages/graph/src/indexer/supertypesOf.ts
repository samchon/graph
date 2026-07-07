export function supertypesOf(
  rawDeclaration: string,
): Array<{ name: string; relation: "extends" | "implements" }> {
  const out: Array<{ name: string; relation: "extends" | "implements" }> = [];
  const declaration = rawDeclaration.replace(
    /^\s*(?:(?:export|public|private|protected|internal|abstract|final|open|sealed|static|data)\s+)+/,
    "",
  );
  const extendsMatch = /\bextends\s+([^{]+?)(?:\bimplements\b|\bwith\b|\{|$)/.exec(declaration);
  if (extendsMatch !== null)
    for (const name of splitTypeList(extendsMatch[1]!)) out.push({ name, relation: "extends" });
  const implementsMatch = /\b(?:implements|with)\s+([^{]+?)(?:\{|$)/.exec(declaration);
  if (implementsMatch !== null)
    for (const name of splitTypeList(implementsMatch[1]!)) out.push({ name, relation: "implements" });
  const pythonMatch = /^class\s+\w+\s*\(([^)]*)\)/.exec(declaration);
  if (pythonMatch !== null)
    for (const name of splitTypeList(pythonMatch[1]!)) out.push({ name, relation: "extends" });
  const rubyMatch = /^class\s+\w+\s*<\s*([A-Za-z_][\w.]*)/.exec(declaration);
  if (rubyMatch !== null) out.push({ name: rubyMatch[1]!, relation: "extends" });
  if (out.length === 0) {
    const colonMatch = /^(?:class|struct|interface)\s+\w+\s*:\s*([^{]+)/.exec(declaration);
    if (colonMatch !== null)
      for (const name of splitTypeList(colonMatch[1]!)) out.push({ name, relation: "extends" });
  }
  return out;
}

function splitTypeList(text: string): string[] {
  const names: string[] = [];
  for (const part of text.split(",")) {
    // Skip Python keyword-argument bases (`metaclass=Meta`) and `*args`/`**kw`
    // unpacking, which are not supertypes.
    if (part.includes("=") || part.trim().startsWith("*")) continue;
    const cleaned = part
      .trim()
      .replace(/^(?:public|private|protected|virtual|final|open|sealed|abstract)\s+/, "")
      .replace(/<[^>]*>/g, "")
      .replace(/\(.*$/, "");
    const match = /^[A-Za-z_][\w.]*/.exec(cleaned.trim());
    if (match !== null) names.push(match[0]);
  }
  return names;
}
