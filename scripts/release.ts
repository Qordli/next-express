import { Cli, Command, Option } from "clipanion";
import { existsSync } from "fs";
import path from "path";
import { EnvLogger } from "../src/env-logger";
import pkgJson from "../package.json";
import { question } from "./question-cli";
import { spawnAsync } from "./spawn-async";

const logger = new EnvLogger();
logger.prefix = "release-script";

function makeNotes(ver: string) {
  return (
    `[ next-express ${ver} release ]` +
    "\nThis release is for npm post-install." +
    "\nOnly include the src code and rust-impl compiler pre-build binaries." +
    "\nPlease install next-express following the documentation."
  );
}

class ReleaseCmd extends Command {
  static paths = [Command.Default];
  static usage = Command.Usage({
    description: "Create a github release and attach binaries automatically.",
    examples: [
      ["Create a release", "... --title 'My Release' --notes 'Release notes'"],
    ],
  });

  title = Option.String("--title,-t", {
    required: false,
  });

  notes = Option.String("--notes,-n", {
    required: false,
  });

  async execute() {
    logger.info("Starting...");

    const macos_universal_path = path.resolve(
      "rust-dist",
      "nexp-compiler-rs-macos-universal",
    );
    if (!existsSync(macos_universal_path)) {
      throw new Error("macOS universal binary not found");
    }

    const x64_linux_path = path.resolve(
      "rust-dist",
      "nexp-compiler-rs-x86_64-unknown-linux-gnu",
    );
    if (!existsSync(x64_linux_path)) {
      throw new Error("x86_64-unknown-linux-gnu binary not found");
    }

    const x64_win_path = path.resolve(
      "rust-dist",
      "nexp-compiler-rs-x86_64-pc-windows-gnu.exe",
    );
    if (!existsSync(x64_win_path)) {
      throw new Error("x86_64-pc-windows-gnu binary not found");
    }

    const tagName = `v${pkgJson.version}`;
    const releaseTitle = this.title || tagName;
    const releaseNotes = this.notes || makeNotes(tagName);
    logger.info(`All binaries found, create release for ${tagName}.`);
    logger.info(`Release title: ${releaseTitle}`);
    logger.info(`Release notes:\n${releaseNotes}`);
    logger.info("");
    const answer = await question("Type 'yes' or 'y' to continue: ");
    if (answer !== "yes" && answer !== "y") {
      logger.info("Aborting release.");
      return;
    }

    logger.info("Creating release...");
    try {
      await spawnAsync(
        "gh",
        [
          "release",
          "create",
          tagName,
          macos_universal_path,
          x64_linux_path,
          x64_win_path,
          "--title",
          releaseTitle,
          "--notes",
          releaseNotes,
        ],
        "create-release-use-gh",
      );
    } catch (error) {
      logger.error("Failed to create release:", error);
      throw error;
    }
    logger.info("Release created successfully.");
  }
}

const cli = new Cli();
cli.register(ReleaseCmd);
cli.runExit(process.argv.slice(2));
