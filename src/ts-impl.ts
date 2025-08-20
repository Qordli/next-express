/*
 * TypeScript implementation of the next-express compiler.
 *
 * Fully compatible with the Rust implementation.
 * Provided as a fallback for platforms without prebuilt binaries.
 */

import fs from "fs";
import path from "path";
import {
  Project,
  ts,
  ExportedDeclarations,
  FunctionDeclaration,
  VariableDeclaration,
  Expression,
  ArrowFunction,
} from "ts-morph";
import { EnvLogger } from "./env-logger";

const logger = new EnvLogger();
logger.prefix = "nexp-compiler-ts";

const SERVER_TEMPLATE = `import express from "express";
/* __nextExpress_imports__ */

export const createServer = () => {
  const app = express();

  /* __nextExpress_settings__ */

  /* __nextExpress_topLevelMiddlewares__ */

  /* __nextExpress_routes__ */

  /* __nextExpress_tailMiddlewares__ */
  return app;
};
`;

type SubRouter = {
  identifier: string;
  path: string;
};
type AppRoute = {
  name: string;
  relativePath: string;
  route?: string;
  middlewares?: string;
  children: AppRoute[];

  // runtime properties
  subRouter?: SubRouter;
  parent?: AppRoute; // to find nearest router
};
type AppStruct = {
  cwd: string;
  srcDir: string;
  distToSrcRelPath: string;
  app: AppRoute;
  topLevelMiddlewares?: string;
  tailMiddlewares?: string;
  settings?: string;
};

// eslint-disable-next-line prefer-const
let Convention = {
  // template
  serverTemplate: SERVER_TEMPLATE,

  // routes
  appDirName: "app",
  supportExt: [".ts", ".js"],
  routeFileBasename: "route",
  middlewaresFileBasename: "middlewares",
  tailMiddlewaresFileBasename: "tail-middlewares",
  settingsFileBasename: "settings",
  customServerBasename: "custom-server",

  // exports
  settingsExportName: "settings",
  middlewaresExportName: "middlewares",
  tailMiddlewaresExportName: "middlewares",
};

// eslint-disable-next-line prefer-const
let Config = {
  methodNotAllowedRes:
    "res.status(405).send(`Method ${req.method} Not Allowed`);",
};

function getConventionFilenames(basename: string): string[] {
  return Convention.supportExt.map((ext) => `${basename}${ext}`);
}

function routeNameToIdentifier(name: string): string {
  name = name.trim().replaceAll("-", "_");
  if (name.startsWith("(") && name.endsWith(")")) {
    throw new Error("Virtual group should not be used as a route name");
  }
  return name;
}

function uniqueRouteHandlerAlias(appRoute: AppRoute) {
  return appRoute.relativePath
    .replaceAll("/", "_")
    .replaceAll(".", "_")
    .replaceAll("-", "_")
    .replaceAll("(", "")
    .replaceAll(")", "");
}

function findAppRouteRecursive(
  appRoutes: AppRoute[],
  relativePath: string,
): AppRoute | undefined {
  for (const route of appRoutes) {
    if (route.relativePath === relativePath) {
      return route;
    }
    const childRoute = findAppRouteRecursive(route.children, relativePath);
    if (childRoute) {
      return childRoute;
    }
  }
  return undefined;
}

