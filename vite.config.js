import { defineConfig } from "vite";
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

function copyOrtWasm() {
  return {
    name: "copy-ort-wasm",
    closeBundle() {
      const src = resolve("node_modules/onnxruntime-web/dist");
      const dst = resolve("dist/ort");
      if (!existsSync(src)) return;
      mkdirSync(dst, { recursive: true });
      for (const name of readdirSync(src)) {
        if (name.endsWith(".wasm")) cpSync(resolve(src, name), resolve(dst, name));
      }
    }
  };
}

export default defineConfig({
  plugins: [copyOrtWasm()],
  build: {
    target: "es2022",
    sourcemap: true
  }
});
