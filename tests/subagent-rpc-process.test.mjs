import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { RpcProcess } from "../extensions/subagents/rpc-process.ts";

const cwd = process.cwd();

function makeClient(source) {
  return new RpcProcess(process.execPath, ["--input-type=module", "-e", source], {
    cwd,
    env: {},
  });
}

test("subagent startup reports spawn failures instead of appearing ready", async () => {
  const client = new RpcProcess(`pi-workbench-missing-${process.pid}`, [], { cwd, env: {} });
  await assert.rejects(client.start(), /child pi process error|ENOENT/);
  await client.stop();
});

test("subagent abort RPC is bounded when a child stops responding", async () => {
  const client = makeClient("process.stdin.resume(); setInterval(() => {}, 1000);");
  await client.start();
  const started = Date.now();
  await assert.rejects(client.abort(), /abort timed out after 750ms/);
  assert.ok(Date.now() - started < 2_500, "abort should not wait indefinitely");
  await client.stop();
});

test("stopping a subagent kills its descendant process tree", async () => {
  const marker = join(tmpdir(), `pi-subagent-orphan-${process.pid}.txt`);
  rmSync(marker, { force: true });
  const descendant = `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "orphan"), 1200); setInterval(() => {}, 1000);`;
  const client = makeClient(`
    import { spawn } from "node:child_process";
    spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}], { stdio: "ignore" });
    process.stdin.resume();
    setInterval(() => {}, 1000);
  `);

  try {
    await client.start();
    await new Promise((resolve) => setTimeout(resolve, 150));
    await client.stop();
    await new Promise((resolve) => setTimeout(resolve, 1_400));
    assert.equal(existsSync(marker), false, "descendant survived subagent stop");
  } finally {
    rmSync(marker, { force: true });
    await client.stop().catch(() => undefined);
  }
});
