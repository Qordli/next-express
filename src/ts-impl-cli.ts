#!/usr/bin/env node
import { EnvLogger } from "./env-logger";
import { compile } from "./ts-impl";
import { Cli, Command, Option } from "clipanion";
import { binaryVersion } from "./ts-impl-cli-ver";

const binaryName = "nexp-compiler-ts";
const logger = new EnvLogger();
logger.prefix = binaryName;

class VersionCommand extends Command {
  static paths = [["--version"], ["-v"]];

  async execute() {
    this.context.stdout.write(`${binaryName} ${cli.binaryVersion}\n`);
  }
}

class BuildCommand extends Command {
  static paths = [Command.Default];
  static usage = Command.Usage({
    description: "A compiler cli for next-express written in TypeScript.",
    examples: [
      ["Use defaults", binaryName],
      ["Custom output dir", `${binaryName} --dist-dir build`],
    ],
  });

  srcDir = Option.String("--src-dir", "src", {
    description: "Source directory",
  });

  distDir = Option.String("--dist-dir", "nexp-compiled", {
    description: "Output directory",
  });

  filename = Option.String("--filename", "server.ts", {
    description: "Entry filename",
  });

  async execute() {
    const startTime = performance.now();
    logger.info(
      `Compiling next-express from ${this.srcDir} to ${this.distDir}/${this.filename}`,
    );
    await compile(this.srcDir, this.distDir, this.filename);
    logger.info(
      `Compiling completed successfully in ${performance.now() - startTime}ms`,
    );
  }
}

const cli = new Cli({
  binaryLabel: "A compiler cli for next-express written in TypeScript.",
  binaryName,
  binaryVersion,
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const [node, app, ...args] = process.argv;
cli.register(VersionCommand);
cli.register(BuildCommand);
cli.runExit(args);
