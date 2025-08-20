import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import prettier from "prettier";
import cliCmds from "tests/utils/cli-cmds";
import { snapshotsPaths } from "tests/utils/snapshots";

async function updateDefault() {
  const filename = "default-rs.ts";
  execSync(cliCmds.rs.default(filename), {
    stdio: "inherit",
    cwd: path.resolve(process.cwd(), "src-rust"),
  });

  const resultFilePath = path.resolve(process.cwd(), "tests", "dist", filename);
  const resultFileContent = readFileSync(resultFilePath, "utf-8");
  const result = await prettier.format(resultFileContent, {
    parser: "typescript",
  });

  if (!existsSync(path.dirname(snapshotsPaths.default))) {
    mkdirSync(path.dirname(snapshotsPaths.default), { recursive: true });
  }
  writeFileSync(snapshotsPaths.default, result);
}

async function updateCustomServer() {
  const filename = "custom-server-rs.ts";
  execSync(cliCmds.rs.customServer(filename), {
    stdio: "inherit",
    cwd: path.resolve(process.cwd(), "src-rust"),
  });

  const resultFilePath = path.resolve(process.cwd(), "tests", "dist", filename);
  const resultFileContent = readFileSync(resultFilePath, "utf-8");
  const result = await prettier.format(resultFileContent, {
    parser: "typescript",
  });

  if (!existsSync(path.dirname(snapshotsPaths.customServer))) {
    mkdirSync(path.dirname(snapshotsPaths.customServer), { recursive: true });
  }
  writeFileSync(snapshotsPaths.customServer, result);
}

async function main() {
  console.log("Updating custom snapshot...");

  await updateDefault();
  await updateCustomServer();

  console.log("Custom snapshot update complete.");
}

main();
