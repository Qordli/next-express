import path from "path";
import fs from "fs";
import {
  parse as parseToml,
  TomlTable,
  stringify as stringifyToml,
} from "smol-toml";
import pkgJson from "../package.json";
import { binaryVersion as tsImplCompilerVer } from "../src/ts-impl-cli-ver";
import { RELEASE_TAG_NAME } from "../src/post-install/release-tag-name";
import { logger } from "../src/env-logger";

export type Versions = {
  mainCli: string;
  compilerTypescript: string;
  compilerRust: string;
  RELEASE_TAG_NAME: string;
};
export async function getVersions() {
  const result: Versions = {
    mainCli: "",
    compilerTypescript: "",
    compilerRust: "",
    RELEASE_TAG_NAME,
  };

  const cargoTomlPath = path.resolve("src-rust", "Cargo.toml");
  const cargoTomlContent = parseToml(fs.readFileSync(cargoTomlPath, "utf-8"));
  const rustImplCompilerVer = (cargoTomlContent.package as TomlTable).version;

  result.mainCli = pkgJson.version;
  result.compilerTypescript = tsImplCompilerVer;
  result.compilerRust = String(rustImplCompilerVer);

  return result;
}

async function isProjectRoot() {
  const packageJsonPath = path.resolve("package.json");
  const packageJsonContent = fs.readFileSync(packageJsonPath, "utf-8");
  const packageJson = JSON.parse(packageJsonContent);
  return packageJson.name === "@qordli/next-express";
}

export async function setVersions(
  versions: Versions,
  { dryRun }: { dryRun: boolean },
) {
  if (!(await isProjectRoot())) {
    throw new Error("This script must be run from the project root directory");
  }

  const packageJsonPath = path.resolve("package.json");
  const packageJsonContent = fs.readFileSync(packageJsonPath, "utf-8");
  const packageJson = JSON.parse(packageJsonContent);
  packageJson.version = versions.mainCli;
  if (dryRun) {
    logger.debug(
      `Will update package.json:\n${JSON.stringify(packageJson, null, 2)}`,
    );
  } else {
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
  }

  const tsImplCompilerVerFilePath = path.resolve("src", "ts-impl-cli-ver.ts");
  const tsImplCompilerVerFileContent = `export const binaryVersion = "${versions.compilerTypescript}";\n`;
  if (dryRun) {
    logger.debug(`Will update version.ts:\n${tsImplCompilerVerFileContent}`);
  } else {
    fs.writeFileSync(tsImplCompilerVerFilePath, tsImplCompilerVerFileContent);
  }

  const cargoTomlPath = path.resolve("src-rust", "Cargo.toml");
  const cargoTomlContent = parseToml(fs.readFileSync(cargoTomlPath, "utf-8"));
  const cargoTomlPackage = cargoTomlContent.package as TomlTable;
  cargoTomlPackage.version = versions.compilerRust;
  if (dryRun) {
    logger.debug(`Will update Cargo.toml:\n${stringifyToml(cargoTomlContent)}`);
  } else {
    fs.writeFileSync(cargoTomlPath, stringifyToml(cargoTomlContent));
  }

  const releaseTagFilePath = path.resolve(
    "src",
    "post-install",
    "release-tag-name.ts",
  );
  const releaseTagContent = `export const RELEASE_TAG_NAME = "v${versions.mainCli}";\n`;
  if (dryRun) {
    logger.debug(`Will update RELEASE_TAG:\n${releaseTagContent}`);
  } else {
    fs.writeFileSync(releaseTagFilePath, releaseTagContent);
  }
}
