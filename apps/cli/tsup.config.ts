import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

// esbuild strips the `node:` prefix from built-in module imports as part of
// its normalization pass, and there is no supported option to disable it.
// For most built-ins this is fine — `fs`, `path`, `crypto` etc. are equally
// resolvable without the prefix. But a handful of newer built-ins are
// **prefix-only**: `node:sqlite`, `node:test`, `node:sea`. Stripping those
// produces `import ... from "sqlite"`, which fails at runtime because there
// is no `sqlite` package on npm.
//
// This post-build patch runs after tsup finishes bundling and rewrites the
// only prefix-only built-in we actually use (`sqlite`) back to its canonical
// `node:sqlite` form. If the codebase ever picks up another prefix-only
// built-in, add its specifier to `PREFIX_ONLY_BUILTINS` below.
const PREFIX_ONLY_BUILTINS = ["sqlite"] as const;
const requireFromIndexer = createRequire(
  fileURLToPath(new URL("../../services/indexer/package.json", import.meta.url)),
);
const WASM_ASSETS = [
  { packageName: "web-tree-sitter", fileName: "tree-sitter.wasm" },
  { packageName: "tree-sitter-typescript", fileName: "tree-sitter-typescript.wasm" },
  { packageName: "tree-sitter-typescript", fileName: "tree-sitter-tsx.wasm" },
] as const;

function restoreNodePrefixes(distFile: string): void {
  let content = readFileSync(distFile, "utf8");
  let replaced = 0;
  for (const name of PREFIX_ONLY_BUILTINS) {
    const fromPattern = new RegExp(`from\\s+["']${name}["']`, "g");
    content = content.replace(fromPattern, (match) => {
      replaced += 1;
      return match.replace(`"${name}"`, `"node:${name}"`).replace(`'${name}'`, `'node:${name}'`);
    });
  }
  if (replaced > 0) {
    writeFileSync(distFile, content, "utf8");
  }
}

function resolvePackageAsset(packageName: string, fileName: string): string {
  const entryPath = requireFromIndexer.resolve(packageName);
  let candidateDir = dirname(entryPath);
  for (let i = 0; i < 4; i += 1) {
    const candidate = resolve(candidateDir, fileName);
    if (existsSync(candidate)) {
      return candidate;
    }
    candidateDir = dirname(candidateDir);
  }
  throw new Error(`Unable to locate ${fileName} for ${packageName} starting from ${entryPath}`);
}

function copyRuntimeAssets(distDir: string): void {
  mkdirSync(distDir, { recursive: true });
  for (const asset of WASM_ASSETS) {
    const sourcePath = resolvePackageAsset(asset.packageName, asset.fileName);
    if (!existsSync(sourcePath)) {
      throw new Error(`Missing runtime asset ${asset.fileName} from ${asset.packageName}`);
    }
    copyFileSync(sourcePath, resolve(distDir, asset.fileName));
  }

  // Phase 3.9: ship the bundled models.dev snapshot next to dist/index.js so
  // the catalog source resolver can find it via `import.meta.url`. Missing
  // snapshot is non-fatal — the BUNDLED_CATALOG floor still answers.
  const here = fileURLToPath(new URL(".", import.meta.url));
  const snapshotSource = resolve(
    here,
    "../../packages/harness-contracts/models/snapshot.json",
  );
  if (existsSync(snapshotSource)) {
    copyFileSync(snapshotSource, resolve(distDir, "models-snapshot.json"));
  }
}

