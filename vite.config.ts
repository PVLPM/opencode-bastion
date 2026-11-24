import { gui } from "@opencode/plugin/gui/vite";
import { defineConfig } from "vite";

// The host preset owns the bundle shape: one CommonJS file with Solid and the
// OpenCode SDK kept external, because the Desktop app provides them.
export default defineConfig({
  plugins: [gui({ entry: "src/gui.tsx", outFile: "dist/gui-experimental.cjs" })],
  resolve: { dedupe: ["solid-js", "solid-js/web", "solid-js/store"] },
  // Overwrite the single bundle in place: emptying dist/ makes a running Desktop
  // briefly fail to read it (PluginNotFoundError in main.log) during every build.
  build: { sourcemap: false, emptyOutDir: false },
});