function getAppStruct(srcDir: string, distDir: string): AppStruct {
  const srcPath = path.resolve(srcDir);
  const distPath = path.resolve(distDir);

  logger.debug(`Starting to analyze app structure from srcDir: ${srcPath}`);
  logger.debug(`Canonicalized paths - src: ${srcPath}, dist: ${distPath}`);

  const appStruct: AppStruct = {
    cwd: process.cwd(),
    srcDir,
    distToSrcRelPath: path.relative(distPath, srcPath),
    app: {
      name: "app",
      relativePath: "app",
      children: [],
    },
  };

  logger.info(`Scanning directory structure in: ${srcPath}`);
  let fileCount = 0;
  let dirCount = 0;

  function traverseDirectory(absDirPath: string) {
    const entries = fs.readdirSync(absDirPath, { withFileTypes: true });

    for (const entry of entries) {
      const parentPath = absDirPath;
      const parentRelPathFromSrc = path.relative(srcPath, parentPath);
      const absPath = path.join(absDirPath, entry.name);
      const relPathFromSrc = path.relative(srcPath, absPath);

      const isInsideAppDir = relPathFromSrc.startsWith(Convention.appDirName);
      const isDirectChildrenOfAppDir =
        parentPath === path.join(srcPath, Convention.appDirName);

      if (entry.isDirectory()) {
        dirCount++;
        logger.debug(`Found directory: ${relPathFromSrc}`);

        if (isDirectChildrenOfAppDir) {
          appStruct.app.children.push({
            name: entry.name,
            relativePath: relPathFromSrc,
            children: [],
          });
        } else if (isInsideAppDir) {
          const appRoute = findAppRouteRecursive(
            appStruct.app.children,
            parentRelPathFromSrc,
          );
          if (appRoute) {
            // If the route already exists, we can update its children
            appRoute.children.push({
              name: entry.name,
              relativePath: relPathFromSrc,
              children: [],
            });
          }
        }

        traverseDirectory(absPath);
      } else {
        // else entry is not a directory
        fileCount++;
        logger.debug(`Processing file: ${relPathFromSrc}`);

        const routeNames = getConventionFilenames(Convention.routeFileBasename);
        const middlewareNames = getConventionFilenames(
          Convention.middlewaresFileBasename,
        );

        // handle top-level files, e.g. src/middlewares.ts
        const topLevelMiddlewares = middlewareNames.find(
          (filename) => filename === relPathFromSrc,
        );
        if (topLevelMiddlewares) {
          logger.info(`Found top-level middleware file: ${relPathFromSrc}`);
          appStruct.topLevelMiddlewares = topLevelMiddlewares;
        }

        const tailMiddlewares = getConventionFilenames(
          Convention.tailMiddlewaresFileBasename,
        ).find((filename) => filename === relPathFromSrc);
        if (tailMiddlewares) {
          logger.info(`Found tail middlewares file: ${relPathFromSrc}`);
          appStruct.tailMiddlewares = tailMiddlewares;
        }

        const settings = getConventionFilenames(
          Convention.settingsFileBasename,
        ).find((filename) => filename === relPathFromSrc);
        if (settings) {
          logger.info(`Found settings file: ${relPathFromSrc}`);
          appStruct.settings = settings;
        }
        // end handle top-level files

        if (isDirectChildrenOfAppDir) {
          const route = routeNames.find((filename) => filename === entry.name);
          if (route) {
            logger.info(`Found app-level route file: app/${entry.name}`);
            appStruct.app.route = route;
          }
          const middlewares = middlewareNames.find(
            (filename) => filename === entry.name,
          );
          if (middlewares) {
            logger.info(`Found app-level middleware file: app/${entry.name}`);
            appStruct.app.middlewares = middlewares;
          }
        } else {
          const appRoute = findAppRouteRecursive(
            appStruct.app.children,
            parentRelPathFromSrc,
          );
          if (appRoute) {
            const isVirtualGroupDir =
              appRoute.name.startsWith("(") && appRoute.name.endsWith(")");
            if (isVirtualGroupDir) {
              continue;
            }

            const route = routeNames.find(
              (filename) => filename === entry.name,
            );
            if (route) {
              logger.info(
                `Found route file: ${appRoute.relativePath}/${entry.name}`,
              );
              appRoute.route = route;
            }
            const middlewares = middlewareNames.find(
              (filename) => filename === entry.name,
            );
            if (middlewares) {
              logger.info(
                `Found middleware file: ${appRoute.relativePath}/${entry.name}`,
              );
              appRoute.middlewares = middlewares;
            }
          }
        }
      }
    }
  }

  traverseDirectory(srcPath);

  logger.info(
    `Directory scan completed: ${dirCount} directories, ${fileCount} files processed`,
  );
  logger.debug("App structure analysis completed");

  return appStruct;
}

