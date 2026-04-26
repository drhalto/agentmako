import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface ExternalToolRunner {
  command: string;
  argsPrefix: string[];
  display: string;
}

export function slashPath(value: string): string {
  return value.replace(/\\/g, "/");
}

export function isWithinRoot(root: string, candidate: string): boolean {
  const relativePath = path.relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

export function resolveProjectPath(projectRoot: string, candidate: string): string | null {
  const absolutePath = path.resolve(projectRoot, candidate);
  if (!isWithinRoot(projectRoot, absolutePath)) {
    return null;
  }
  return slashPath(path.relative(projectRoot, absolutePath));
}

export function resolveLocalToolRunner(
  projectRoot: string,
  options: {
    binName: string;
    jsEntryCandidates?: string[];
  },
): ExternalToolRunner | null {
  for (const candidate of options.jsEntryCandidates ?? []) {
    const absolute = path.join(projectRoot, candidate);
    if (existsSync(absolute)) {
      return {
        command: process.execPath,
        argsPrefix: [absolute],
        display: `node ${slashPath(path.relative(projectRoot, absolute))}`,
      };
    }
  }

  const binName = process.platform === "win32" ? `${options.binName}.cmd` : options.binName;
  const binPath = path.join(projectRoot, "node_modules", ".bin", binName);
  if (existsSync(binPath)) {
    return {
      command: binPath,
      argsPrefix: [],
      display: slashPath(path.relative(projectRoot, binPath)),
    };
  }

  return null;
}

export function resolvePackageScriptRunner(
  projectRoot: string,
  options: {
    scriptNames: readonly string[];
    requestedScriptName?: string;
  },
): ExternalToolRunner | null {
  const packageJsonPath = path.join(projectRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    return null;
  }
  let scripts: Record<string, unknown>;
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { scripts?: Record<string, unknown> };
    scripts = packageJson.scripts ?? {};
  } catch {
    return null;
  }
  const scriptName = options.requestedScriptName ?? options.scriptNames.find((candidate) =>
    typeof scripts[candidate] === "string"
  );
  if (!scriptName || typeof scripts[scriptName] !== "string") {
    return null;
  }

  const nodeDir = path.dirname(process.execPath);
  const npmCli = path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js");
  if (existsSync(npmCli)) {
    return {
      command: process.execPath,
      argsPrefix: [npmCli, "run", "-s", scriptName, "--"],
      display: `npm run -s ${scriptName} --`,
    };
  }
  return {
    command: process.platform === "win32" ? path.join(nodeDir, "npm.cmd") : "npm",
    argsPrefix: ["run", "-s", scriptName, "--"],
    display: `npm run -s ${scriptName} --`,
  };
}
