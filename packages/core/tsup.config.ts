import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  loader: { ".css": "text" },
  noExternal: ["driver.js/dist/driver.css"],
});
