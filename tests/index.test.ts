import { describe, it, expect } from "vitest";
import prettier from "prettier";
import path from "path";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import cliCmds from "./utils/cli-cmds";
import { getSnapshotContent, snapshotsPaths } from "./utils/snapshots";

describe("next-express e2e test", () => {
  it(
    "[ts-impl] should compile to a valid express app",
    { timeout: 1000 * 10 },
    async () => {
      const filename = "test-default-server-ts.ts";

      execSync(cliCmds.ts.default(filename), { stdio: "inherit" });
      const resultFilePath = path.resolve(
        process.cwd(),
        "tests",
        "dist",
        filename,
      );
      const resultFileContent = readFileSync(resultFilePath, "utf-8");
      const result = await prettier.format(resultFileContent, {
        parser: "typescript",
      });

      expect(result).eq(getSnapshotContent(snapshotsPaths.default));
    },
  );

  it(
    "[ts-impl] should compile to a valid express app with custom server",
    { timeout: 1000 * 10 },
    async () => {
      const filename = "test-custom-server-ts.ts";

      execSync(cliCmds.ts.customServer(filename), { stdio: "inherit" });
      const resultFilePath = path.resolve(
        process.cwd(),
        "tests",
        "dist",
        filename,
      );
      const resultFileContent = readFileSync(resultFilePath, "utf-8");
      const result = await prettier.format(resultFileContent, {
        parser: "typescript",
      });

      expect(result).eq(getSnapshotContent(snapshotsPaths.customServer));
    },
  );

  it("[rust-impl] should compile to a valid express app", async () => {
    const filename = "test-default-server-rust.ts";

    execSync(cliCmds.rs.default(filename), {
      stdio: "inherit",
      cwd: path.resolve(process.cwd(), "src-rust"),
    });
    const resultFilePath = path.resolve(
      process.cwd(),
      "tests",
      "dist",
      filename,
    );
    const resultFileContent = readFileSync(resultFilePath, "utf-8");
    const result = await prettier.format(resultFileContent, {
      parser: "typescript",
    });

    expect(result).eq(getSnapshotContent(snapshotsPaths.default));
  });

  it("[rust-impl] should compile to a valid express app with custom server", async () => {
    const filename = "test-custom-server-rust.ts";

    execSync(cliCmds.rs.customServer(filename), {
      stdio: "inherit",
      cwd: path.resolve(process.cwd(), "src-rust"),
    });
    const resultFilePath = path.resolve(
      process.cwd(),
      "tests",
      "dist",
      filename,
    );
    const resultFileContent = readFileSync(resultFilePath, "utf-8");
    const result = await prettier.format(resultFileContent, {
      parser: "typescript",
    });

    expect(result).eq(getSnapshotContent(snapshotsPaths.customServer));
  });
});
