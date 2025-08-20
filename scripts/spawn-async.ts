import { spawn, SpawnOptionsWithoutStdio } from "child_process";
import { logger } from "../src/env-logger";

export function spawnAsync(
  command: string,
  args: string[],
  prefix: string,
  opt?: SpawnOptionsWithoutStdio,
) {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "pipe",
      shell: true,
      ...opt,
    });

    child.stdout.on("data", (data) => {
      logger.debug(`[${prefix}] [stdout] ${data}`);
    });

    child.stderr.on("data", (data) => {
      logger.info(`[${prefix}] [stderr] ${data}`);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(code);
      } else {
        reject(new Error(`Process exited with code ${code}`));
      }
    });
  });
}
