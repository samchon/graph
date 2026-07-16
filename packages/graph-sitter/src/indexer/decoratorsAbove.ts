export function decoratorsAbove(lines: readonly string[], index: number): string[] {
  const names: string[] = [];
  for (let i = Math.min(index, lines.length) - 1; i >= 0; i--) {
    const match = /^@([A-Za-z_$][\w$.]*)/.exec(lines[i]!.trim());
    if (match === null) break;
    names.push(match[1]!);
  }
  return names;
}
