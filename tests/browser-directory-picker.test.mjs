import assert from "node:assert/strict";
import test from "node:test";

import { pickDirectory } from "../browser/directory-picker.mjs";

function pickerProcess(stdout, invocation) {
  return (file, args, options, callback) => {
    invocation.push({ file, args, options });
    queueMicrotask(() => callback(null, stdout));
    return { kill() {} };
  };
}

test("Windows directory picker launches PowerShell without a shell and returns the selected path", async () => {
  const invocation = [];
  const selected = await pickDirectory({
    platform: "win32",
    execFileImpl: pickerProcess("A:\\GitHub\\Pi Workbench", invocation),
  });

  assert.equal(selected, "A:\\GitHub\\Pi Workbench");
  assert.equal(invocation[0].file, "powershell.exe");
  assert.equal(invocation[0].options.windowsHide, false);
  assert.equal(invocation[0].args.includes("-STA"), true);
  const encodedIndex = invocation[0].args.indexOf("-EncodedCommand");
  assert.notEqual(encodedIndex, -1);
  const script = Buffer.from(invocation[0].args[encodedIndex + 1], "base64").toString("utf16le");
  assert.match(script, /DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7/i);
  assert.match(script, /Select Workspace Directory/);
  assert.doesNotMatch(script, /BrowseForFolder/);
});

test("Windows directory picker reports cancellation when no folder is returned", async () => {
  const selected = await pickDirectory({
    platform: "win32",
    execFileImpl: pickerProcess("", []),
  });

  assert.equal(selected, null);
});

test("an already-aborted folder request does not launch PowerShell", async () => {
  const controller = new AbortController();
  let launches = 0;
  controller.abort();

  const selected = await pickDirectory({
    signal: controller.signal,
    platform: "win32",
    execFileImpl: () => { launches += 1; },
  });

  assert.equal(selected, null);
  assert.equal(launches, 0);
});

test("aborting an open folder picker terminates its process and resolves as cancellation", async () => {
  const controller = new AbortController();
  let killed = false;
  const selectedPromise = pickDirectory({
    signal: controller.signal,
    platform: "win32",
    execFileImpl: () => ({ kill() { killed = true; } }),
  });

  controller.abort();

  assert.equal(await selectedPromise, null);
  assert.equal(killed, true);
});
