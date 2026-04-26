/**
 * Selected-project hook — URL slug is the source of truth.
 *
 * Every app route lives under `/:slug/…` where slug is either a
 * per-project kebab-slug derived from displayName, or the reserved
 * literal `all` (meaning "all attached projects"). Changing scope
 * navigates to the same sub-path under a new slug, so the scope is
 * deep-linkable and survives reload without localStorage.
 *
 * localStorage is only used to remember the last-used slug for the
 * root redirect `/ → /<lastSlug>`.
 */

import { useCallback, useMemo } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { get } from "../lib/http";
import type { AttachedProject } from "../api-types";

export const ALL_PROJECTS_SLUG = "all";
const LAST_SLUG_STORAGE_KEY = "mako.lastProjectSlug";

/**
 * Routes that live outside the `/:slug/…` scope because they configure
 * machine-global state (API keys, catalog, harness defaults, usage
 * telemetry). `scopedPath` leaves these unchanged so nav links and
 * redirects point at the unscoped URL.
 */
const GLOBAL_ROUTE_PREFIXES = ["/providers", "/usage"] as const;

function isGlobalPath(path: string): boolean {
  return GLOBAL_ROUTE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

interface SelectedProject {
  projects: AttachedProject[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  slug: string | null;
  /**
   * Best guess at "which project scope am I in right now" even when the
   * URL itself has no slug (e.g. on `/providers` or `/usage`). Falls
   * back to the last-used slug, the first attached project, then
   * `all`. Use this for picker labels and scoped link construction.
   */
  effectiveSlug: string;
  selectedProject: AttachedProject | null;
  selectedProjectId: string | null;
  projectBySlug: Map<string, AttachedProject>;
  slugByProjectId: Map<string, string>;
  scopedPath(path: string): string;
  selectProject(projectId: string | null): void;
}

export function useSelectedProject(): SelectedProject {
  const params = useParams<{ slug?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const slug = params.slug ?? null;

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => get<AttachedProject[]>("/api/v1/projects"),
    refetchInterval: 30_000,
  });

  const projects = useMemo(
    () => projectsQuery.data ?? [],
    [projectsQuery.data],
  );

  const { projectBySlug, slugByProjectId } = useMemo(
    () => computeSlugMap(projects),
    [projects],
  );

  const effectiveSlug =
    slug ??
    readStoredSlug() ??
    slugByProjectId.get(projects[0]?.projectId ?? "") ??
    ALL_PROJECTS_SLUG;

  const selectedProject =
    effectiveSlug !== ALL_PROJECTS_SLUG
      ? projectBySlug.get(effectiveSlug) ?? null
      : null;
  const selectedProjectId = selectedProject?.projectId ?? null;

  const scopedPath = useCallback(
    (path: string) => {
      const clean = path.startsWith("/") ? path : `/${path}`;
      if (isGlobalPath(clean)) return clean;
      if (clean === "/") return `/${effectiveSlug}`;
      return `/${effectiveSlug}${clean}`;
    },
    [effectiveSlug],
  );

  const selectProject = useCallback(
    (projectId: string | null) => {
      const nextSlug =
        projectId === null ? ALL_PROJECTS_SLUG : slugByProjectId.get(projectId);
      if (!nextSlug) return;
      writeStoredSlug(nextSlug);
      if (slug) {
        // Scoped route — replace the first path segment, preserve the
        // rest so the user stays on (e.g.) `/agent/:id` just under a
        // different project.
        const segments = location.pathname.split("/").filter(Boolean);
        segments[0] = nextSlug;
        navigate(
          `/${segments.join("/")}${location.search}${location.hash}`,
        );
        return;
      }
      // Unscoped route (e.g. `/providers`) — jump to the new project's
      // dashboard. Staying in place would silently drift the effective
      // slug, which is surprising when the picker visibly changes.
      navigate(`/${nextSlug}${location.search}${location.hash}`);
    },
    [slug, slugByProjectId, location.pathname, location.search, location.hash, navigate],
  );

  return {
    projects,
    isLoading: projectsQuery.isLoading,
    isError: projectsQuery.isError,
    error: projectsQuery.error,
    slug,
    effectiveSlug,
    selectedProject,
    selectedProjectId,
    projectBySlug,
    slugByProjectId,
    scopedPath,
    selectProject,
  };
}

/**
 * One-shot read of the attached-projects list for components that need
 * to redirect BEFORE a `:slug` route is mounted (so useParams isn't
 * available yet). Uses the same react-query cache key so it dedupes
 * with the main hook.
 */
export function useAttachedProjectsQuery() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: () => get<AttachedProject[]>("/api/v1/projects"),
    refetchInterval: 30_000,
  });
}

export function readStoredSlug(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(LAST_SLUG_STORAGE_KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeStoredSlug(slug: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_SLUG_STORAGE_KEY, slug);
  } catch {
    /* noop */
  }
}

export function computeSlugMap(projects: AttachedProject[]): {
  projectBySlug: Map<string, AttachedProject>;
  slugByProjectId: Map<string, string>;
} {
  const projectBySlug = new Map<string, AttachedProject>();
  const slugByProjectId = new Map<string, string>();

  // First pass: group by base slug to detect collisions and the
  // reserved `all` slug.
  const baseGroups = new Map<string, AttachedProject[]>();
  for (const p of projects) {
    const base = baseSlugOf(p);
    const key = base === ALL_PROJECTS_SLUG ? `${base}-x` : base;
    const bucket = baseGroups.get(key) ?? [];
    bucket.push(p);
    baseGroups.set(key, bucket);
  }

  for (const [base, group] of baseGroups) {
    if (group.length === 1) {
      const only = group[0]!;
      projectBySlug.set(base, only);
      slugByProjectId.set(only.projectId, base);
      continue;
    }
    // Collision — suffix each with a short id so every project gets a
    // stable, unique slug.
    for (const p of group) {
      const slug = `${base}-${shortId(p)}`;
      projectBySlug.set(slug, p);
      slugByProjectId.set(p.projectId, slug);
    }
  }

  return { projectBySlug, slugByProjectId };
}

function baseSlugOf(p: AttachedProject): string {
  const cleaned = p.displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : "project";
}

function shortId(p: AttachedProject): string {
  const match = /project_([0-9a-f]{4,8})/.exec(p.projectId);
  if (match?.[1]) return match[1].slice(0, 6);
  return p.projectId.slice(-6);
}
