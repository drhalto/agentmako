/**
 * Attach-project modal.
 *
 * Posts to `POST /api/v1/projects/attach` with a `projectRoot` absolute
 * path. Closes on success and invalidates the projects query so the
 * dashboard rerenders. Validation is light — the API does the real
 * work and returns a structured error if the path can't be attached.
 */

import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AttachedProject } from "../api-types";
import { post } from "../lib/http";

interface AttachProjectModalProps {
  open: boolean;
  onClose(): void;
  onAttached?(project: AttachedProject): void;
}

interface AttachResult {
  project: AttachedProject;
}

export function AttachProjectModal({
  open,
  onClose,
  onAttached,
}: AttachProjectModalProps) {
  const qc = useQueryClient();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [projectRoot, setProjectRoot] = useState("");

  const mutation = useMutation({
    mutationFn: (root: string) =>
      post<AttachResult>("/api/v1/projects/attach", { projectRoot: root }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      onAttached?.(data.project);
      setProjectRoot("");
      onClose();
    },
  });

  useEffect(() => {
    if (open) {
      // Defer focus until after the dialog mounts.
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
    mutation.reset();
    setProjectRoot("");
    return undefined;
    // mutation.reset is stable; intentionally omit to keep effect lean.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = projectRoot.trim();
    if (trimmed.length === 0 || mutation.isPending) return;
    mutation.mutate(trimmed);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="attach-project-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-mk-abyss/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[520px] rounded-md border border-mk-current bg-mk-depth shadow-xl"
      >
        <header className="border-b border-mk-current px-5 py-3">
          <h2 id="attach-project-title" className="text-[14px] text-mk-crest">
            Attach project
          </h2>
          <p className="mt-1 text-[12px] text-mk-tide">
            Point mako at the absolute path of a repo on this machine. The
            harness will create a project record and seed an initial index.
          </p>
        </header>

        <div className="space-y-3 p-5">
          <label htmlFor={inputId} className="mk-label block">
            project root
          </label>
          <input
            id={inputId}
            ref={inputRef}
            type="text"
            value={projectRoot}
            onChange={(e) => setProjectRoot(e.target.value)}
            placeholder="/Users/me/code/my-app"
            spellCheck={false}
            autoComplete="off"
            className="block h-9 w-full rounded-xs border border-mk-current bg-mk-abyss px-3 font-mono text-[12px] text-mk-crest placeholder:text-mk-tide focus:border-mk-signal-dim focus:outline-none"
          />
          <p className="font-mono text-[11px] text-mk-tide">
            Equivalent to <span className="text-mk-surface">agentmako project attach &lt;path&gt;</span>.
          </p>

          {mutation.isError ? (
            <div className="rounded-xs border border-mk-danger/40 bg-mk-abyss px-3 py-2 font-mono text-[11px] text-mk-danger">
              {(mutation.error as Error).message}
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-mk-current px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-xs border border-mk-current bg-mk-depth px-3 font-mono text-[11px] uppercase tracking-[0.08em] text-mk-surface hover:bg-mk-ridge"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={projectRoot.trim().length === 0 || mutation.isPending}
            className="h-8 rounded-xs bg-mk-crest px-3 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-mk-abyss transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {mutation.isPending ? "Attaching…" : "Attach"}
          </button>
        </footer>
      </form>
    </div>
  );
}
