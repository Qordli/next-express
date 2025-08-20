# next-express

Read this in other languages: [中文](./README.zh.md)

An Express file‑system routing compiler inspired by Next.js. It scans a
convention-based directory tree under `src/` and compiles it into a ready‑to‑run
Express server entry so you can quickly get:

- Conventional `app` directory + `route.(ts|js)` API routes
- Hierarchical middlewares (`middlewares.(ts|js)` / `tail-middlewares.(ts|js)`)
- Global `settings.(ts|js)` (batch `app.set` calls)
- Optional custom server entry (`custom-server.(ts|js)`)
- Dev mode: watch + incremental recompile + hot restart
- Prod mode: bundle (tsup, target Node 22, ESM)
> This repo ships both a high‑performance Rust binary and a pure TypeScript
> fallback. Main CLI name: `next-express`; TS fallback compiler CLI: `nexp-compiler-ts`.

## Installation

```bash
# Or use any package manager you like
pnpm add -D next-express ts-morph tsup chokidar
pnpm add express
## Core Concepts & Directory Conventions
```

## Convention

```
nexp-compiled/
	server.ts               # (generated) createServer implementation (default output)
	index.ts                # (generated) startup script (listen etc.)
src/
	app/
		user/
			middlewares.ts      # affects user/ subtree (runs first after entering this subtree)
		health/
			route.ts            # /health
		(group)/
			stats/
				route.ts          # /stats (parenthesized dir is a “virtual group”, not in URL)
		route.ts              # / (root route)
	middlewares.ts          # top‑level global middlewares (app.use(...))
	tail-middlewares.ts     # tail / 404 / error middlewares
	settings.ts             # exports app.set configs
	custom-server.ts        # (optional) custom createServer/start logic copied verbatim
```

### File Overview

| File / Pattern                | Purpose                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| `app/**/route.(ts\|js)`       | Defines an API route. Export HTTP method handlers (GET/POST/PUT/DELETE/PATCH/OPTIONS/HEAD etc).      |
| `app/**/middlewares.(ts\|js)` | Export array: [`(req,res,next)=>{}` or `(err,req,res,next)=>{}`]; applies to that dir + descendants. |
| `middlewares.(ts\|js)`        | Top‑level global middleware array.                                                                   |
| `tail-middlewares.(ts\|js)`   | Top‑level tail / 404 / error middleware array.                                                       |
| `settings.(ts\|js)`           | Export: `export const settings = [{ name: 'trust proxy', value: true }]`.                            |
| `custom-server.(ts\|js)`      | If present, used directly as template (must export `createServer`).                                  |

### Route Exports

Export HTTP method functions inside `route.ts` (case sensitive, matching Express):

```ts
// src/app/user/route.ts
export const GET = async (req, res) => {
	res.json({ user: 'alice' });
};

export const POST = async (req, res) => {
	res.status(201).send('created');
};

```
If a method isn't exported, requests for that method respond with `405 Method Not Allowed`.

### Virtual Group Directories
Directories wrapped in parentheses (e.g. `(group)`) exist only for organization and are removed from the URL.
`src/app/(internal)/logs/route.ts` becomes `/logs`.

## CLI (`next-express`)
The compiler generates:

- `nexp-compiled/server.ts` (or custom server file name)
- `.next-express/index.js` (final executable entry in build/dev)

### Commands

| Command        | Description                                      | Typical Use       |
| -------------- | ------------------------------------------------ | ----------------- |
| `dev`          | Dev: watch compile + auto (re)start Node process | Local development |
| `compile`      | Generate artifacts only (no bundle/minify)       | Debug / post-proc |
| `build`        | Generate then bundle & minify to `.next-express` | Production deploy |
| `-v/--version` | Show version                                     | —                 |

### Common Flags

