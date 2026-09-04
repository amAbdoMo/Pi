const FENCE = /^ {0,3}(`{3,})[ \t]*([^\s`]*)?.*$/;
const HEADING = /^(#{1,6})[ \t]+(.+)$/;
const LIST_ITEM = /^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/;
const TABLE_DIVIDER = /^:?-{3,}:?$/;

function textNode(text) {
  return { type: "text", text };
}

function appendText(nodes, text) {
  if (!text) return;
  const previous = nodes.at(-1);
  if (previous?.type === "text") previous.text += text;
  else nodes.push(textNode(text));
}

function inlineCodeAt(source, start) {
  const end = source.indexOf("`", start + 1);
  if (end < 0) return null;
  return { node: { type: "code", text: source.slice(start + 1, end) }, end: end + 1 };
}

function strongAt(source, start) {
  const delimiter = source.slice(start, start + 2);
  const end = source.indexOf(delimiter, start + 2);
  if (end < 0 || end === start + 2) return null;
  return { node: { type: "strong", text: source.slice(start + 2, end) }, end: end + 2 };
}

function linkDestinationEnd(source, start) {
  let nested = 0;
  for (let cursor = start; cursor < source.length; cursor += 1) {
    if (source[cursor] === "\\") {
      cursor += 1;
      continue;
    }
    if (source[cursor] === "(") nested += 1;
    else if (source[cursor] === ")" && nested === 0) return cursor;
    else if (source[cursor] === ")") nested -= 1;
  }
  return -1;
}

function labelEndBefore(source, start, end) {
  for (let cursor = start; cursor < end; cursor += 1) {
    if (source[cursor] === "]") return cursor;
  }
  return -1;
}

function linkAt(source, start) {
  const nestedStart = source.indexOf("[", start + 1);
  const searchEnd = nestedStart < 0 ? source.length : nestedStart;
  const labelEnd = labelEndBefore(source, start + 1, searchEnd);
  if (labelEnd < 0 && nestedStart >= 0) {
    return { node: textNode(source.slice(start, nestedStart)), end: nestedStart };
  }
  if (labelEnd < 0) return { node: textNode(source.slice(start)), end: source.length };
  if (source[labelEnd + 1] !== "(") return { node: textNode(source.slice(start, labelEnd + 1)), end: labelEnd + 1 };
  const hrefEnd = linkDestinationEnd(source, labelEnd + 2);
  if (hrefEnd < 0) return { node: textNode(source.slice(start)), end: source.length };
  const label = source.slice(start + 1, labelEnd);
  const rawHref = source.slice(labelEnd + 2, hrefEnd).replace(/\\([()])/g, "$1").trim();
  const href = safeExternalHref(rawHref);
  if (!href) return { node: textNode(source.slice(start, hrefEnd + 1)), end: hrefEnd + 1 };
  return { node: { type: "link", label, href }, end: hrefEnd + 1 };
}

export function safeExternalHref(rawHref) {
  try {
    const url = new URL(rawHref);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function nextInlineTokenStart(source, cursor) {
  const candidates = ["`", "[", "**", "__"]
    .map((delimiter) => source.indexOf(delimiter, cursor))
    .filter((index) => index >= 0);
  return candidates.length > 0 ? Math.min(...candidates) : source.length;
}

export function parseInlineMarkdown(source) {
  const nodes = [];
  let cursor = 0;
  while (cursor < source.length) {
    const delimiter = source.slice(cursor, cursor + 2);
    const token = source[cursor] === "`"
      ? inlineCodeAt(source, cursor)
      : source[cursor] === "["
        ? linkAt(source, cursor)
        : delimiter === "**" || delimiter === "__" ? strongAt(source, cursor) : null;
    if (!token) {
      const end = nextInlineTokenStart(source, cursor + 1);
      appendText(nodes, source.slice(cursor, end));
      cursor = end;
    } else {
      if (token.node.type === "text") appendText(nodes, token.node.text);
      else nodes.push(token.node);
      cursor = token.end;
    }
  }
  return nodes;
}

function scanTableCells(source) {
  const cells = [];
  let cell = "";
  let inCode = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "`") inCode = !inCode;
    if (character === "|" && !inCode) {
      cells.push(cell);
      cell = "";
    } else if (character === "\\" && source[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else cell += character;
  }
  cells.push(cell);
  return cells;
}

function splitTableRow(line) {
  let source = line.trim();
  if (source.startsWith("|")) source = source.slice(1);
  if (source.endsWith("|")) source = source.slice(0, -1);
  return scanTableCells(source).map((cell) => cell.trim());
}

function tableAlignment(cell) {
  const trimmed = cell.trim();
  if (!TABLE_DIVIDER.test(trimmed)) return null;
  if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
  return trimmed.endsWith(":") ? "right" : "left";
}

function tableHeaderAt(lines, start) {
  if (start + 1 >= lines.length || !lines[start].includes("|")) return null;
  const headings = splitTableRow(lines[start]);
  const dividers = splitTableRow(lines[start + 1]);
  if (headings.length !== dividers.length) return null;
  const alignments = dividers.map(tableAlignment);
  return alignments.some((alignment) => alignment === null) ? null : { headings, alignments };
}

function tableRows(lines, start, width) {
  const rows = [];
  let cursor = start;
  while (cursor < lines.length && lines[cursor].includes("|") && lines[cursor].trim()) {
    const cells = splitTableRow(lines[cursor]);
    rows.push(Array.from({ length: width }, (_, index) => parseInlineMarkdown(cells[index] ?? "")));
    cursor += 1;
  }
  return { rows, end: cursor };
}

function tableAt(lines, start) {
  const header = tableHeaderAt(lines, start);
  if (!header) return null;
  const body = tableRows(lines, start + 2, header.headings.length);
  return {
    block: {
      type: "table",
      headings: header.headings.map(parseInlineMarkdown),
      alignments: header.alignments,
      rows: body.rows,
    },
    end: body.end,
  };
}

function closesFence(line, openingLength) {
  const match = line.match(/^ {0,3}(`{3,})[ \t]*$/);
  return Boolean(match && match[1].length >= openingLength);
}

function fencedCodeAt(lines, start) {
  const match = lines[start].match(FENCE);
  if (!match) return null;
  const codeLines = [];
  let cursor = start + 1;
  while (cursor < lines.length && !closesFence(lines[cursor], match[1].length)) {
    codeLines.push(lines[cursor]);
    cursor += 1;
  }
  if (cursor < lines.length) cursor += 1;
  return {
    block: { type: "codeBlock", language: match[2] || "", text: codeLines.join("\n") },
    end: cursor,
  };
}

function listAt(lines, start) {
  const first = lines[start].match(LIST_ITEM);
  if (!first) return null;
  const ordered = Boolean(first[2]);
  const items = [];
  let cursor = start;
  while (cursor < lines.length) {
    const match = lines[cursor].match(LIST_ITEM);
    if (!match || Boolean(match[2]) !== ordered) break;
    items.push(parseInlineMarkdown(match[3]));
    cursor += 1;
  }
  return {
    block: { type: "list", ordered, start: ordered ? Number(first[2]) : undefined, items },
    end: cursor,
  };
}

function startsBlock(lines, index) {
  const line = lines[index];
  return FENCE.test(line) || HEADING.test(line) || LIST_ITEM.test(line) || tableHeaderAt(lines, index) !== null;
}

function paragraphAt(lines, start) {
  const paragraphLines = [];
  let cursor = start;
  while (cursor < lines.length && lines[cursor].trim()) {
    if (cursor > start && startsBlock(lines, cursor)) break;
    paragraphLines.push(lines[cursor]);
    cursor += 1;
  }
  return {
    block: { type: "paragraph", children: parseInlineMarkdown(paragraphLines.join("\n")) },
    end: cursor,
  };
}

function headingAt(lines, start) {
  const match = lines[start].match(HEADING);
  if (!match) return null;
  return {
    block: { type: "heading", level: match[1].length, children: parseInlineMarkdown(match[2]) },
    end: start + 1,
  };
}

function blockAt(lines, start) {
  return fencedCodeAt(lines, start)
    ?? headingAt(lines, start)
    ?? tableAt(lines, start)
    ?? listAt(lines, start)
    ?? paragraphAt(lines, start);
}

export function parseMarkdown(source) {
  const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let cursor = 0;
  while (cursor < lines.length) {
    if (!lines[cursor].trim()) cursor += 1;
    else {
      const parsed = blockAt(lines, cursor);
      blocks.push(parsed.block);
      cursor = parsed.end;
    }
  }
  return blocks;
}