function relPathToEndpoint(relPath: string): string {
  if (!relPath.startsWith("app/") || !relPath.endsWith("route.ts")) {
    throw new Error(`Invalid route path: ${relPath}`);
  }
  const relPathWithoutApp = relPath.slice("app/".length);
  const splited = relPathWithoutApp.split("/");
  let endpoint = "";
  for (const segment of splited) {
    if (segment.startsWith("(") && segment.endsWith(")")) {
      continue;
    }
    if (segment === "route.ts") {
      endpoint += "/";
    } else {
      endpoint += `/${segment}`;
    }
  }
  return endpoint;
}

function getEndpointHandlers(absPath: string) {
  logger.debug(`Parsing endpoint handlers from: ${absPath}`);

  // ===== Tool functions =====
  const isFunctionDec = (
    dec?: ExportedDeclarations,
  ): dec is FunctionDeclaration => {
    if (!dec) return false;
    if (dec.isKind(ts.SyntaxKind.FunctionDeclaration)) {
      return true;
    }
    return false;
  };
  const isVariableDec = (
    dec?: ExportedDeclarations,
  ): dec is VariableDeclaration => {
    if (!dec) return false;
    if (dec.isKind(ts.SyntaxKind.VariableDeclaration)) {
      return true;
    }
    return false;
  };
  const isArrowFunctionInit = (init?: Expression): init is ArrowFunction => {
    if (!init) return false;
    if (init.isKind(ts.SyntaxKind.ArrowFunction)) {
      return true;
    }
    return false;
  };

  // ===== Main logic =====
  const proj = new Project({
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: true,
    },
  });
  const sourceFile = proj.addSourceFileAtPath(absPath);
  const exports = sourceFile.getExportedDeclarations();
  const results: { exportName: string; isAsync: boolean }[] = [];

  for (const [key, declarations] of exports) {
    for (const dec of declarations) {
      if (isFunctionDec(dec)) {
        const isAsync = dec.isAsync();
        results.push({ exportName: key, isAsync });
      }
      if (isVariableDec(dec)) {
        const init = dec.getInitializer();
        if (isArrowFunctionInit(init)) {
          const isAsync = init.isAsync();
          results.push({ exportName: key, isAsync });
        }
      }
    }
  }

  logger.debug(`Found ${results.length} endpoint handlers in ${absPath}`);
  for (const handler of results) {
    logger.debug(`  - ${handler.exportName} (async: ${handler.isAsync})`);
  }

  return results;
}

