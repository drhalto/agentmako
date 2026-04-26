import fs from "node:fs";
import path from "node:path";
import type {
  ArtifactBase,
  ArtifactExportFileRequest,
  ArtifactExportResult,
  ArtifactExportedFile,
  ArtifactKind,
  ArtifactRenderFormat,
} from "@mako-ai/contracts";

const DEFAULT_EXPORT_ROOT = ".mako/artifacts";

const FORMAT_EXTENSIONS: Record<ArtifactRenderFormat, string> = {
  json: "json",
  markdown: "md",
  text: "txt",
};

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

// Resolve `candidate` against `projectRoot` and assert the result does not
// escape the project root via `..` or an absolute path. Returns the absolute
// resolved path for the caller to use with `fs` APIs.
function resolveInsideProject(projectRoot: string, candidate: string): string {
  const absoluteRoot = path.resolve(projectRoot);
  const absolute = path.resolve(absoluteRoot, candidate);
  const rel = path.relative(absoluteRoot, absolute);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `artifact export path \`${candidate}\` resolves outside project root \`${projectRoot}\``,
    );
  }
  return absolute;
}

function atomicWrite(absolutePath: string, body: string): void {
  const dir = path.dirname(absolutePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${absolutePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, body, "utf8");
  fs.renameSync(tmpPath, absolutePath);
}

export function exportArtifactToFile(
  artifact: ArtifactBase<ArtifactKind, unknown>,
  projectRoot: string,
  request: ArtifactExportFileRequest = {},
): ArtifactExportResult {
  const directory = request.directory ?? `${DEFAULT_EXPORT_ROOT}/${artifact.kind}`;
  const targetDirectory = resolveInsideProject(projectRoot, directory);

  const renderingsByFormat = new Map<ArtifactRenderFormat, string>();
  for (const rendering of artifact.renderings) {
    if (!renderingsByFormat.has(rendering.format)) {
      renderingsByFormat.set(rendering.format, rendering.body);
    }
  }

  const requestedFormats =
    request.formats && request.formats.length > 0
      ? request.formats
      : [...renderingsByFormat.keys()];

  const missing = requestedFormats.filter((format) => !renderingsByFormat.has(format));
  if (missing.length > 0) {
    throw new Error(
      `artifact ${artifact.artifactId} has no rendering for requested format(s): ${missing.join(", ")}`,
    );
  }

  const absoluteRoot = path.resolve(projectRoot);
  const files: ArtifactExportedFile[] = [];
  for (const format of requestedFormats) {
    const body = renderingsByFormat.get(format);
    if (body === undefined) continue;
    const filename = `${artifact.artifactId}.${FORMAT_EXTENSIONS[format]}`;
    const absolute = path.join(targetDirectory, filename);
    // Defense-in-depth: re-check the final resolved path. `directory` already
    // passed the guard, but a filename is still caller-influenced via
    // artifactId, so re-verify before any write hits disk.
    resolveInsideProject(projectRoot, absolute);
    atomicWrite(absolute, body);
    files.push({
      format,
      path: toPosix(path.relative(absoluteRoot, absolute)),
    });
  }

  return { files };
}
