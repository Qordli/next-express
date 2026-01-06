import https from "node:https";
import { pipeline } from "node:stream/promises";
import { URL } from "node:url";
import path from "node:path";
import { IncomingMessage } from "node:http";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";

function human(n: number) {
  if (!Number.isFinite(n)) return "未知";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(1)} ${units[i]}`;
}

function get(url: string, extraHeaders: https.RequestOptions["headers"] = {}) {
  const u = new URL(url);
  const options: https.RequestOptions = {
    protocol: u.protocol,
    hostname: u.hostname,
    path: u.pathname + u.search,
    headers: {
      Accept: "*/*",
      ...extraHeaders,
    },
  };
  return new Promise<IncomingMessage>((resolve, reject) => {
    const req = https.get(options, (res) => resolve(res));
    req.on("error", reject);
  });
}

export async function downloadWithRedirects(
  url: string,
  dest: string,
  { maxRedirects = 5, headers = {} } = {},
) {
  let current = url;
  let redirects = 0;

  while (true) {
    const res = await get(current, headers);

    // 跟随重定向
    if (!res.statusCode) {
      throw new Error("No response from server");
    }
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      if (redirects++ >= maxRedirects) {
        res.resume();
        throw new Error(`Too many redirects (>${maxRedirects})`);
      }
      // 支持相对重定向
      const next = new URL(res.headers.location, current).toString();
      res.resume();
      current = next;
      continue;
    }

    if (res.statusCode !== 200) {
      res.resume();
      throw new Error(
        `HTTP ${res.statusCode} ${res.statusMessage || ""} for ${current}`,
      );
    }

    // 进度
    const total = parseInt(res.headers["content-length"] || "", 10);
    let downloaded = 0;

    // 确保目录存在
    if (!existsSync(path.dirname(dest))) {
      mkdirSync(path.dirname(dest), { recursive: true });
    }
    const file = createWriteStream(dest);

    res.on("data", (chunk) => {
      downloaded += chunk.length;
      if (Number.isFinite(total)) {
        const percent = ((downloaded / total) * 100).toFixed(2);
        process.stdout.write(
          `\rDownloading... ${percent}% (${human(downloaded)}/${human(total)})`,
        );
      } else {
        process.stdout.write(`\rDownloading...: ${human(downloaded)}`);
      }
    });

    await pipeline(res, file);
    process.stdout.write("\nDownloading complete.\n");
    return { dest, total: Number.isFinite(total) ? total : downloaded };
  }
}
