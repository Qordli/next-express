import { logger } from "../src/env-logger";
import path from "path";
import { platform, arch } from "os";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "fs";
import { spawnAsync } from "./spawn-async";
import { question } from "./question-cli";
import { getVersions } from "./versions";

logger.prefix = "build-script";

async function build_rust_x86_64_unknown_linux_gnu() {
  let cmdName: string;
  if (platform() === "linux" && arch() === "x64") {
    cmdName = "cargo";
  } else {
    cmdName = "cross";
  }
  logger.info("Build rust-x86_64-unknown-linux-gnu use", cmdName);

  await spawnAsync(
    cmdName,
    ["build", "--release", "--target", "x86_64-unknown-linux-gnu"],
    "rust-x86_64-unknown-linux-gnu",
    {
      cwd: path.resolve("src-rust"),
    },
  );

  const binaryPath = path.resolve(
    "src-rust",
    "target",
    "x86_64-unknown-linux-gnu",
    "release",
    "nexp-compiler-rs",
  );
  const distPath = path.resolve(
    "rust-dist",
    "nexp-compiler-rs-x86_64-unknown-linux-gnu",
  );
  if (!existsSync(path.dirname(distPath))) {
    mkdirSync(path.dirname(distPath), { recursive: true });
  }
  copyFileSync(binaryPath, distPath);
  logger.info(`${binaryPath} copied to ${distPath}`);

  logger.info("Build rust-x86_64-unknown-linux-gnu DONE");
}

async function build_rust_x86_64_pc_windows_gnu() {
  let cmdName: string;
  if (platform() === "win32" && arch() === "x64") {
    cmdName = "cargo";
  } else {
    cmdName = "cross";
  }
  logger.info("Build rust-x86_64-pc-windows-gnu use", cmdName);

  await spawnAsync(
    cmdName,
    ["build", "--release", "--target", "x86_64-pc-windows-gnu"],
    "rust-x86_64-pc-windows-gnu",
    {
      cwd: path.resolve("src-rust"),
    },
  );

  const binaryPath = path.resolve(
    "src-rust",
    "target",
    "x86_64-pc-windows-gnu",
    "release",
    "nexp-compiler-rs.exe",
  );
  const distPath = path.resolve(
    "rust-dist",
    "nexp-compiler-rs-x86_64-pc-windows-gnu.exe",
  );
  if (!existsSync(path.dirname(distPath))) {
    mkdirSync(path.dirname(distPath), { recursive: true });
  }
  copyFileSync(binaryPath, distPath);
  logger.info(`${binaryPath} copied to ${distPath}`);

  logger.info("Build rust-x86_64-pc-windows-gnu DONE");
}

async function build_rust_x86_64_apple_darwin() {
  logger.info("Build rust-x86_64-apple-darwin");
  if (platform() !== "darwin") {
    logger.error("Target x86_64-apple-darwin is not support cross build");
    throw new Error("Target x86_64-apple-darwin is not support cross build");
  }
  await spawnAsync(
    "cargo",
    ["build", "--release", "--target", "x86_64-apple-darwin"],
    "rust-x86_64-apple-darwin",
    {
      cwd: path.resolve("src-rust"),
    },
  );
  logger.info("Build rust-x86_64-apple-darwin DONE");
}

async function build_rust_aarch64_apple_darwin() {
  logger.info("Build rust-aarch64-apple-darwin");
  if (platform() !== "darwin") {
    logger.error("Target aarch64-apple-darwin is not support cross build");
    throw new Error("Target aarch64-apple-darwin is not support cross build");
  }
  await spawnAsync(
    "cargo",
    ["build", "--release", "--target", "aarch64-apple-darwin"],
    "rust-aarch64-apple-darwin",
    {
      cwd: path.resolve("src-rust"),
    },
  );
  logger.info("Build rust-aarch64-apple-darwin DONE");
}

async function lipo_macos_universal() {
  logger.info("Lipo macOS universal binary");

  const lipoCmd = process.env.LIPO_PATH || "lipo";
  try {
    await spawnAsync("which", [lipoCmd], "try-which-lipo");
  } catch (error) {
    logger.debug("Lipo command not found with error:", error);
    logger.error(
      "Lipo command not found." +
        " If you already install it," +
        " you can set the LIPO_PATH environment variable to specify its location." +
        " If you don't have it installed," +
        " please install Xcode command line tools.",
    );
    throw new Error("Lipo not found");
  }
  const outputPath = path.resolve(
    "rust-dist",
    "nexp-compiler-rs-macos-universal",
  );
  if (!existsSync(path.dirname(outputPath))) {
    mkdirSync(path.dirname(outputPath), { recursive: true });
  }
  await spawnAsync(
    lipoCmd,
    [
      "-output",
      outputPath,
      "-create",
      path.resolve(
        "src-rust",
        "target",
        "x86_64-apple-darwin",
        "release",
        "nexp-compiler-rs",
      ),
      path.resolve(
        "src-rust",
        "target",
        "aarch64-apple-darwin",
        "release",
        "nexp-compiler-rs",
      ),
    ],
    "lipo_macos_universal",
  );

  logger.info("Lipo macOS universal DONE");
}

async function buildRustImpl(skipBuildRustImpl: boolean) {
  if (skipBuildRustImpl) {
    logger.info("Skipping Rust implementation build as requested.");
    return;
  }

  logger.info("Building Rust implementation...");

  await build_rust_x86_64_unknown_linux_gnu();
  await build_rust_x86_64_pc_windows_gnu();
  await build_rust_x86_64_apple_darwin();
  await build_rust_aarch64_apple_darwin();
  await lipo_macos_universal();

  logger.info("Rust implementation build completed.");
}

async function buildTypescript() {
  logger.info("Building TypeScript...");

  await spawnAsync("pnpm", ["tsup"], "build-typescript");

  logger.info("TypeScript build completed.");
}

async function main() {
  let skipBuildRustImpl = false;
  if (
    process.env.SKIP_BUILD_RUST_IMPL === "1" ||
    process.env.SKIP_BUILD_RUST_IMPL === "true"
  ) {
    skipBuildRustImpl = true;
  }

  const versions = await getVersions();
  logger.info(`Will build following targets:`);
  logger.info(`- Main cli (version: ${versions.mainCli})`);
  logger.info(
    `  - Compiler cli typescript (version: ${versions.compilerTypescript})`,
  );
  logger.info(`  - Compiler cli rust (version: ${versions.compilerRust})`);
  logger.info(
    `  - Post-install script will search tag name "${versions.RELEASE_TAG_NAME}"`,
  );

  logger.info("This log is to remind you to bump the version if needed.");
  const answer = await question("Do you want to continue? (y/n)");
  if (answer !== "y") {
    logger.info("Build cancelled.");
    return;
  }

  logger.info("Build starting...");
  const startTime = performance.now();

  const distDirs = ["dist"];
  if (!skipBuildRustImpl) {
    distDirs.push("rust-dist");
  }
  distDirs.forEach((dir) => {
    const dirPath = path.resolve(dir);
    if (!existsSync(dirPath)) {
      return;
    }
    logger.info(`Clean up dist dir (${dirPath})...`);
    rmSync(dirPath, { recursive: true });
  });
  logger.info("Dist dirs cleaned up.");

  await buildRustImpl(skipBuildRustImpl);
  await buildTypescript();

  logger.info(`Build done in ${performance.now() - startTime}ms`);
}

main();
