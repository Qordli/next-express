# next-express

一个受 Next.js 启发的 Express 文件系统路由编译器。将 `src/` 下的约定式目录结构编译为一个可直接启动的 Express 服务器入口，从而快速获得：

- 约定式 `app` 目录 + `route.(ts|js)` API 路由
- 逐层继承的中间件 (`middlewares.(ts|js)` / `tail-middlewares.(ts|js)`)
- 全局 `settings.(ts|js)` (批量调用 `app.set`)
- 自定义服务端入口（可选 `custom-server.(ts|js)`）
- 开发模式实时 watch + 自动重编译 + 热启动
- 生产模式打包（基于 tsup，目标 Node 22，ESM）

> 本仓库同时提供 Rust 实现的二进制（性能更好）以及 TypeScript 纯实现回退。主 CLI 名称：`next-express`；TS 回退编译器 CLI：`nexp-compiler-ts`。

## 安装

```bash
# 或者你可以使用任何你喜欢的包管理器
pnpm add -D next-express ts-morph tsup chokidar
pnpm add express
```

## 基本概念与目录约定

```
nexp-compiled/
	server.ts               # (编译产物) createServer 实现 (默认编译输出)
	index.ts                # (编译产物) 启动脚本 (监听端口等)
src/
	app/
		user/
			route.ts            # /user
			middlewares.ts      # 作用于 user/ 及其子层所有路由 (进入 user/ 子树后最先执行)
		health/
			route.ts            # /health
		(group)/
			stats/
				route.ts          # /stats  （括号包裹目录属于“虚拟分组”，不会出现在最终路径中）
		route.ts              # /        (根路由)
	middlewares.ts          # 顶层全局中间件 (app.use(...))
	tail-middlewares.ts     # 尾部中间件/兜底处理 (如 404、错误收集)
	settings.ts             # 导出配置数组, 用于 app.set
	custom-server.ts        # (可选) 自定义 createServer/启动逻辑，存在时直接拷贝使用
```

### 文件说明

| 文件/模式                     | 作用                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `app/**/route.(ts\|js)`       | 定义一个 API 路由，导出 HTTP 方法函数 (GET/POST/PUT/DELETE/PATCH/OPTIONS/HEAD 等)。                           |
| `app/**/middlewares.(ts\|js)` | 导出数组：[`(req,res,next)=>{}`\|`(err,req,res,next)=>{}`]，对该目录与子目录所有路由生效，形成分层子 Router。 |
| `middlewares.(ts\|js)`        | 顶层全局中间件数组。                                                                                          |
| `tail-middlewares.(ts\|js)`   | 顶层尾部中间件/404/错误处理。                                                                                 |
| `settings.(ts\|js)`           | 导出形如：`export const settings = [{ name: 'trust proxy', value: true }]`。                                  |
| `custom-server.(ts\|js)`      | 若存在，则使用该文件生成代码（需自行导出 `createServer` 函数）。                                              |

### 路由导出约定

在 `route.ts` 中导出 HTTP 方法（方法名大小写敏感，与 Express 对应）：

```ts
// src/app/user/route.ts
export const GET = async (req, res) => {
	res.json({ user: 'alice' });
};

export const POST = async (req, res) => {
	res.status(201).send('created');
};
```

若一个方法未导出，请求将返回 `405 Method Not Allowed`。

### 虚拟分组目录

以括号包裹命名的目录 `(group)` 仅用于逻辑分组，不参与实际 URL。`src/app/(internal)/logs/route.ts` 将对应 `/logs`。

## CLI 使用 (`next-express`)

编译器会生成：

- `nexp-compiled/server.ts` （或自定义 server 文件名）
- `.next-express/index.js` （构建/开发最终执行入口）

### 命令总览

| 命令           | 说明                                               | 典型场景       |
| -------------- | -------------------------------------------------- | -------------- |
| `dev`          | 开发模式：watch 编译 + 自动启动 Node 进程          | 本地开发       |
| `compile`      | 仅生成编译产物 (不打包、不压缩)                    | 调试、二次加工 |
| `build`        | 生成编译产物并用 tsup 打包、压缩到 `.next-express` | 生产部署       |
| `-v/--version` | 查看版本                                           | ——             |