function compileRoute(
  imports: string,
  routes: string,
  appRoute: AppRoute,
  srcDir: string,
  distToSrcRelPath: string,
  nearestSubRouter?: SubRouter,
) {
  logger.debug(`Compiling route: ${appRoute.name} at ${appRoute.relativePath}`);

  routes += `// ===== routes [${appRoute.name} | ${appRoute.relativePath}] =====\n`;
  if (appRoute.middlewares) {
    logger.debug(`Setting up middleware router for: ${appRoute.name}`);
    const groupRoutePath = `/${appRoute.name}`;
    const routeIdentifier = routeNameToIdentifier(appRoute.name);
    const routeMiddlewaresAlias = `${routeIdentifier}Middlewares`;
    imports += `import { ${Convention.middlewaresExportName} as ${routeMiddlewaresAlias} } from "${distToSrcRelPath}/${appRoute.relativePath}/${appRoute.middlewares.replace(".ts", "").replace(".js", "")}";\n`;
    const groupRouterIdentifier = `${routeIdentifier}Router`;
    appRoute.subRouter = {
      identifier: groupRouterIdentifier,
      path: groupRoutePath,
    };
    nearestSubRouter = {
      identifier: groupRouterIdentifier,
      path: groupRoutePath,
    };
    routes += `const ${groupRouterIdentifier} = express.Router();\n`;
    routes += `app.use("${groupRoutePath}", ${groupRouterIdentifier});\n`;
    routes += `${groupRouterIdentifier}.use(...${routeMiddlewaresAlias});\n`;
  }

  if (appRoute.route) {
    logger.debug(`Processing route handlers for: ${appRoute.name}`);

    let endpointUri = relPathToEndpoint(
      `${appRoute.relativePath}/${appRoute.route}`,
    );
    if (nearestSubRouter) {
      endpointUri = endpointUri.replace(nearestSubRouter.path, "");
    }

    logger.debug(
      `Mapped endpoint URI: ${endpointUri} for route: ${appRoute.name}`,
    );
    const routeAbsPath = path.resolve(
      srcDir,
      appRoute.relativePath,
      appRoute.route,
    );
    const handlers = getEndpointHandlers(routeAbsPath);
    let endpointHandlerInner = "";
    for (const handler of handlers) {
      const handlerAlias = `${uniqueRouteHandlerAlias(appRoute)}_${handler.exportName}`;
      imports += `import { ${handler.exportName} as ${handlerAlias} } from "${distToSrcRelPath}/${appRoute.relativePath}/${appRoute.route.replace(".ts", "").replace(".js", "")}";\n`;
      endpointHandlerInner += `if (req.method === "${handler.exportName}") { ${handler.isAsync ? "await " : ""}${handlerAlias}(req, res); return; }\n`;
    }
    const router = nearestSubRouter ? nearestSubRouter.identifier : "app";
    const endpointHandler = `${router}.all("${endpointUri}", async (req, res) => { ${endpointHandlerInner} ${Config.methodNotAllowedRes}});\n`;
    routes += endpointHandler;
  }
  routes += "\n";

  return {
    imports,
    routes,
  };
}

// for test case, sort app route to match rust-impl
function sortAppRoute(route: AppRoute) {
  route.children.sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
  if (route.children.length > 1) {
    route.children.forEach((child) => {
      sortAppRoute(child);
    });
  }
}

// add parent to appRoute
function transformAppRoutes(appRoute: AppRoute, parent?: AppRoute): AppRoute {
  if (parent) {
    appRoute.parent = parent;
  }

  if (appRoute.children && appRoute.children.length > 0) {
    for (const child of appRoute.children) {
      transformAppRoutes(child, appRoute);
    }
  }

  return appRoute;
}

function findNearestSubRouter(appRoute: AppRoute): SubRouter | undefined {
  if (appRoute.middlewares) {
    return appRoute.subRouter;
  }
  if (appRoute.parent) {
    return findNearestSubRouter(appRoute.parent);
  }
  return undefined;
}

