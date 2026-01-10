use anyhow::{Context, Result};
use clap::Parser as ClapParser;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use swc_common::SourceMap;
use swc_common::sync::Lrc;
use swc_ecma_ast::*;
use swc_ecma_parser::{Parser, StringInput, Syntax, TsSyntax, lexer::Lexer};
use swc_ecma_visit::{Visit, VisitWith};

const SERVER_TEMPLATE: &str = r#"import express from "express";
/* __nextExpress_imports__ */

export const createServer = () => {
  const app = express();

  /* __nextExpress_settings__ */

  /* __nextExpress_topLevelMiddlewares__ */

  /* __nextExpress_routes__ */

  /* __nextExpress_tailMiddlewares__ */
  return app;
};
"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SubRouter {
    identifier: String,
    path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppRoute {
    name: String,
    relative_path: String,
    route: Option<String>,
    middlewares: Option<String>,
    children: Vec<AppRoute>,

    // runtime properties
    sub_router: Option<SubRouter>,
}

#[derive(Debug, Clone)]
struct AppStruct {
    src_dir: String,
    dist_to_src_relpath: String,
    app: AppRoute,
    top_level_middlewares: Option<String>,
    tail_middlewares: Option<String>,
    settings: Option<String>,
}

#[derive(Debug, Clone)]
struct Convention {
    // template
    server_template: String,

    // routes
    app_dir_name: String,
    support_ext: Vec<String>,
    route_file_basename: String,
    middlewares_file_basename: String,
    tail_middlewares_file_basename: String,
    settings_file_basename: String,
    custom_server_basename: String,

    // exports
    settings_export_name: String,
    middlewares_export_name: String,
    tail_middlewares_export_name: String,
}

impl Convention {
    fn default() -> Self {
        Self {
            server_template: SERVER_TEMPLATE.to_string(),

            app_dir_name: "app".to_string(),
            route_file_basename: "route".to_string(),
            support_ext: vec![".ts".to_string(), ".js".to_string()],
            middlewares_file_basename: "middlewares".to_string(),
            tail_middlewares_file_basename: "tail-middlewares".to_string(),
            settings_file_basename: "settings".to_string(),
            custom_server_basename: "custom-server".to_string(),

            settings_export_name: "settings".to_string(),
            middlewares_export_name: "middlewares".to_string(),
            tail_middlewares_export_name: "middlewares".to_string(),
        }
    }

    fn get_filenames(&self, basename: &str) -> Vec<String> {
        self.support_ext
            .iter()
            .map(|ext| format!("{}{}", basename, ext))
            .collect()
    }

    fn get_middlewares_filenames(&self) -> Vec<String> {
        self.get_filenames(&self.middlewares_file_basename)
    }

    fn get_tail_middlewares_filenames(&self) -> Vec<String> {
        self.get_filenames(&self.tail_middlewares_file_basename)
    }

    fn get_settings_filenames(&self) -> Vec<String> {
        self.get_filenames(&self.settings_file_basename)
    }

    fn get_route_filenames(&self) -> Vec<String> {
        self.get_filenames(&self.route_file_basename)
    }

    fn get_custom_server_filenames(&self) -> Vec<String> {
        self.get_filenames(&self.custom_server_basename)
    }
}

#[derive(Debug, Clone)]
struct Config {
    method_not_allowed_res: String,
}

impl Config {
    fn default() -> Self {
        Self {
            method_not_allowed_res: "res.status(405).send(`Method ${req.method} Not Allowed`);"
                .to_string(),
        }
    }
}

#[derive(Debug)]
struct EndpointHandler {
    export_name: String,
    is_async: bool,
}

struct ExportVisitor {
    exports: Vec<EndpointHandler>,
}

impl ExportVisitor {
    fn new() -> Self {
        Self {
            exports: Vec::new(),
        }
    }
}