### 通用参数

| 参数            | 默认            | 说明                                      |
| --------------- | --------------- | ----------------------------------------- |
| `--src-dir`     | `src`           | 源码目录                                  |
| `--dist-dir`    | `nexp-compiled` | 中间编译输出目录（server 模板）           |
| `--server`      | `server.ts`     | 生成的 server 文件名（包含 createServer） |
| `--entry`       | `index.ts`      | 生成的入口启动文件名（会监听端口）        |
| `--port` / `-p` | `3000`          | 启动端口（写入入口文件）                  |

`dev` 额外参数：

| 参数      | 默认      | 说明                  |
| --------- | --------- | --------------------- |
| `--watch` | `['src']` | 监听变更目录/文件列表 |

### 典型流程

```bash
# 开发
npx next-express dev -p 4000

# 仅编译（生成 nexp-compiled/server.ts nexp-compiled/index.ts）
npx next-express compile

# 生产构建（输出 .next-express/index.js，可直接 node 运行）
npx next-express build

# 运行打包后产物
node .next-express/index.js
```

### 开发模式说明

`dev` 模式内部：

1. 调用编译逻辑（扫描目录 + 生成 server 模板 + 入口文件）。
2. 启动 tsup watch，对生成入口进行打包输出到 `.next-express`。
3. 编译成功后执行 `node .next-express/index.js`。
4. 文件改动 → 重复 1-3，达到近似热重载体验。

## 输出模板示意

生成的 `server.ts` 类似：

```ts
import express from 'express';
// 动态插入的 imports...

export const createServer = () => {
	const app = express();
	// settings, middlewares, routes, tail-middlewares 注入
	return app;
};
```

生成的入口（`index.ts`）会：

```ts
import { createServer } from './server';

const app = createServer();
app.listen("<port>", () => {
	console.log('Server is listening on <port>');
});
```

## 自定义 server

在 `src/` 直接放置 `custom-server.ts`（或 `.js`）即可

注意其中必须包含以下魔法注释，会在编译时被替换为真实代码
- `/* __nextExpress_imports__ */`
- `/* __nextExpress_settings__ */`
- `/* __nextExpress_topLevelMiddlewares__ */`
- `/* __nextExpress_routes__ */`
- `/* __nextExpress_tailMiddlewares__ */`

例如你想挂载 socket.io 服务器：
```ts
import express from "express";
import { Server as SioServer } from "socket.io";
import { createServer as CreateHttpServer } from "http";
/* __nextExpress_imports__ */

export const createServer = () => {
  const app = express();

  /* __nextExpress_settings__ */

  const server = CreateHttpServer(app);
  const io = new SioServer(server);
  io.on("connection", (socket) => {
    console.log("New socket connection:", socket.id);
  });

  /* __nextExpress_topLevelMiddlewares__ */

  /* __nextExpress_routes__ */

  /* __nextExpress_tailMiddlewares__ */
  return app;
};
```

存在该文件时，编译流程会直接使用它作为模板文件。

## Method Not Allowed 处理

若访问的路由未实现当前 HTTP 方法，会自动返回：

```
405 Method <METHOD> Not Allowed
```

（内部代码：```res.status(405).send(`Method ${req.method} Not Allowed`)```）。

## 常见问题 (FAQ)

### 1. 为什么我的目录不生效？
- 确保在 `src/app/` 下。
- 只识别 `route.(ts|js)` 作为终端路由文件。
- 虚拟分组必须使用括号包裹整个目录名，如 `(auth)`。

### 2. 中间件执行顺序？
1. 顶层 `middlewares.ts`
2. 分层目录 `app/**/middlewares.ts`（由外到内）
3. 路由处理函数（GET/POST...）
4. 顶层 `tail-middlewares.ts`

### 3. 如何添加 404？
在 `tail-middlewares.ts` 最后添加：

```ts
export const middlewares = [
	(req, res) => res.status(404).send('Not Found')
];
```

### 4. 如果添加全局错误处理？

### 5. 如何扩展生成逻辑？
- 使用 `custom-server.ts` 完全接管生成
- 引用生成后的 `server.ts` 文件自定义入口文件

## 许可证

MIT
