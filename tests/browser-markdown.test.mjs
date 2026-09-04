import assert from "node:assert/strict";
import test from "node:test";

import {
  parseInlineMarkdown,
  parseMarkdown,
  safeExternalHref,
} from "../browser/public/markdown.js";

test("Markdown blocks preserve code and represent headings, lists, links, and tables", () => {
  const blocks = parseMarkdown([
    "## Release notes",
    "",
    "Use `npm test` and read [the guide](https://example.com/docs).",
    "",
    "- First",
    "- Second",
    "",
    "| Name | State |",
    "| :--- | ---: |",
    "| Browser | Ready |",
    "",
    "```js",
    "const answer = 42;",
    "```",
  ].join("\n"));

  assert.deepEqual(blocks.map((block) => block.type), ["heading", "paragraph", "list", "table", "codeBlock"]);
  assert.equal(blocks[0].level, 2);
  assert.deepEqual(blocks[1].children.map((token) => token.type), ["text", "code", "text", "link", "text"]);
  assert.equal(blocks[2].items.length, 2);
  assert.deepEqual(blocks[3].alignments, ["left", "right"]);
  assert.equal(blocks[4].language, "js");
  assert.equal(blocks[4].text, "const answer = 42;");
});

test("strong emphasis renders as a semantic token instead of visible Markdown markers", () => {
  assert.deepEqual(parseInlineMarkdown("**Commit:** ready and __verified__"), [
    { type: "strong", text: "Commit:" },
    { type: "text", text: " ready and " },
    { type: "strong", text: "verified" },
  ]);
});

test("untrusted HTML and unsafe links remain inert text", () => {
  const source = "<img src=x onerror=alert(1)> [run](javascript:alert(1)) [local](/api/state)";
  const [paragraph] = parseMarkdown(source);

  assert.deepEqual(paragraph.children, [{ type: "text", text: source }]);
  assert.equal(safeExternalHref("javascript:alert(1)"), null);
  assert.equal(safeExternalHref("/api/state"), null);
});

test("external Markdown links allow balanced destination parentheses", () => {
  const tokens = parseInlineMarkdown("[web](https://example.com/a_(b)) [mail](mailto:team@example.com)");

  assert.equal(tokens[0].href, "https://example.com/a_(b)");
  assert.equal(tokens[2].href, "mailto:team@example.com");
  assert.equal(safeExternalHref("file:///C:/private.txt"), null);
});

test("long and unterminated Markdown syntax falls back to the original text", () => {
  const source = `${"[".repeat(50_000)} unfinished`;
  assert.deepEqual(parseInlineMarkdown(source), [{ type: "text", text: source }]);
  assert.deepEqual(parseInlineMarkdown("Use `unfinished and [broken](link"), [
    { type: "text", text: "Use `unfinished and [broken](link" },
  ]);
});

test("malformed labels do not consume a later valid link", () => {
  const tokens = parseInlineMarkdown("[plain] then [web](https://example.com)");

  assert.equal(tokens[0].text, "[plain] then ");
  assert.equal(tokens[1].type, "link");
  assert.equal(tokens[1].label, "web");
});

test("longer fenced delimiters preserve embedded triple backticks", () => {
  const [block] = parseMarkdown("````md\n```\nstill code\n````");

  assert.equal(block.type, "codeBlock");
  assert.equal(block.language, "md");
  assert.equal(block.text, "```\nstill code");
});
