import { logger } from "../src/env-logger";
import { getVersions, setVersions } from "./versions";
import { question } from "./question-cli";

async function main() {
  const args = process.argv.slice(2);
  let dryRun = false;
  if (args.includes("--dry-run")) {
    dryRun = true;
    logger.info("Dry run mode enabled");
  } else {
    logger.warn("Dry run mode is disabled");
  }

  const versions = await getVersions();
  logger.info("Current versions:");
  logger.info(`  - Main cli: ${versions.mainCli}`);
  logger.info(`  - Compiler cli typescript: ${versions.compilerTypescript}`);
  logger.info(`  - Compiler cli rust: ${versions.compilerRust}`);
  logger.info(
    `Post-install script will search tag name "${versions.RELEASE_TAG_NAME}"`,
  );
  const answer = await question("Please enter a new version: ");
  logger.info("Will bump all versions to", answer);
  setVersions(
    {
      mainCli: answer,
      compilerTypescript: answer,
      compilerRust: answer,
      RELEASE_TAG_NAME: answer,
    },
    { dryRun },
  );
}

main();
