import path from "path";

const cliCmds = {
  ts: {
    default: (filename = "server-ts.ts") =>
      [
        "pnpm",
        "dlx",
        "tsx",
        path.resolve(process.cwd(), "src", "ts-impl-cli.ts"),
        "--src-dir",
        path.resolve(process.cwd(), "tests", "__test_src__"),
        "--dist-dir",
        path.resolve(process.cwd(), "tests", "dist"),
        "--filename",
        filename,
      ].join(" "),
    customServer: (filename = "custom-server-ts.ts") =>
      [
        "pnpm",
        "dlx",
        "tsx",
        path.resolve(process.cwd(), "src", "ts-impl-cli.ts"),
        "--src-dir",
        path.resolve(process.cwd(), "tests", "__test_src_custom_server__"),
        "--dist-dir",
        path.resolve(process.cwd(), "tests", "dist"),
        "--filename",
        filename,
      ].join(" "),
  },
  rs: {
    default: (filename = "server-rs.ts") =>
      [
        "cargo",
        "run",
        "--",
        "--src-dir",
        path.resolve(process.cwd(), "tests", "__test_src__"),
        "--dist-dir",
        path.resolve(process.cwd(), "tests", "dist"),
        "--filename",
        filename,
      ].join(" "),
    customServer: (filename = "custom-server-rs.ts") =>
      [
        "cargo",
        "run",
        "--",
        "--src-dir",
        path.resolve(process.cwd(), "tests", "__test_src_custom_server__"),
        "--dist-dir",
        path.resolve(process.cwd(), "tests", "dist"),
        "--filename",
        filename,
      ].join(" "),
  },
};

export default cliCmds;
