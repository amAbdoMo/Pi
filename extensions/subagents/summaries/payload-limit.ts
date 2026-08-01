const TRUNCATION_SUFFIX = "\n[Completion payload truncated; full child output remains in its referenced file.]";

export function truncateUtf8Prefix(text: string, maxBytes: number): string {
  let output = "";
  let used = 0;
  for (const character of text.toWellFormed()) {
    const size = Buffer.byteLength(character, "utf8");
    if (used + size > maxBytes) break;
    output += character;
    used += size;
  }
  return output;
}

export function truncateUtf8Suffix(text: string, maxBytes: number): string {
  const characters = Array.from(text.toWellFormed());
  let start = characters.length;
  let used = 0;
  while (start > 0) {
    const character = characters[start - 1];
    const size = Buffer.byteLength(character, "utf8");
    if (used + size > maxBytes) break;
    start--;
    used += size;
  }
  return characters.slice(start).join("");
}

export function serializedTextBytes(text: string): number {
  return Math.max(
    0,
    Buffer.byteLength(JSON.stringify(text.toWellFormed()), "utf8") - 2,
  );
}

function serializedTextPrefix(text: string, maxBytes: number): string {
  let output = "";
  let used = 0;
  for (const character of text.toWellFormed()) {
    const size = serializedTextBytes(character);
    if (used + size > maxBytes) break;
    output += character;
    used += size;
  }
  return output;
}

export function enforcePayloadByteLimit(
  payload: string,
  maxBytes: number,
): string {
  const safeLimit = Math.max(0, Math.floor(maxBytes));
  const wellFormed = payload.toWellFormed();
  if (serializedTextBytes(wellFormed) <= safeLimit) return wellFormed;
  const suffixBytes = serializedTextBytes(TRUNCATION_SUFFIX);
  if (suffixBytes >= safeLimit)
    return serializedTextPrefix(TRUNCATION_SUFFIX, safeLimit);
  return `${serializedTextPrefix(wellFormed, safeLimit - suffixBytes)}${TRUNCATION_SUFFIX}`;
}

export function boundedOptionalText(
  text: string | undefined,
  maxBytes: number,
): string | undefined {
  return text === undefined ? undefined : enforcePayloadByteLimit(text, maxBytes);
}
