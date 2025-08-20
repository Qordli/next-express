import { defineConfig } from "tsup";

export default defineConfig([
  // build bin
  {
    entry: {
      "next-express": "src/bin.ts",
      "nexp-compiler-ts": "src/ts-impl-cli.ts",
    },
    target: "node22",
    format: ["esm"],
    clean: true,
    outDir: "dist/bin",
    external: ["tsup", "express"],
    minify: true,
  },
  // build post-install script
  {
    entry: ["src/post-install/index.ts"],
    target: "node22",
    format: ["esm"],
    clean: false,
    outDir: "dist/post-install",
    external: ["tsup", "express"],
    minify: true,
  },
  // build esm
  {
    entry: ["src/index.ts", "src/build.ts"],
    target: "node22",
    format: ["esm"],
    clean: false,
    sourcemap: true,
    dts: true,
    outDir: "dist",
    external: ["tsup", "express"],
  },
  // build cjs
  {
    entry: ["src/index.ts", "src/build.ts"],
    target: "node22",
    format: ["cjs"],
    clean: false,
    sourcemap: true,
    dts: true,
    outDir: "dist/cjs",
    external: ["tsup", "express"],
  },
]);
