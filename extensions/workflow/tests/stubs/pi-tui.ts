export class Text {
  constructor(public text: string) {}
  render(): string[] { return String(this.text).split("\n"); }
  invalidate() {}
}

export class Markdown extends Text {}

export function isKeyRelease(): boolean { return false; }
export function matchesKey(data: string, key: string): boolean { return data === key; }
export function visibleWidth(text: string): number { return [...String(text)].length; }
export function truncateToWidth(text: string, width: number, ellipsis = ""): string {
  const chars = [...String(text)];
  if (chars.length <= width) return String(text);
  return chars.slice(0, Math.max(0, width - [...ellipsis].length)).join("") + ellipsis;
}
export function wrapTextWithAnsi(text: string, width: number): string[] {
  const chars = [...String(text)];
  const lines: string[] = [];
  for (let index = 0; index < chars.length; index += Math.max(1, width)) lines.push(chars.slice(index, index + Math.max(1, width)).join(""));
  return lines.length ? lines : [""];
}