impl Visit for ExportVisitor {
    fn visit_export_decl(&mut self, n: &ExportDecl) {
        match &n.decl {
            Decl::Fn(fn_decl) => {
                let name = fn_decl.ident.sym.to_string();
                let is_async = fn_decl.function.is_async;
                self.exports.push(EndpointHandler {
                    export_name: name,
                    is_async,
                });
            }
            Decl::Var(var_decl) => {
                for decl in &var_decl.decls {
                    if let Pat::Ident(ident) = &decl.name {
                        let name = ident.id.sym.to_string();
                        let is_async = if let Some(init) = &decl.init {
                            match init.as_ref() {
                                Expr::Arrow(arrow) => arrow.is_async,
                                _ => false,
                            }
                        } else {
                            false
                        };
                        self.exports.push(EndpointHandler {
                            export_name: name,
                            is_async,
                        });
                    }
                }
            }
            _ => {}
        }
    }

    fn visit_export_default_expr(&mut self, n: &ExportDefaultExpr) {
        // Handle default exports if needed
        let is_async = match n.expr.as_ref() {
            Expr::Arrow(arrow) => arrow.is_async,
            Expr::Fn(fn_expr) => fn_expr.function.is_async,
            _ => false,
        };
        self.exports.push(EndpointHandler {
            export_name: "default".to_string(),
            is_async,
        });
    }
}

fn route_name_to_identifier(name: &str) -> Result<String> {
    let name = name.trim().replace('-', "_");
    if name.starts_with('(') && name.ends_with(')') {
        anyhow::bail!("Virtual group should not be used as a route name");
    }
    Ok(name)
}

fn unique_route_handler_alias(app_route: &AppRoute) -> String {
    app_route
        .relative_path
        .replace('/', "_")
        .replace('.', "_")
        .replace('-', "_")
        .replace('(', "")
        .replace(')', "")
}

fn find_app_route_recursive_mut<'a>(
    app_routes: &'a mut [AppRoute],
    relative_path: &str,
) -> Option<&'a mut AppRoute> {
    for route in app_routes {
        if route.relative_path == relative_path {
            return Some(route);
        }
        if let Some(child_route) = find_app_route_recursive_mut(&mut route.children, relative_path)
        {
            return Some(child_route);
        }
    }
    None
}

