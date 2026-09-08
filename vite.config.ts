import { defineConfig } from "vite";
import { resolve } from "node:path";

// The build timestamp is baked in at build time and shown on every page. It is
// how a phone mid-run tells "the deploy I am looking at" from "the deploy I
// looked at ten minutes ago" — docs/STATE.md#verify leans on it.
const BUILD_TIME = new Date().toISOString();

export default defineConfig({
  base: "./",
  define: {
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "index.html"),
        acceptance: resolve(import.meta.dirname, "acceptance.html"),
        bench: resolve(import.meta.dirname, "bench.html"),
      },
    },
  },
});
