import {
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";
import { Shell } from "./components/Shell";
import { HomePage } from "./pages/Home";
import { AgentPage } from "./pages/Agent";
import { ProvidersPage } from "./pages/Providers";
import { MemoryPage } from "./pages/Memory";
import { SearchPage } from "./pages/Search";
import { UsagePage } from "./pages/Usage";
import { HealthPage } from "./pages/Health";
import { ArtifactsPage } from "./pages/Artifacts";
import { ToolsPage } from "./pages/Tools";
import {
  ALL_PROJECTS_SLUG,
  computeSlugMap,
  readStoredSlug,
  useAttachedProjectsQuery,
} from "./hooks/useSelectedProject";
import { ThemeProvider } from "./hooks/useTheme";

export function App() {
  return (
    <ThemeProvider>
      <Routes>
        {/* Single layout route so the Shell persists across both global
            (`/providers`, `/usage`) and scoped (`/:slug/…`) pages. */}
        <Route element={<ScopedShell />}>
          <Route path="/providers" element={<ProvidersPage />} />
          <Route path="/usage" element={<UsagePage />} />
          <Route path="/:slug" element={<HomePage />} />
          <Route path="/:slug/agent" element={<AgentPage />} />
          <Route path="/:slug/agent/:sessionId" element={<AgentPage />} />
          <Route path="/:slug/health" element={<HealthPage />} />
          <Route path="/:slug/artifacts" element={<ArtifactsPage />} />
          <Route path="/:slug/tools" element={<ToolsPage />} />
          <Route path="/:slug/memory" element={<MemoryPage />} />
          <Route path="/:slug/search" element={<SearchPage />} />
        </Route>
        <Route path="/" element={<ProjectRedirect />} />
        <Route path="/sessions" element={<Navigate to="/agent" replace />} />
        <Route path="/sessions/:sessionId" element={<LegacySessionRedirect />} />
        <Route path="*" element={<ProjectRedirect />} />
      </Routes>
    </ThemeProvider>
  );
}

function ScopedShell() {
  return (
    <Shell>
      <Outlet />
    </Shell>
  );
}

/**
 * Resolve an unslugged project-scoped path to a slugged one. Picks the
 * last-used slug, falling back to the first attached project, then to
 * `all`.
 */
function ProjectRedirect() {
  const location = useLocation();
  const { data, isLoading } = useAttachedProjectsQuery();
  if (isLoading) return null;
  const projects = data ?? [];
  const { projectBySlug, slugByProjectId } = computeSlugMap(projects);

  const stored = readStoredSlug();
  let slug: string | null = null;
  if (stored === ALL_PROJECTS_SLUG || (stored && projectBySlug.has(stored))) {
    slug = stored;
  } else if (projects.length > 0) {
    slug = slugByProjectId.get(projects[0]!.projectId) ?? null;
  } else {
    slug = ALL_PROJECTS_SLUG;
  }

  const rest = location.pathname === "/" ? "" : location.pathname;
  return (
    <Navigate
      to={`/${slug}${rest}${location.search}${location.hash}`}
      replace
    />
  );
}

function LegacySessionRedirect() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return (
    <Navigate to={sessionId ? `/agent/${sessionId}` : "/agent"} replace />
  );
}