fn get_app_struct(src_dir: &str, dist_dir: &str, convention: &Convention) -> Result<AppStruct> {
    log::debug!(
        "Starting to analyze app structure from src_dir: {}",
        src_dir
    );

    let src_path = PathBuf::from(src_dir).canonicalize().map_err(|e| {
        anyhow::anyhow!("Failed to canonicalize source directory {}: {}", src_dir, e)
    })?;
    let dist_path = PathBuf::from(dist_dir).canonicalize().map_err(|e| {
        anyhow::anyhow!("Failed to canonicalize dist directory {}: {}", dist_dir, e)
    })?;

    log::debug!(
        "Canonicalized paths - src: {}, dist: {}",
        src_path.display(),
        dist_path.display()
    );
    let mut app_struct = AppStruct {
        src_dir: src_dir.to_string(),
        dist_to_src_relpath: pathdiff::diff_paths(&src_path, &dist_path)
            .context("Failed to compute dist to src relative path")?
            .to_string_lossy()
            .to_string(),
        app: AppRoute {
            name: "app".to_string(),
            relative_path: "app".to_string(),
            route: None,
            middlewares: None,
            children: Vec::new(),
            sub_router: None,
        },
        top_level_middlewares: None,
        tail_middlewares: None,
        settings: None,
    };

    log::info!("Scanning directory structure in: {}", src_path.display());
    let mut file_count = 0;
    let mut dir_count = 0;

    for entry in WalkDir::new(&src_path) {
        let entry = entry?;
        let path = entry.path();
        let relative_path =
            pathdiff::diff_paths(path, &src_path).context("Failed to compute relative path")?;
        let relative_path_str = relative_path.to_string_lossy().to_string();

        let is_inside_app_dir = relative_path_str.starts_with(&convention.app_dir_name);
        let parent_path = path.parent().unwrap_or(&src_path);
        let parent_relative_path = pathdiff::diff_paths(parent_path, &src_path)
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let is_direct_children_of_app_dir = parent_path == src_path.join(&convention.app_dir_name);

        if entry.file_type().is_dir() {
            dir_count += 1;
            log::debug!("Found directory: {}", relative_path_str);

            if is_direct_children_of_app_dir {
                app_struct.app.children.push(AppRoute {
                    name: entry.file_name().to_string_lossy().to_string(),
                    relative_path: relative_path_str,
                    route: None,
                    middlewares: None,
                    children: Vec::new(),
                    sub_router: None,
                });
            } else if is_inside_app_dir {
                if let Some(app_route) = find_app_route_recursive_mut(
                    &mut app_struct.app.children,
                    &parent_relative_path,
                ) {
                    app_route.children.push(AppRoute {
                        name: entry.file_name().to_string_lossy().to_string(),
                        relative_path: relative_path_str,
                        route: None,
                        middlewares: None,
                        children: Vec::new(),
                        sub_router: None,
                    });
                }
            }
        } else {
            file_count += 1;
            log::debug!("Processing file: {}", relative_path_str);

            // Handle files
            let filename = entry.file_name().to_string_lossy();

            // Handle top-level files
            let middleware_names = convention.get_middlewares_filenames();
            if middleware_names.contains(&relative_path_str) {
                log::info!("Found top-level middleware file: {}", relative_path_str);
                app_struct.top_level_middlewares = Some(relative_path_str.clone());
            }

            let tail_middlewares_names = convention.get_tail_middlewares_filenames();
            if tail_middlewares_names.contains(&relative_path_str) {
                log::info!("Found tail middleware file: {}", relative_path_str);
                app_struct.tail_middlewares = Some(relative_path_str.clone());
            }

            let settings_names = convention.get_settings_filenames();
            if settings_names.contains(&relative_path_str) {
                log::info!("Found settings file: {}", relative_path_str);
                app_struct.settings = Some(relative_path_str.clone());
            }

            // Handle route and middleware files
            let route_names = convention.get_route_filenames();
            let middleware_names = convention.get_middlewares_filenames();

            if is_direct_children_of_app_dir {
                if route_names.contains(&filename.to_string()) {
                    log::info!("Found app-level route file: app/{}", filename);
                    app_struct.app.route = Some(filename.to_string());
                }
                if middleware_names.contains(&filename.to_string()) {
                    log::info!("Found app-level middleware file: app/{}", filename);
                    app_struct.app.middlewares = Some(filename.to_string());
                }
            } else if is_inside_app_dir {
                if let Some(app_route) = find_app_route_recursive_mut(
                    &mut app_struct.app.children,
                    &parent_relative_path,
                ) {
                    let is_virtual_group_dir =
                        app_route.name.starts_with('(') && app_route.name.ends_with(')');
                    if !is_virtual_group_dir {
                        if route_names.contains(&filename.to_string()) {
                            log::info!(
                                "Found route file: {}/{}",
                                app_route.relative_path,
                                filename
                            );
                            app_route.route = Some(filename.to_string());
                        }
                        if middleware_names.contains(&filename.to_string()) {
                            log::info!(
                                "Found middleware file: {}/{}",
                                app_route.relative_path,
                                filename
                            );
                            app_route.middlewares = Some(filename.to_string());
                        }
                    }
                }
            }
        }
    }

    log::info!(
        "Directory scan completed: {} directories, {} files processed",
        dir_count,
        file_count
    );
    log::debug!("App structure analysis completed");

    Ok(app_struct)
}

fn rel_path_to_endpoint(rel_path: &str) -> Result<String> {
    if !rel_path.starts_with("app/") || !rel_path.ends_with("route.ts") {
        anyhow::bail!("Invalid route path: {}", rel_path);
    }

    let rel_path_without_app = &rel_path["app/".len()..];
    let segments: Vec<&str> = rel_path_without_app.split('/').collect();
    let mut endpoint = String::new();

    for segment in segments {
        if segment.starts_with('(') && segment.ends_with(')') {
            continue;
        }
        if segment == "route.ts" {
            endpoint.push('/');
        } else {
            endpoint.push('/');
            endpoint.push_str(segment);
        }
    }

    Ok(endpoint)
}

