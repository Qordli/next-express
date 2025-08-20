import { existsSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./env-logger";
import { spawnSync } from "child_process";

export { compile } from "./ts-impl";

let DIR_NAME: string;
try {
  DIR_NAME = __dirname;
} catch {
  // @ts-expect-error Only available in ES modules
  DIR_NAME = path.dirname(fileURLToPath(import.meta.url));
}

export function findCompilerExecutable() {
  const platform = process.platform;
  const arch = process.arch;

  // Determine the binary directory based on the platform and architecture
  let binaryDir: string | undefined;
  if (platform === "darwin") {
    binaryDir = path.resolve(DIR_NAME, "macos-universal");
  } else if (platform === "linux" && arch === "x64") {
    binaryDir = path.resolve(DIR_NAME, "x86_64-unknown-linux-gnu");
  } else if (platform === "win32" && arch === "x64") {
    binaryDir = path.resolve(DIR_NAME, "x86_64-pc-windows-gnu");
  }

  // If has pre-built binary, use it. If not, fall back to TypeScript implementation
  let executablePath = path.resolve(DIR_NAME, "nexp-compiler-ts.js");
  if (binaryDir) {
    const prebuiltPath = path.resolve(binaryDir, "nexp-compiler-rs");
    if (existsSync(prebuiltPath)) {
      executablePath = prebuiltPath;
    }
  }

  return executablePath;
}

const ENTRY_TEMPLATE = `import { createServer } from "/* __nextExpress_serverFileName__ */";

const server = createServer();
server.listen(/* __nextExpress_port__ */, () => {
  console.log("Server is listening on port", /* __nextExpress_port__ */);
});
`;
export function generateEntryFile(
  port: string,
  serverFileName: string,
  entryFileName: string,
  distDir: string,
) {
  logger.info("Start generate entry file");

  const entryContent = ENTRY_TEMPLATE.replace(
    "/* __nextExpress_serverFileName__ */",
    `./${serverFileName}`,
  ).replaceAll("/* __nextExpress_port__ */", port);
  writeFileSync(path.resolve(distDir, entryFileName), entryContent);

  logger.info(`Entry file generated successfully.`);
}

export function compileServer(
  srcDir: string,
  distDir: string,
  serverFileName: string,
) {
  const compilerExe = findCompilerExecutable();
  if (compilerExe.endsWith("js")) {
    logger.warn(
      "Can not find a native binary for the compiler." +
        " Fallback to TypeScript implementation." +
        " This is fine, but may result in slower performance.",
    );
  }
  logger.info(`Using compiler: ${compilerExe}`);

  spawnSync(
    compilerExe,
    ["--src-dir", srcDir, "--dist-dir", distDir, "--filename", serverFileName],
    { stdio: "inherit" },
  );
  logger.info(`Server file compiled successfully.`);
}
