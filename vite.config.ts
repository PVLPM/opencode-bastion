import { gui } from "@opencode/plugin/gui/vite";
import { defineConfig } from "vite";

// The host preset owns the bundle shape: one CommonJS file with Solid and the
// OpenCode SDK kept external, because the Desktop app provides them.
export default defineConfig({
  plugins: [gui({ entry: "src/gui.tsx", outFile: "dist/gui-experimental.cjs" })],
  resolve: { dedupe: ["solid-js", "solid-js/web", "solid-js/store"] },
  build: { sourcemap: false },
});
