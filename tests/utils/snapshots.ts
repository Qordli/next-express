import { existsSync, readFileSync } from "fs";
import path from "path";

const customSnapshotDir = "tests/__custom_snapshots__";

export const snapshotsPaths = {
  default: path.resolve(customSnapshotDir, "default-server.snap"),
  customServer: path.resolve(customSnapshotDir, "custom-server.snap"),
};

export const getSnapshotContent = (snapshotPath) => {
  if (!existsSync(snapshotPath)) {
    throw new Error(`Snapshot not found: ${snapshotPath}`);
  }
  return readFileSync(snapshotPath, "utf-8");
};
