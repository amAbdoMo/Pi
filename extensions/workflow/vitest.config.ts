import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const stub = (name: string) => path.join(here, "tests", "stubs", name);

export default defineConfig({
  resolve: {
    alias: {
      "@earendil-works/pi-coding-agent": stub("coding-agent.ts"),
      "@earendil-works/pi-ai": stub("pi-ai.ts"),
      "@earendil-works/pi-tui": stub("pi-tui.ts"),
    },
  },
  test: {
    include: ["extensions/workflow/tests/*.test.ts"],
    environment: "node",
  },
});