fn get_endpoint_handlers(abs_path: &Path) -> Result<Vec<EndpointHandler>> {
    log::debug!("Parsing endpoint handlers from: {}", abs_path.display());

    let source_map: Lrc<SourceMap> = Default::default();
    let source_file = source_map.load_file(abs_path)?;

    let lexer = Lexer::new(
        Syntax::Typescript(TsSyntax {
            tsx: false,
            decorators: true,
            dts: false,
            no_early_errors: true,
            disallow_ambiguous_jsx_like: true,
        }),
        EsVersion::Es2022,
        StringInput::from(&*source_file),
        None,
    );

    let mut parser = Parser::new_from(lexer);
    let module = parser
        .parse_module()
        .map_err(|e| anyhow::anyhow!("Parse error: {:?}", e))?;

    let mut visitor = ExportVisitor::new();
    module.visit_with(&mut visitor);

    log::debug!(
        "Found {} endpoint handlers in {}",
        visitor.exports.len(),
        abs_path.display()
    );
    for handler in &visitor.exports {
        log::debug!("  - {} (async: {})", handler.export_name, handler.is_async);
    }

    Ok(visitor.exports)
}

fn compile_route(
    imports: &mut String,
    routes: &mut String,
    app_route: &mut AppRoute,
    src_dir: &str,
    dist_to_src_relpath: &str,
    nearest_sub_router: Option<&SubRouter>,
    convention: &Convention,
    config: &Config,
) -> Result<()> {
    log::debug!(
        "Compiling route: {} at {}",
        app_route.name,
        app_route.relative_path
    );

    routes.push_str(&format!(
        "// ===== routes [{} | {}] =====\n",
        app_route.name, app_route.relative_path
    ));

    let mut current_nearest_sub_router = nearest_sub_router;

    if let Some(_middlewares) = &app_route.middlewares {
        log::debug!("Setting up middleware router for: {}", app_route.name);
        // Calculate the full path from app root by converting relative_path to endpoint
        // e.g., "app/manage/admin" -> "/manage/admin"
        let full_router_path = format!(
            "/{}",
            app_route
                .relative_path
                .strip_prefix("app/")
                .unwrap_or(&app_route.relative_path)
        );
        // If there's a parent sub-router, we need to make this path relative to it
        let group_route_path = if let Some(sub_router) = nearest_sub_router {
            full_router_path.replace(&sub_router.path, "")
        } else {
            full_router_path.clone()
        };
        let route_identifier = route_name_to_identifier(&app_route.name)?;
        let route_middlewares_alias = format!("{}Middlewares", route_identifier);

        imports.push_str(&format!(
            "import {{ {} as {} }} from \"{}/{}/{}\";\n",
            convention.middlewares_export_name,
            route_middlewares_alias,
            dist_to_src_relpath,
            app_route.relative_path,
            app_route
                .middlewares
                .as_ref()
                .unwrap()
                .replace(".ts", "")
                .replace(".js", "")
        ));

        let group_router_identifier = format!("{}Router", route_identifier);
        // Store the full path from app root for child routes to use
        app_route.sub_router = Some(SubRouter {
            identifier: group_router_identifier.clone(),
            path: full_router_path,
        });
        // Use the parent router if available, otherwise use app
        let parent_router = nearest_sub_router
            .map(|s| s.identifier.as_str())
            .unwrap_or("app");
        current_nearest_sub_router = app_route.sub_router.as_ref();

        routes.push_str(&format!(
            "const {} = express.Router();\n",
            group_router_identifier
        ));
        routes.push_str(&format!(
            "{}.use(\"{}\", {});\n",
            parent_router, group_route_path, group_router_identifier
        ));
        routes.push_str(&format!(
            "{}.use(...{});\n",
            group_router_identifier, route_middlewares_alias
        ));
    }

    if let Some(route) = &app_route.route {
        log::debug!("Processing route handlers for: {}", app_route.name);

        let mut endpoint_uri =
            rel_path_to_endpoint(&format!("{}/{}", app_route.relative_path, route))?;
        if let Some(sub_router) = current_nearest_sub_router {
            endpoint_uri = endpoint_uri.replace(&sub_router.path, "");
        }

        log::debug!(
            "Mapped endpoint URI: {} for route: {}",
            endpoint_uri,
            app_route.name
        );

        let route_abs_path = PathBuf::from(src_dir)
            .join(&app_route.relative_path)
            .join(route);
        let handlers = match get_endpoint_handlers(&route_abs_path) {
            Ok(handlers) => {
                if handlers.is_empty() {
                    return Err(anyhow::anyhow!(
                        "No valid endpoint handlers found in {}",
                        route_abs_path.display()
                    ));
                }
                handlers
            }
            Err(e) => {
                return Err(anyhow::anyhow!(
                    "Failed to get endpoint handlers for {}: {}",
                    route_abs_path.display(),
                    e
                ));
            }
        };

        let mut endpoint_handler_inner = String::new();
        for handler in handlers {
            let handler_alias = format!(
                "{}_{}",
                unique_route_handler_alias(app_route),
                handler.export_name
            );
            imports.push_str(&format!(
                "import {{ {} as {} }} from \"{}/{}/{}\";\n",
                handler.export_name,
                handler_alias,
                dist_to_src_relpath,
                app_route.relative_path,
                app_route
                    .route
                    .as_ref()
                    .unwrap()
                    .replace(".ts", "")
                    .replace(".js", "")
            ));
            endpoint_handler_inner.push_str(&format!(
                "if (req.method === \"{}\") {{ {}{}(req, res); return; }}\n",
                handler.export_name.to_uppercase(),
                if handler.is_async { "await " } else { "" },
                handler_alias
            ));
        }

        let router = current_nearest_sub_router
            .map(|s| s.identifier.as_str())
            .unwrap_or("app");
        let endpoint_handler = format!(
            "{}.all(\"{}\", async (req, res) => {{ {} {} }});\n",
            router, endpoint_uri, endpoint_handler_inner, config.method_not_allowed_res,
        );
        routes.push_str(&endpoint_handler);
    }

    routes.push('\n');
    Ok(())
}

