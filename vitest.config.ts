import { fileURLToPath } from "node:url";
import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

// DOM tests must share one Solid instance between the test and the compiled
// component; otherwise signals created in one copy are invisible to the other.
const solidDev = fileURLToPath(new URL("./node_modules/solid-js/dist/dev.js", import.meta.url));
const solidWebDev = fileURLToPath(
  new URL("./node_modules/solid-js/web/dist/dev.js", import.meta.url),
);

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: "model",
          environment: "node",
          include: ["test/**/*.test.ts"],
        },
      },
      {
        plugins: [solid()],
        resolve: {
          conditions: ["browser", "development"],
          alias: [
            { find: /^solid-js$/u, replacement: solidDev },
            { find: /^solid-js\/web$/u, replacement: solidWebDev },
          ],
        },
        test: {
          name: "dom",
          environment: "happy-dom",
          include: ["test/**/*.test.tsx"],
          server: { deps: { inline: [/solid-js/], external: [/solid-js/] } },
        },
      },
    ],
  },
});