| Flag            | Default         | Description                                       |
| --------------- | --------------- | ------------------------------------------------- |
| `--src-dir`     | `src`           | Source directory                                  |
| `--dist-dir`    | `nexp-compiled` | Intermediate compilation output (server template) |
| `--server`      | `server.ts`     | Generated server file name (exports createServer) |
| `--entry`       | `index.ts`      | Generated startup entry (listens on port)         |
| `--port` / `-p` | `3000`          | Port to listen (written into entry file)          |

Extra for `dev`:

| Flag      | Default   | Description                            |
| --------- | --------- | -------------------------------------- |
| `--watch` | `['src']` | Directories/files to watch for changes |

### Typical Flow

```bash
# Development
npx next-express dev -p 4000

# Compile only (produce nexp-compiled/server.ts & nexp-compiled/index.ts)
npx next-express compile

# Production build (outputs .next-express/index.js)
npx next-express build

# Run bundled output
node .next-express/index.js
```

### Dev Mode Internals

1. Run compile (scan + generate server template + entry).
2. Start tsup in watch to bundle entry to `.next-express`.
3. After success, execute `node .next-express/index.js`.
4. On file change → repeat 1–3 (semi hot-reload experience).

## Output Templates

Generated `server.ts` looks like:

```ts
import express from 'express';
// dynamically inserted imports...

export const createServer = () => {
	const app = express();
	// settings, middlewares, routes, tail-middlewares injected
	return app;
};
```

Generated entry (`index.ts`):

```ts
import { createServer } from './server';

const app = createServer();
app.listen('<port>', () => {
	console.log('Server is listening on <port>');
});
```

## Custom Server

Place `custom-server.ts` (or `.js`) directly under `src/`.

Required magic comments (will be replaced during compile):

- `/* __nextExpress_imports__ */`
- `/* __nextExpress_settings__ */`
- `/* __nextExpress_topLevelMiddlewares__ */`
- `/* __nextExpress_routes__ */`
- `/* __nextExpress_tailMiddlewares__ */`

Example adding socket.io:

```ts
import express from 'express';
import { Server as SioServer } from 'socket.io';
import { createServer as CreateHttpServer } from 'http';
/* __nextExpress_imports__ */

export const createServer = () => {
	const app = express();

	/* __nextExpress_settings__ */

	const server = CreateHttpServer(app);
	const io = new SioServer(server);
	io.on('connection', socket => {
		console.log('New socket connection:', socket.id);
	});

	/* __nextExpress_topLevelMiddlewares__ */

	/* __nextExpress_routes__ */

	/* __nextExpress_tailMiddlewares__ */
	return app;
};
```

If present, this file is copied and filled as the template.

## Method Not Allowed Handling

If a route does not implement an HTTP method, responses return:

```
405 Method <METHOD> Not Allowed
```

Implementation snippet:

```ts
res.status(405).send(`Method ${req.method} Not Allowed`);
```

## FAQ

### 1. Why doesn't my directory work?
* Ensure it lives under `src/app/`.
* Only `route.(ts|js)` files define terminal routes.
* Virtual groups must wrap the entire directory name: `(auth)` not `auth()`.

### 2. Middleware execution order?
1. Top‑level `middlewares.ts`
2. Nested `app/**/middlewares.ts` (outer → inner)
3. Route handler (GET/POST ...)
4. Top‑level `tail-middlewares.ts`

### 3. How do I add a 404?

In `tail-middlewares.ts` last element:

```ts
export const middlewares = [
	(req, res) => res.status(404).send('Not Found')
];
```

### 4. How to add global error handling?
Add an error middleware (four args) in `tail-middlewares.ts` after non-error handlers:

```ts
export const middlewares = [
	// ... other tail middlewares / 404
	(err, req, res, next) => {
		console.error(err);
		res.status(500).send('Internal Server Error');
	}
];
```

### 5. How do I extend generation logic?
* Provide `custom-server.ts` to fully take over.
* Or import generated `server.ts` in your own custom entry and layer extra logic.

## License

MIT