#[derive(Debug)]
struct CompiledAppStruct {
    imports: String,
    settings: String,
    top_level_middlewares: String,
    routes: String,
    tail_middlewares: String,
}

fn compile_app_struct(
    app_struct: &mut AppStruct,
    convention: &Convention,
    config: &Config,
) -> Result<CompiledAppStruct> {
    log::info!("Starting app structure compilation");

    let mut imports = String::new();
    let mut settings = String::new();
    let mut top_level_middlewares = String::new();
    let mut routes = String::new();
    let mut tail_middlewares = String::new();

    if let Some(settings_file) = &app_struct.settings {
        log::debug!("Adding settings import from: {}", settings_file);
        imports.push_str(&format!(
            "import {{ {} as appSettings }} from \"{}/{}\";\n",
            convention.settings_export_name,
            app_struct.dist_to_src_relpath,
            settings_file.replace(".ts", "").replace(".js", "")
        ));
        settings.push_str("for (const setting of appSettings) {\n      app.set(setting.name, setting.value);\n    }\n");
    }

    if let Some(middlewares_file) = &app_struct.top_level_middlewares {
        log::debug!(
            "Adding top-level middlewares import from: {}",
            middlewares_file
        );
        imports.push_str(&format!(
            "import {{ {} as topLevelMiddlewares }} from \"{}/{}\";\n",
            convention.middlewares_export_name,
            app_struct.dist_to_src_relpath,
            middlewares_file.replace(".ts", "").replace(".js", "")
        ));
        top_level_middlewares.push_str("app.use(...topLevelMiddlewares);\n");
    }

    if let Some(tail_middlewares_file) = &app_struct.tail_middlewares {
        log::debug!(
            "Adding tail-middlewares handler import from: {}",
            tail_middlewares_file
        );
        imports.push_str(&format!(
            "import {{ {} as tailMiddlewares }} from \"{}/{}\";\n",
            convention.tail_middlewares_export_name,
            app_struct.dist_to_src_relpath,
            tail_middlewares_file.replace(".ts", "").replace(".js", "")
        ));
        tail_middlewares.push_str("app.use(...tailMiddlewares);\n");
    }

    fn traverse_route(
        app_route: &mut AppRoute,
        imports: &mut String,
        routes: &mut String,
        src_dir: &str,
        dist_to_src_relpath: &str,
        nearest_sub_router: Option<&SubRouter>,
        convention: &Convention,
        config: &Config,
    ) -> Result<()> {
        log::debug!(
            "Traversing route: {} (children: {})",
            app_route.name,
            app_route.children.len()
        );

        if app_route.route.is_some() || app_route.middlewares.is_some() {
            compile_route(
                imports,
                routes,
                app_route,
                src_dir,
                dist_to_src_relpath,
                nearest_sub_router,
                convention,
                config,
            )?;
        }

        let current_sub_router = app_route.sub_router.as_ref().or(nearest_sub_router);

        for child in &mut app_route.children {
            traverse_route(
                child,
                imports,
                routes,
                src_dir,
                dist_to_src_relpath,
                current_sub_router,
                convention,
                config,
            )?;
        }

        Ok(())
    }

    log::info!("Traversing application routes");
    traverse_route(
        &mut app_struct.app,
        &mut imports,
        &mut routes,
        &app_struct.src_dir,
        &app_struct.dist_to_src_relpath,
        None,
        convention,
        config,
    )?;

    log::info!("App structure compilation completed");

    Ok(CompiledAppStruct {
        imports,
        settings,
        top_level_middlewares,
        routes,
        tail_middlewares,
    })
}

