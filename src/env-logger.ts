/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A logger that logs messages to the stderr using console.error
 *
 * Has level capabilities for rust env_logger crate.
 */

const ColorAsci = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  reset: "\x1b[0m",
};

class Color {
  static red(text: string) {
    return `${ColorAsci.red}${text}${ColorAsci.reset}`;
  }

  static green(text: string) {
    return `${ColorAsci.green}${text}${ColorAsci.reset}`;
  }

  static yellow(text: string) {
    return `${ColorAsci.yellow}${text}${ColorAsci.reset}`;
  }

  static blue(text: string) {
    return `${ColorAsci.blue}${text}${ColorAsci.reset}`;
  }

  static magenta(text: string) {
    return `${ColorAsci.magenta}${text}${ColorAsci.reset}`;
  }

  static cyan(text: string) {
    return `${ColorAsci.cyan}${text}${ColorAsci.reset}`;
  }

  static white(text: string) {
    return `${ColorAsci.white}${text}${ColorAsci.reset}`;
  }

  static reset(text: string) {
    return `${ColorAsci.reset}${text}${ColorAsci.reset}`;
  }
}

class LogLevel {
  static nameToLevel(name: string) {
    switch (name) {
      case "trace":
        return 0;
      case "debug":
        return 1;
      case "info":
        return 2;
      case "warn":
        return 3;
      case "error":
        return 4;
      default:
        return 2; // default to info level
    }
  }
}

export class EnvLogger {
  level: number;
  prefix?: string;

  constructor() {
    // Initialize the logger with the environment variable NEXP_LOG
    const env = process.env.NEXP_LOG || "info";
    this.level = LogLevel.nameToLevel(env);
  }

  private now() {
    return new Date().toISOString();
  }

  private makePrefix(level: string, color: (text: string) => string) {
    if (this.prefix) {
      return `[${this.now()} ${color(level)} ${this.prefix}]`;
    }
    return `[${this.now()} ${color(level)}]`;
  }

  trace(...args: any[]) {
    if (this.level <= 0) {
      console.error(this.makePrefix("TRACE", Color.white), ...args);
    }
  }

  debug(...args: any[]) {
    if (this.level <= 1) {
      console.error(this.makePrefix("DEBUG", Color.blue), ...args);
    }
  }

  info(...args: any[]) {
    if (this.level <= 2) {
      console.error(this.makePrefix("INFO", Color.green), ...args);
    }
  }

  warn(...args: any[]) {
    if (this.level <= 3) {
      console.error(this.makePrefix("WARN", Color.yellow), ...args);
    }
  }

  error(...args: any[]) {
    if (this.level <= 4) {
      console.error(this.makePrefix("ERROR", Color.red), ...args);
    }
  }
}

export const logger = new EnvLogger();
