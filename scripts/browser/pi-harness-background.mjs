import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createPiBrowserServer } from "../../browser/server.mjs";

const DEFAULT_PORT = 3081;

export async function startBackgroundHarness({
  port = process.env.PI_BROWSER_PORT ? Number(process.env.PI_BROWSER_PORT) : DEFAULT_PORT,
  serverFactory = createPiBrowserServer,
} = {}) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("Invalid Pi Harness port");
  const server = serverFactory({ port });
  await server.start();
  return server;
}

async function main() {
  const server = await startBackgroundHarness();
  let stopping;
  const stop = () => {
    stopping ??= server.stop().finally(() => process.exit(0));
    return stopping;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
