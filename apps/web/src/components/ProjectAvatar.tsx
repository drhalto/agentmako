/**
 * ProjectAvatar — favicon-style icon for an attached project.
 *
 * The API decorates each project with `metadata.faviconUrl` when it
 * finds a favicon file in the project tree (see
 * `findProjectFavicon` in `services/api/src/service.ts`). The route
 * `GET /api/v1/projects/:projectId/favicon` streams the file from disk
 * with the right Content-Type. We render that here when present and
 * fall back to a deterministic coloured initial tile if either no
 * favicon is advertised or the image fails to load.
 */

import { useMemo, useState } from "react";
import type { AttachedProject } from "../api-types";

interface ProjectAvatarProps {
  project: AttachedProject;
  size?: number; // pixels, square
  className?: string;
}

const TILE_PALETTE: ReadonlyArray<{ bg: string; fg: string }> = [
  { bg: "#1f2937", fg: "#f8fafc" }, // slate
  { bg: "#0f172a", fg: "#e2e8f0" }, // deep slate
  { bg: "#1e3a8a", fg: "#dbeafe" }, // blue
  { bg: "#3730a3", fg: "#e0e7ff" }, // indigo
  { bg: "#5b21b6", fg: "#ede9fe" }, // violet
  { bg: "#831843", fg: "#fce7f3" }, // pink
  { bg: "#7c2d12", fg: "#ffedd5" }, // orange
  { bg: "#064e3b", fg: "#d1fae5" }, // emerald
  { bg: "#155e75", fg: "#cffafe" }, // cyan
  { bg: "#365314", fg: "#ecfccb" }, // lime
];

export function ProjectAvatar({ project, size = 36, className }: ProjectAvatarProps) {
  const [faviconBroken, setFaviconBroken] = useState(false);
  const faviconUrl = useMemo(() => readFaviconUrl(project), [project]);
  const tile = useMemo(() => pickTile(project.projectId), [project.projectId]);
  const initial = useMemo(() => deriveInitial(project.displayName), [project.displayName]);

  const radius = Math.max(4, Math.round(size / 6));
  const fontPx = Math.max(11, Math.round(size * 0.42));

  const showFavicon = faviconUrl !== null && !faviconBroken;

  if (showFavicon) {
    return (
      <span
        className={["relative flex shrink-0 items-center justify-center overflow-hidden", className]
          .filter(Boolean)
          .join(" ")}
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          background: tile.bg,
        }}
        aria-hidden
      >
        <img
          src={faviconUrl}
          alt=""
          width={Math.round(size * 0.7)}
          height={Math.round(size * 0.7)}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFaviconBroken(true)}
          style={{ display: "block" }}
        />
      </span>
    );
  }

  return (
    <span
      className={["flex shrink-0 items-center justify-center select-none", className]
        .filter(Boolean)
        .join(" ")}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: tile.bg,
        color: tile.fg,
        fontSize: fontPx,
        fontWeight: 600,
        lineHeight: 1,
        letterSpacing: "-0.02em",
      }}
      aria-hidden
      title={project.displayName}
    >
      {initial}
    </span>
  );
}

// =============================================================================
// helpers
// =============================================================================

function readFaviconUrl(project: AttachedProject): string | null {
  const metadata = (project.metadata ?? {}) as Record<string, unknown>;
  const value = metadata.faviconUrl;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function deriveInitial(displayName: string): string {
  const trimmed = displayName.trim();
  if (trimmed.length === 0) return "·";
  // Strip common noise prefixes so "@scope/pkg" → "p", "lets-read-georgia" → "L".
  const cleaned = trimmed.replace(/^@[^/]+\//, "");
  const first = cleaned[0];
  if (!first) return "·";
  return first.toUpperCase();
}

function pickTile(projectId: string): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < projectId.length; i += 1) {
    hash = (hash * 31 + projectId.charCodeAt(i)) >>> 0;
  }
  return TILE_PALETTE[hash % TILE_PALETTE.length]!;
}
