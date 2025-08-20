import { logger } from "../env-logger";
import path from "path";
import { fileURLToPath } from "node:url";
import { downloadWithRedirects } from "./post-install-downloader";
import { chmodSync, statSync } from "node:fs";
import { RELEASE_TAG_NAME } from "./release-tag-name";

let DIR_NAME: string;
try {
  DIR_NAME = __dirname;
} catch {
  // @ts-expect-error Only available in ES modules
  DIR_NAME = path.dirname(fileURLToPath(import.meta.url));
}

logger.prefix = "next-express-postinstall";

function getBinaryName() {
  if (process.platform === "darwin") {
    return "nexp-compiler-rs-macos-universal";
  }
  if (process.platform === "linux" && process.arch === "x64") {
    return "nexp-compiler-rs-x86_64-unknown-linux-gnu";
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return "nexp-compiler-rs-x86_64-pc-windows-gnu";
  }
  return undefined;
}

function makeGithubReleaseUrl(tag: string, binary: string) {
  return `https://github.com/Qordli/next-express/releases/download/${tag}/${binary}`;
}

const fallbackMsg =
  "Will fall back to typescript implementation. This is fine, but it may be slower.";

async function main() {
  const binaryName = getBinaryName();
  if (!binaryName) {
    logger.warn(
      "Cannot find binary for current platform/architecture. " + fallbackMsg,
    );
    return;
  }
  const targetUrl = makeGithubReleaseUrl(RELEASE_TAG_NAME, binaryName);

  const executableName = "nexp-compiler-rs";
  const splited = binaryName.split(executableName);
  // this path must match the path in `src/build.ts > findCompilerExecutable()` call
  const executablePath = path.resolve(
    DIR_NAME,
    "..",
    "bin",
    splited[1].slice(1),
    executableName,
  );
  logger.info("Downloaded binary from", targetUrl, "to", executablePath);

  try {
    await downloadWithRedirects(targetUrl, executablePath);
  } catch (error) {
    logger.warn("Failed to download binary.", error);
    logger.warn(fallbackMsg);
    logger.warn(
      "If network error occurs, you can re-install again. Or just use the TypeScript implementation.",
    );
    process.exit(1);
  }
  logger.info("Binary downloaded successfully.");

  if (process.platform !== "win32") {
    try {
      const currentStat = statSync(executablePath);
      const currentMode = currentStat.mode;
      // Add execute permissions (+x)
      chmodSync(executablePath, currentMode | 0o111);
      logger.info("Binary chmod +x success.");
    } catch (error) {
      logger.error("Failed to set executable permission:", error);
      throw new Error("Failed to set executable permission");
    }
  }

  logger.info("ALL DONE");
}

main();