// Compile the app structure to js code
function compileAppStruct(appStruct: AppStruct) {
  logger.info("Starting app structure compilation");

  transformAppRoutes(appStruct.app);

  let imports = "";
  let settings = "";
  let topLevelMiddlewares = "";
  let routes = "";
  let tailMiddlewares = "";

  /**
   * Expecting { name: string, value: any}[] object
   * Will be used to app.set()
   *
   * @example
   * // src/settings.ts
   * export const settings = [
   *   { name: "trust proxy", value: true },
   * ];
   */
  if (appStruct.settings) {
    logger.debug(`Adding settings import from: ${appStruct.settings}`);
    imports += `import { ${Convention.settingsExportName} as appSettings } from "${appStruct.distToSrcRelPath}/${appStruct.settings.replace(".ts", "").replace(".js", "")}";\n`;
    settings += `for (const setting of appSettings) {
      app.set(setting.name, setting.value);
    }\n`;
  }

  /**
   * Expecting an array of middlewares
   *
   * @example
   * // src/middlewares.ts
   * export const middlewares = [(req, res, next) => {}];
   */
  if (appStruct.topLevelMiddlewares) {
    logger.debug(
      `Adding top-level middlewares import from: ${appStruct.topLevelMiddlewares}`,
    );
    imports += `import { ${Convention.middlewaresExportName} as topLevelMiddlewares } from "${appStruct.distToSrcRelPath}/${appStruct.topLevelMiddlewares.replace(".ts", "").replace(".js", "")}";\n`;
    topLevelMiddlewares += `app.use(...topLevelMiddlewares);\n`;
  }

  /**
   * Expecting a not found handler
   *
   * @example
   * // src/not-found.ts
   * export const notFound = (req, res) => {
   *   res.status(404).send("Not Found");
   * };
   */
  if (appStruct.tailMiddlewares) {
    logger.debug(
      `Adding tail-middlewares handler import from: ${appStruct.tailMiddlewares}`,
    );
    imports += `import { ${Convention.tailMiddlewaresExportName} as tailMiddlewares } from "${appStruct.distToSrcRelPath}/${appStruct.tailMiddlewares.replace(".ts", "").replace(".js", "")}";\n`;
    tailMiddlewares += `app.use(...tailMiddlewares);\n`;
  }

  /**
   * 就像 Next.js 一样，期望 route[.ts,.js] 导出 GET、POST 等。
   *
   * 并且接受 sub router middlewares
   * 可以在文件夹中放置 middlewares[.ts,.js] 文件
   * 这个 middlewares 文件将会作用于当前文件夹及其子文件夹
   */
  const traverseRoute = (appRoute: AppRoute) => {
    logger.debug(
      `Traversing route: ${appRoute.name} (children: ${appRoute.children.length})`,
    );

    if (appRoute.route || appRoute.middlewares) {
      const nearestSubRouter = findNearestSubRouter(appRoute);
      const transformed = compileRoute(
        imports,
        routes,
        appRoute,
        appStruct.srcDir,
        appStruct.distToSrcRelPath,
        nearestSubRouter,
      );
      imports = transformed.imports;
      routes = transformed.routes;
    }
    for (const child of appRoute.children) {
      traverseRoute(child);
    }
  };

  logger.info("Traversing application routes");
  traverseRoute(appStruct.app);

  logger.info("App structure compilation completed");

  return {
    imports,
    settings,
    topLevelMiddlewares,
    routes,
    tailMiddlewares,
  };
}

export async function compile(
  srcDir: string,
  distDir: string,
  filename: string,
) {
  logger.info("Starting compilation process");
  logger.debug(
    `Parameters: srcDir: ${srcDir}, distDir: ${distDir}, filename: ${filename}`,
  );

  const customServerFilenames = getConventionFilenames(
    Convention.customServerBasename,
  );
  for (const customServerFilename of customServerFilenames) {
    const customServerPath = path.resolve(srcDir, customServerFilename);
    if (fs.existsSync(customServerPath)) {
      logger.info(`Found custom server template at: ${customServerPath}`);
      const customServerContent = fs.readFileSync(customServerPath, "utf-8");
      Convention.serverTemplate = customServerContent;
    }
  }

  logger.debug("Ensuring output directory exists");
  const outputPath = path.resolve(distDir, filename);
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  }

  logger.info("Building app structure");
  const appStruct = getAppStruct(srcDir, distDir);
  logger.debug("Sorting app routes for consistent output");
  sortAppRoute(appStruct.app);
  logger.info("Compiling app structure to code");
  const transformed = compileAppStruct(appStruct);

  logger.debug("Generating final output from template");

  const output = Convention.serverTemplate
    .replace("/* __nextExpress_imports__ */", transformed.imports)
    .replace("/* __nextExpress_settings__ */", transformed.settings)
    .replace(
      "/* __nextExpress_topLevelMiddlewares__ */",
      transformed.topLevelMiddlewares,
    )
    .replace("/* __nextExpress_routes__ */", transformed.routes)
    .replace(
      "/* __nextExpress_tailMiddlewares__ */",
      transformed.tailMiddlewares,
    );

  logger.info(`Writing output to: ${outputPath}`);
  fs.writeFileSync(outputPath, output);

  logger.info("Compilation completed successfully");
}
