/**
 * Mako dashboard entry.
 *
 * Boots a React Query client, installs the router, and mounts the shell.
 * Every transport call goes through relative `/api/v1/*` URLs so Vite's
 * dev proxy (or the production static-serve of `dist/`) can handle routing
 * to `services/api` vs `services/harness` without the client caring.
 */

import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App";
import "./styles/globals.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Dev tools work mostly-read; cache is a helper, not a source of truth.
      staleTime: 5_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const root = document.getElementById("root");
if (!root) {
  throw new Error("mako: #root element missing from index.html");
}

createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
