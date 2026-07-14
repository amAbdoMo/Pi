import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { configureWarpSettings } from "../scripts/set-warp-settings.mjs";

test("Warp configuration preserves unrelated TOML and creates one backup", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-warp-settings-"));
  const settingsFile = path.join(directory, "settings.toml");
  const original = `[appearance]

[appearance.text] # Warp text settings
font_size = 16.0
font_name = "Hack # Mono" # retain this explanation

[terminal]
osc52_clipboard_access = "write_only"

[terminal.input] # Warp input settings
input_box_type_setting = "universal"

[account]
is_settings_sync_enabled = true
`;
  fs.writeFileSync(settingsFile, original);

  assert.equal(configureWarpSettings(settingsFile, "DejaVuSansM Nerd Font Mono"), true);
  assert.equal(configureWarpSettings(settingsFile, "DejaVuSansM Nerd Font Mono"), false);

  const configured = fs.readFileSync(settingsFile, "utf8");
  assert.match(configured, /font_name = "DejaVuSansM Nerd Font Mono" # retain this explanation/);
  assert.match(configured, /input_box_type_setting = "classic"/);
  assert.match(configured, /osc52_clipboard_access = "write_only"/);
  assert.match(configured, /is_settings_sync_enabled = true/);
  assert.equal(fs.readFileSync(`${settingsFile}.amabdomo-pi-backup`, "utf8"), original);
  assert.equal(fs.readdirSync(directory).some((name) => name.endsWith(".tmp")), false);
});

test("unsupported or ambiguous Warp TOML fails without modifying settings", () => {
  const cases = [
    {
      original: `[appearance.text]
font_name = "Hack"

[appearance.text]
font_size = 16
`,
      expectedError: /duplicate \[appearance\.text\] table/,
    },
    {
      original: `[account]
note = """multiline
value"""
`,
      expectedError: /multiline TOML strings are not supported safely/,
    },
    {
      original: `[appearance] # Warp appearance settings
text.font_name = "Hack"
`,
      expectedError: /unsupported TOML assignment syntax/,
    },
    {
      original: `[appearance]
text = { font_name = "Hack" }
`,
      expectedError: /inline appearance\.text settings are not supported safely/,
    },
    {
      original: `[appearance.text] # Warp note
"font_name" = "Hack"
`,
      expectedError: /unsupported TOML assignment syntax/,
    },
    {
      original: `[appearance.text]
"font\\u005fname" = "Hack"
`,
      expectedError: /unsupported TOML assignment syntax/,
    },
    {
      original: `["appearance"."text"] # Warp note
font_name = "Hack"
`,
      expectedError: /unsupported TOML table syntax/,
    },
    {
      original: `["appearance"."te\\u0078t"]
font_name = "Hack"
`,
      expectedError: /unsupported TOML table syntax/,
    },
    {
      original: `[appearance . text]
font_name = "Hack"
`,
      expectedError: /unsupported TOML table syntax/,
    },
    {
      original: `[[appearance.text]]
font_name = "Hack"
`,
      expectedError: /unsupported TOML table syntax/,
    },
    {
      original: `[appearance.text]
font_name.family = "Hack"
`,
      expectedError: /unsupported TOML assignment syntax/,
    },
    {
      original: `[appearance.text.font_name]
family = "Hack"
`,
      expectedError: /appearance\.text\.font_name is defined as a table/,
    },
    {
      original: `[terminal.input]
input_box_type_setting.mode = "classic"
`,
      expectedError: /unsupported TOML assignment syntax/,
    },
    {
      original: `[terminal.input.input_box_type_setting]
mode = "classic"
`,
      expectedError: /terminal\.input\.input_box_type_setting is defined as a table/,
    },
  ];

  for (const { original, expectedError } of cases) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-warp-settings-invalid-"));
    const settingsFile = path.join(directory, "settings.toml");
    fs.writeFileSync(settingsFile, original);

    assert.throws(() => configureWarpSettings(settingsFile, "CaskaydiaMono NFM"), expectedError);
    assert.equal(fs.readFileSync(settingsFile, "utf8"), original);
    assert.equal(fs.existsSync(`${settingsFile}.amabdomo-pi-backup`), false);
    assert.equal(fs.readdirSync(directory).some((name) => name.endsWith(".tmp")), false);
  }
});
