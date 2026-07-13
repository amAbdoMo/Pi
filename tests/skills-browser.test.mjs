import assert from "node:assert/strict";
import test from "node:test";
import {
  skillChoices,
  withoutSkillCommandSuggestions,
} from "../extensions/skills-browser/browser.ts";

test("skill browser lists only loaded skills in name order", () => {
  const choices = skillChoices([
    { name: "skill:zeta", description: "Last skill", source: "skill" },
    { name: "plan", description: "Not a skill", source: "extension" },
    { name: "skill:alpha", description: "First skill", source: "skill" },
  ]);

  assert.deepEqual(choices, [
    { value: "skill:alpha", label: "alpha", description: "First skill" },
    { value: "skill:zeta", label: "zeta", description: "Last skill" },
  ]);
});

test("slash autocomplete keeps commands while hiding individual skills", () => {
  const filtered = withoutSkillCommandSuggestions({
    prefix: "/",
    items: [
      { value: "skills", label: "skills" },
      { value: "skill:frontend-design", label: "skill:frontend-design" },
      { value: "settings", label: "settings" },
    ],
  });

  assert.deepEqual(filtered?.items.map((item) => item.value), ["skills", "settings"]);
  assert.equal(
    withoutSkillCommandSuggestions({
      prefix: "/skill:",
      items: [{ value: "skill:frontend-design", label: "skill:frontend-design" }],
    }),
    null,
  );
});

test("non-command autocomplete remains unchanged", () => {
  const suggestions = {
    prefix: "src/",
    items: [{ value: "src/index.ts", label: "src/index.ts" }],
  };

  assert.equal(withoutSkillCommandSuggestions(suggestions), suggestions);
});
