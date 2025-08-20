#!/usr/bin/env node
import { Cli, Command, Option } from "clipanion";
import { logger } from "./env-logger";
import pkgJson from "../package.json";
import { compileServer, generateEntryFile } from "./build";
import { build, Options as TsupOptions } from "tsup";
import { watchBuild } from "./tsup-watch";
import path from "node:path";
import { readFileSync } from "node:fs";

const binaryName = pkgJson.name;
logger.prefix = binaryName;

const tsupConfig: (
  params: { compilerDistDir?: string } & TsupOptions,
) => TsupOptions = ({ compilerDistDir = "nexp-compiled", ...rest }) => {
  return {
    config: false,
    entry: [`${compilerDistDir}/index.ts`],
    target: "node22",
    format: ["esm"],
    clean: true,
    outDir: ".next-express",
    ...rest,
  };
};

class VersionCommand extends Command {
  static paths = [["--version"], ["-v"]];

  async execute() {
    this.context.stdout.write(`${binaryName} ${cli.binaryVersion}\n`);
  }
}

abstract class BaseCommand extends Command {
  srcDir = Option.String("--src-dir", "src", {
    description: "Source directory",
  });

  distDir = Option.String("--dist-dir", "nexp-compiled", {
    description: "Output directory",
  });

  server = Option.String("--server", "server.ts", {
    description: "Server filename",
  });

  entry = Option.String("--entry", "index.ts", {
    description: "Entry filename",
  });

  port = Option.String("--port,-p", "3000", {
    description: "Port to run the server",
  });
}

class DevCommand extends BaseCommand {
  static paths = [["dev"]];
  static usage = Command.Usage({
    description: "Run the development server",
    examples: [
      ["Use defaults", `${binaryName} dev`],
      ["Custom port", `${binaryName} dev -p 4000`],
      ["Custom output dir", `${binaryName} dev --dist-dir build`],
    ],
  });

  watch = Option.Array("--watch", ["src"], {
    description: "Watch files for changes",
  });

  private beforeBuild() {
    compileServer(this.srcDir, this.distDir, this.server);
    generateEntryFile(this.port, this.server, this.entry, this.distDir);
  }

  async execute() {
    const startTime = performance.now();

    const userPkgJsonPath = path.resolve("package.json");
    const userPkgJson = JSON.parse(readFileSync(userPkgJsonPath, "utf-8"));
    const pkgType = userPkgJson.type as string | undefined;
    let entryFileExt = ".js";
    if (pkgType !== "module") {
      entryFileExt = ".mjs";
    }

    watchBuild({
      beforeBuild: () => this.beforeBuild(),
      watchPaths: this.watch,
      onSuccessCall: `node .next-express/index${entryFileExt}`,
      ...tsupConfig({
        compilerDistDir: this.distDir,
      }),
    });

    logger.info(`Build completed in ${performance.now() - startTime}ms.`);
  }
}

class CompileCommand extends BaseCommand {
  static paths = [["compile"]];
  static usage = Command.Usage({
    description: "Compile the source code",
    examples: [
      ["Use defaults", `${binaryName} compile`],
      ["Custom output dir", `${binaryName} compile --dist-dir build`],
    ],
  });

  async execute() {
    const startTime = performance.now();

    compileServer(this.srcDir, this.distDir, this.server);
    generateEntryFile(this.port, this.server, this.entry, this.distDir);

    logger.info(`Compiling completed in ${performance.now() - startTime}ms.`);
  }
}

class BuildCommand extends BaseCommand {
  static paths = [["build"]];
  static usage = Command.Usage({
    description: "Build the project",
    examples: [
      ["Use defaults", `${binaryName} build`],
      ["Custom output dir", `${binaryName} build --dist-dir build`],
    ],
  });

  async execute() {
    const startTime = performance.now();

    compileServer(this.srcDir, this.distDir, this.server);
    generateEntryFile(this.port, this.server, this.entry, this.distDir);
    await build(
      tsupConfig({
        compilerDistDir: this.distDir,
        minify: true,
      }),
    );

    logger.info(`Build completed in ${performance.now() - startTime}ms.`);
  }
}

const cli = new Cli({
  binaryLabel: "A Next.js like file-based routing compiler",
  binaryName,
  binaryVersion: pkgJson.version,
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const [node, app, ...args] = process.argv;
cli.register(VersionCommand);
cli.register(DevCommand);
cli.register(CompileCommand);
cli.register(BuildCommand);
cli.runExit(args);
