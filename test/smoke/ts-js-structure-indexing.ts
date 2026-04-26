import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProjectProfile } from "../../packages/contracts/src/index.ts";
import { scanProject } from "../../services/indexer/src/file-scan.ts";

function writeProject(projectRoot: string): void {
  mkdirSync(path.join(projectRoot, "src", "app", "api", "todos"), { recursive: true });
  mkdirSync(path.join(projectRoot, "src", "app", "[tenant]"), { recursive: true });
  mkdirSync(path.join(projectRoot, "src", "lib"), { recursive: true });

  writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "ts-js-structure-smoke" }));
  writeFileSync(
    path.join(projectRoot, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@lib/*": ["src/lib/*"],
        },
      },
    }),
  );
  writeFileSync(path.join(projectRoot, "src", "types.ts"), "export interface RequestLike {}\n");
  writeFileSync(
    path.join(projectRoot, "src", "lib", "routes.ts"),
    [
      "export const apiRoutes = {",
      "  list: { method: 'GET', path: '/api/todos' },",
      "} as const;",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(projectRoot, "src", "lib", "util.ts"),
    [
      "const internal = 1;",
      "export interface Todo { id: string }",
      "export type TodoId = string;",
      "export class TodoService {}",
      "export function loadTodos() { return []; }",
      "export const todoLimit = 20;",
      "export { internal as renamedInternal };",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(projectRoot, "src", "server.ts"),
    [
      "import type { RequestLike } from './types';",
      "import { apiRoutes } from './lib/routes';",
      "import { loadTodos } from './lib/util';",
      "import { todoLimit } from '@lib/util';",
      "",
      "declare const app: { post(path: string, handler: unknown): void };",
      "declare const method: string;",
      "declare const pathname: string;",
      "",
      "export function handler(_request: RequestLike) {",
      "  if (method === apiRoutes.list.method && pathname === apiRoutes.list.path) {",
      "    return loadTodos();",
      "  }",
      "}",
      "",
      "function createTodo() { return null; }",
      "app.post('/api/todos', createTodo);",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(projectRoot, "src", "app", "api", "todos", "route.ts"),
    "export async function GET() { return Response.json({ ok: true }); }\n",
  );
  writeFileSync(
    path.join(projectRoot, "src", "app", "[tenant]", "page.tsx"),
    "export default function Page() { return <main />; }\n",
  );
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-ts-js-structure-"));
  const projectRoot = path.join(tmp, "project");
  mkdirSync(projectRoot, { recursive: true });
  writeProject(projectRoot);

  const profile: ProjectProfile = {
    name: "ts-js-structure-smoke",
    rootPath: projectRoot,
    framework: "nextjs",
    orm: "unknown",
    srcRoot: "src",
    entryPoints: [],
    pathAliases: {},
    middlewareFiles: [],
    serverOnlyModules: [],
    authGuardSymbols: [],
    supportLevel: "best_effort",
    detectedAt: new Date().toISOString(),
  };

  try {
    const { snapshot, stats } = await scanProject(projectRoot, profile);
    const util = snapshot.files.find((file) => file.path === "src/lib/util.ts");
    const server = snapshot.files.find((file) => file.path === "src/server.ts");
    const route = snapshot.files.find((file) => file.path === "src/app/api/todos/route.ts");
    const page = snapshot.files.find((file) => file.path === "src/app/[tenant]/page.tsx");

    assert.ok(util);
    assert.ok(server);
    assert.ok(route);
    assert.ok(page);
    assert.ok(stats.symbols >= 6, "AST symbol extraction should index exported TS declarations");
    assert.ok(util.symbols.some((symbol) => symbol.name === "TodoService" && symbol.kind === "class"));
    assert.ok(util.symbols.some((symbol) => symbol.name === "renamedInternal" && symbol.kind === "export"));

    const typeImport = server.imports.find((edge) => edge.specifier === "./types");
    assert.equal(typeImport?.isTypeOnly, true);
    assert.equal(typeImport?.targetPath, "src/types.ts");
    assert.ok(server.imports.some((edge) => edge.specifier === "./lib/routes" && edge.targetPath === "src/lib/routes.ts"));
    assert.ok(server.imports.some((edge) => edge.specifier === "@lib/util" && edge.targetPath === "src/lib/util.ts"));

    assert.ok(route.routes.some((record) => record.routeKey === "route:/api/todos:GET"));
    assert.ok(page.routes.some((record) => record.routeKey === "page:/:tenant"));
    assert.ok(server.routes.some((record) =>
      record.framework === "local-http" &&
      record.pattern === "/api/todos" &&
      record.method === "GET" &&
      record.metadata?.definitionExport === "apiRoutes.list",
    ));
    assert.ok(server.routes.some((record) =>
      record.framework === "local-http" &&
      record.pattern === "/api/todos" &&
      record.method === "POST" &&
      record.handlerName === "createTodo",
    ));

    console.log("ts-js-structure-indexing: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