// for test case, sort app route to match ts-impl
fn sort_app_route(app_struct: &mut AppRoute) {
    app_struct
        .children
        .sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    if app_struct.children.len() > 1 {
        for child in &mut app_struct.children {
            sort_app_route(child);
        }
    }
}

fn compile(
    src_dir: &str,
    dist_dir: &str,
    filename: &str,
    convention: &mut Convention,
    config: &Config,
) -> Result<()> {
    log::info!("Starting compilation process");
    log::debug!(
        "Parameters - src_dir: {}, dist_dir: {}, filename: {}",
        src_dir,
        dist_dir,
        filename
    );

    let custom_server_paths: Vec<PathBuf> = convention
        .get_custom_server_filenames()
        .iter()
        .map(|f| PathBuf::from(src_dir).join(f))
        .collect();
    for custom_server_path in &custom_server_paths {
        if custom_server_path.exists() {
            log::info!(
                "Found custom server template at: {}",
                custom_server_path.display()
            );
            println!(
                "[{}] Found custom server template at {}",
                env!("CARGO_PKG_NAME"),
                custom_server_path.display()
            );
            convention.server_template = fs::read_to_string(custom_server_path)
                .context("Failed to read custom server template")?;
            break;
        }
    }

    log::debug!("Ensuring output directory exists");
    let output_path = Path::new(dist_dir).join(filename);
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)?;
    }

    log::info!("Building app structure");
    let mut app_struct = get_app_struct(src_dir, dist_dir, convention)?;

    log::debug!("Sorting app routes for consistent output");
    sort_app_route(&mut app_struct.app);

    log::info!("Compiling app structure to code");
    let transformed = compile_app_struct(&mut app_struct, convention, config)?;

    log::debug!("Generating final output from template");
    let output = convention
        .server_template
        .replace("/* __nextExpress_imports__ */", &transformed.imports)
        .replace("/* __nextExpress_settings__ */", &transformed.settings)
        .replace(
            "/* __nextExpress_topLevelMiddlewares__ */",
            &transformed.top_level_middlewares,
        )
        .replace("/* __nextExpress_routes__ */", &transformed.routes)
        .replace(
            "/* __nextExpress_tailMiddlewares__ */",
            &transformed.tail_middlewares,
        );

    log::info!("Writing output to: {}", output_path.display());
    fs::write(output_path, output)?;

    log::info!("Compilation completed successfully");
    Ok(())
}

#[derive(ClapParser, Debug)]
#[command(version, about = "A compiler cli for next-express writen in rust.", long_about = None)]
struct Args {
    #[arg(long, default_value = "src")]
    src_dir: String,

    #[arg(long, default_value = "nexp-compiled")]
    dist_dir: String,

    #[arg(long, default_value = "server.ts")]
    filename: String,
}

fn main() -> Result<()> {
    let env = env_logger::Env::new().filter_or("NEXP_LOG", "info");
    env_logger::init_from_env(env);

    let args = Args::parse();

    let src_dir = args.src_dir;
    let dist_dir = args.dist_dir;
    let filename = args.filename;

    log::info!(
        "Compiling next-express from {}, output to {}/{}",
        src_dir,
        dist_dir,
        filename
    );

    let start_time = std::time::Instant::now();
    let mut convention = Convention::default();
    let config = Config::default();
    compile(&src_dir, &dist_dir, &filename, &mut convention, &config)?;

    log::info!(
        "Compiling completed successfully in {}ms!",
        start_time.elapsed().as_millis()
    );
    Ok(())
}
