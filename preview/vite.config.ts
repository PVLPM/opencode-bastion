import { fileURLToPath } from "node:url";
import solid from "vite-plugin-solid";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

// A standalone harness for the panel: the host's dark theme tokens live in
// tokens.css and the same src/ui stylesheet the plugin ships is imported as-is.
export default defineConfig({
  root,
  plugins: [solid()],
  resolve: {
    dedupe: ["solid-js", "solid-js/web", "solid-js/store"],
  },
  server: {
    port: 5199,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] },
  },
});