// Bundle the CLI into a single self-contained file for publishing. The goal is
// to produce a `dist/index.js` that a clean machine can run with
// `node apps/cli/dist/index.js …` or `agentmako …` (when installed from npm)
// without resolving any `@mako-ai/*` workspace packages at runtime.
//
// Strategy:
//
//   - Inline every `@mako-ai/*` workspace package into the bundle. They are
//     private and will never be published on their own — the CLI is the only
//     shipping surface.
//   - Keep native / platform-specific modules external. `@napi-rs/keyring` has
//     a prebuilt native component that can't be bundled, and `pg` pulls in
//     optional native bindings via `pg-native`. These stay as runtime
//     dependencies declared in `apps/cli/package.json`.
//   - Inline `zod` because it's a small pure-JS library used across multiple
//     workspace packages. Leaving it external would force us to pin it in the
//     CLI's dependencies as well, and it's cheap to inline.
//
// `banner.js` makes sure the output starts with the Node shebang so the
// generated bin entry is executable without a separate post-processing step.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  // Don't wipe `dist/` on every build — `tsc -b` (root typecheck pass) emits
  // `dist/index.d.ts` and `dist/index.d.ts.map` for the composite project
  // reference, and `clean: true` would delete them mid-build. `splitting: false`
  // and a single `entry` mean tsup produces exactly one file (`dist/index.js`),
  // so it's safe to let it overwrite that one file without sweeping the folder.
  clean: false,
  splitting: false,
  shims: false,
  sourcemap: false,
  // Inline every `@mako-ai/*` workspace package plus `zod` (a small pure-JS
  // library used across multiple workspace deps — cheap to bundle, and
  // leaving it external would force it into the published dependency list).
  noExternal: [/^@mako-ai\//, "zod"],
  // Keep the rest external. `@modelcontextprotocol/sdk` uses subpath exports
  // for its ajv validation helper (`@modelcontextprotocol/sdk/validation/ajv`),
  // and tsup's bundler can't reliably inline packages with complex subpath
  // exports — the resulting bundle ends up with orphaned `import "ajv"`
  // statements pointing at internal sub-paths. Keeping the SDK external lets
  // npm's own resolver handle ajv / ajv-formats / supports-color transitively
  // through the SDK's package.json. Native bindings (`@napi-rs/keyring`,
  // `pg`) stay external because they can't be bundled at all.
  external: [
    "@napi-rs/keyring",
    "pg",
    "pg-native",
    "@modelcontextprotocol/sdk",
    /^@modelcontextprotocol\/sdk\//,
    // Native / WASM-loading deps that must stay external — esbuild's
    // native-node-modules plugin trips on the platform-specific shims they
    // ship (e.g. ast-grep-napi.android-arm64.node) and even adding the
    // platform we run on to npm's optionalDependencies wouldn't avoid the
    // bundling-time resolution attempt for the others.
    "@ast-grep/napi",
    /^@ast-grep\/napi\//,
    "web-tree-sitter",
    "tree-sitter-typescript",
    // pgsql-parser loads libpg-query's WASM relative to its package files.
    // Bundling it into CLI ESM breaks that loader because libpg-query expects
    // a CommonJS __dirname, so keep the parser package external.
    "pgsql-parser",
    "libpg-query",
    "pgsql-deparser",
    // TS-aware diagnostics now use the TypeScript compiler API at runtime.
    // Bundling `typescript` into the single-file CLI ESM artifact breaks
    // because the compiler package still uses dynamic `fs` requires
    // internally; keep it as a normal runtime dependency instead.
    "typescript",
  ],
  // `onSuccess` restores the `node:` prefix on prefix-only built-ins
  // (see `restoreNodePrefixes` above). Without it, `node:sqlite` silently
  // becomes `"sqlite"` in the bundled output and fails to resolve at runtime.
  onSuccess: async () => {
    const here = fileURLToPath(new URL(".", import.meta.url));
    const distDir = resolve(here, "dist");
    restoreNodePrefixes(resolve(distDir, "index.js"));
    copyRuntimeAssets(distDir);
  },
  // The banner injects two things at the top of the bundle:
  //
  //   1. The Node shebang. The source `src/index.ts` intentionally does not
  //      carry its own shebang because the banner is the canonical place to
  //      emit it for the bundled CLI. (Having both produced two shebangs,
  //      which broke the ESM loader because line 2 was invalid JS syntax.)
  //
  //   2. A `createRequire(import.meta.url)` shim assigned to
  //      `globalThis.require`. Several bundled CJS deps (notably `yaml`,
  //      and `pg`-adjacent helpers) call `require("process")` /
  //      `require("buffer")` at module load. esbuild rewrites those into its
  //      `__require(...)` stub, whose fast path checks for a runtime global
  //      `require`. In ESM (`"type": "module"`) that global is absent, so
  //      without this shim the stub throws `Dynamic require of "process" is
  //      not supported` before the CLI even starts. Creating a real
  //      `require` and assigning it to `globalThis` makes the stub's
  //      `typeof require !== "undefined"` check succeed and fall through to
  //      the real Node resolver.
  banner: {
    js: [
      "#!/usr/bin/env node",
      'import { createRequire as __makoCreateRequire } from "node:module";',
      "globalThis.require = __makoCreateRequire(import.meta.url);",
    ].join("\n"),
  },
});
