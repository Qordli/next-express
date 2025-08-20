/**
 * Because tsup's watchIgnore option forces ignore .git and node_modules,
 * we need to implement our own file watching.
 */

import { build, type Options } from "tsup";
import chokidar from "chokidar";
import { spawn, ChildProcess } from "child_process";
import { EnvLogger } from "./env-logger";

const logger = new EnvLogger();
logger.prefix = "nexp-tsup-watch";

type OnSuccess = (() => void | Promise<void>) | string;

type WatchBuildOptions = Options & {
  watchPaths: string | string[];
  // Use different name to avoid conflict with tsup's onSuccess option
  onSuccessCall: OnSuccess;
  beforeBuild?: () => void | Promise<void>;
  debounceMs?: number; // 触发抖动时间，默认 100ms
};

export function watchBuild(opts: WatchBuildOptions) {
  const {
    watchPaths,
    onSuccessCall,
    beforeBuild,
    debounceMs = 100,
    ...tsupOptions
  } = opts;
  if (tsupOptions.watch) {
    throw new Error(
      "Please do not pass the tsup's watch option" +
        " when using next-express watchBuild." +
        " Use watchPaths instead.",
    );
  }

  let pending = false;
  let building = false;
  let timer: NodeJS.Timeout | null = null;
  let child: ChildProcess | null = null;

  const runOnSuccess = async () => {
    if (!onSuccessCall) return;

    if (typeof onSuccessCall === "function") {
      await onSuccessCall();
      return;
    }

    // If onSuccessCall is a command string: kill the previous process and restart
    if (child && !child.killed) {
      child.kill(process.platform === "win32" ? undefined : "SIGTERM");
    }

    const [cmd, ...args] = onSuccessCall.split(" ");
    child = spawn(cmd, args, { stdio: "inherit", shell: true });
    child.on("exit", (code, signal) => {
      if (code != null) {
        logger.info(`[onSuccess] process exited with code ${code}`);
      } else {
        logger.info(`[onSuccess] process exited (signal: ${signal})`);
      }
    });
  };

  const runBuildOnce = async () => {
    building = true;
    try {
      beforeBuild?.();
      await build({
        ...tsupOptions,
      });
      await runOnSuccess();
    } catch (err) {
      // If build fails: do not trigger onSuccess, just log the error
      logger.error("build failed:", err);
    } finally {
      building = false;
      // If there are new changes while building, run it again after finishing
      if (pending) {
        pending = false;
        scheduleBuild();
      }
    }
  };

  const scheduleBuild = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (building) {
        // If building, mark as pending
        // This will affect re-building after the current build finishes
        pending = true;
      } else {
        runBuildOnce();
      }
    }, debounceMs);
  };

  // Run once immediately
  runBuildOnce();

  // Start watching
  const watcher = chokidar.watch(watchPaths, {
    ignoreInitial: true,
  });

  watcher.on("all", () => {
    scheduleBuild();
  });

  const close = async () => {
    await watcher.close();
    if (child && !child.killed) {
      child.kill(process.platform === "win32" ? undefined : "SIGTERM");
    }
  };

  return { close };
}
