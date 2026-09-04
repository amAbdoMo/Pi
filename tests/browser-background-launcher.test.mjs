import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { startBackgroundHarness } from "../scripts/browser/pi-harness-background.mjs";

test("background launcher starts the loopback server without opening a browser", async () => {
  let receivedOptions;
  let started = false;
  const server = {
    async start() { started = true; },
    async stop() {},
  };

  const activeServer = await startBackgroundHarness({
    port: 3081,
    serverFactory(options) {
      receivedOptions = options;
      return server;
    },
  });

  assert.equal(activeServer, server);
  assert.equal(started, true);
  assert.deepEqual(receivedOptions, { port: 3081 });
});

test("background launcher rejects invalid ports before creating a server", async () => {
  let created = false;
  await assert.rejects(
    startBackgroundHarness({ port: 0, serverFactory: () => { created = true; } }),
    /Invalid Pi Harness port/,
  );
  assert.equal(created, false);
});

test("startup task is windowless, per-user, single-instance, and ownership guarded", async () => {
  const [installer, supervisor, windowless, launcher] = await Promise.all([
    readFile(new URL("../scripts/browser/install-pi-harness-startup.ps1", import.meta.url), "utf8"),
    readFile(new URL("../scripts/browser/run-pi-harness-background.ps1", import.meta.url), "utf8"),
    readFile(new URL("../scripts/browser/run-pi-harness-hidden.vbs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/browser/pi-harness-background.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(installer, /New-ScheduledTaskTrigger -AtLogOn -User \$currentUser/);
  assert.match(installer, /-LogonType Interactive/);
  assert.match(installer, /-RunLevel Limited/);
  assert.match(installer, /-Hidden/);
  assert.match(installer, /-MultipleInstances IgnoreNew/);
  assert.match(installer, /task\.Description -ne \$managedDescription/);
  assert.match(installer, /System32\\wscript\.exe/);
  assert.match(supervisor, /CreateNoWindow = \$true/);
  assert.match(supervisor, /UseShellExecute = \$false/);
  assert.match(windowless, /shell\.Run\(command, 0, True\)/i);
  assert.doesNotMatch(launcher, /explorer\.exe|openDefaultBrowser|spawn\(/);
  assert.doesNotMatch(`${installer}\n${supervisor}\n${windowless}`, /bootstrapToken|browserSessionToken|Set-Cookie/i);
});
