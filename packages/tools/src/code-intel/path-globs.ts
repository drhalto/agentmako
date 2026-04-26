import picomatch from "picomatch";

export function normalizePathForGlob(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

export function matchesPathGlob(filePath: string, glob: string): boolean {
  const normalizedPath = normalizePathForGlob(filePath);
  const normalizedGlob = normalizePathForGlob(glob);
  const matcher = picomatch(normalizedGlob, {
    dot: true,
    nobrace: true,
    noextglob: true,
    nonegate: true,
  });
  return matcher(normalizedPath);
}
