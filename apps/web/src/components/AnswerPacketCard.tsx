/**
 * AnswerPacketCard - renders an AnswerResult produced by an answer tool or
 * composer as a styled evidence panel with Shiki-highlighted code blocks,
 * grouped evidence by kind, and staleness/missing-info signals.
 *
 * Phase 3.6.0 Workstream D. `ToolCallCard` dispatches to this component when
 * a tool result matches the shared answer-result shape; falls back to the JSON
 * dump for everything else.
 */

import {
  AnswerResultSchema,
  type AnswerResult,
  type AnswerSurfaceIssue,
  type AnswerTrustState,
  type EvidenceBlock,
} from "@mako-ai/contracts";
import { useEffect, useState } from "react";
import { safeJson } from "../lib/safe-json.js";
import { highlightToHtml } from "../lib/shiki.js";

interface AnswerToolResult {
  projectId: string;
  result: AnswerResult;
}

export function isAnswerResultShape(value: unknown): value is AnswerToolResult {
  if (value == null || typeof value !== "object") return false;
  const candidate = value as { projectId?: unknown; result?: unknown };
  return typeof candidate.projectId === "string" && AnswerResultSchema.safeParse(candidate.result).success;
}

interface Props {
  toolName: string;
  callId: string;
  toolResult: AnswerToolResult;
  args: unknown;
}

export function AnswerPacketCard({ toolName, callId, toolResult, args }: Props) {
  const { result } = toolResult;
  const { packet } = result;
  const [open, setOpen] = useState<boolean>(false);

  const grouped = groupEvidenceByKind(packet.evidence);
  const confidencePct = Math.round((result.answerConfidence ?? packet.evidenceConfidence ?? 0) * 100);
  const diagnostics = result.diagnostics ?? [];
  const companionPacket = result.companionPacket;
  const candidateActions = result.candidateActions ?? [];

  return (
    <article className="overflow-hidden rounded-md border border-mk-current bg-mk-depth">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-mk-ridge"
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
            result.evidenceStatus === "complete" ? "bg-mk-ok" : "bg-mk-warn"
          }`}
          aria-hidden
        />
        <span className="font-mono text-[12px] text-mk-crest">{toolName}</span>
        <span className="font-mono text-[10.5px] text-mk-tide">{callId.slice(0, 8)}</span>
        <span className="font-mono text-[10.5px] text-mk-tide">
          {packet.evidence.length} block{packet.evidence.length === 1 ? "" : "s"} | {confidencePct}%
        </span>
        <span className="ml-auto font-mono text-[10.5px] text-mk-tide">{open ? "hide" : "show"}</span>
      </button>

      {open ? (
        <div className="border-t border-mk-current px-3 py-3">
          {result.answer ? (
            <div className="mb-3 rounded border border-mk-current bg-mk-abyss px-3 py-2 text-[12.5px] leading-relaxed text-mk-surface">
              {result.answer}
            </div>
          ) : null}

          {result.trust || result.ranking || diagnostics.length > 0 ? (
            <div className="mb-3 space-y-2">
              {result.trust ? (
                <div className="rounded border border-mk-current bg-mk-abyss px-3 py-2">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="mk-label">trust</span>
                    <span className={`rounded px-1.5 py-0.5 font-mono text-[10.5px] ${trustStateClass(result.trust.state)}`}>
                      {result.trust.state}
                    </span>
                    {result.ranking?.deEmphasized ? (
                      <span className="rounded bg-mk-warn/20 px-1.5 py-0.5 font-mono text-[10.5px] text-mk-warn">
                        de-emphasized
                      </span>
                    ) : null}
                  </div>
                  {result.trust.reasons.length > 0 ? (
                    <div className="font-mono text-[10.5px] text-mk-tide">
                      reasons: {result.trust.reasons.map((reason) => reason.code).join(", ")}
                    </div>
                  ) : null}
                  {result.trust.comparisonSummary.length > 0 ? (
                    <div className="mt-1 font-mono text-[10.5px] text-mk-tide">
                      compare: {result.trust.comparisonSummary.map((change) => change.code).join(", ")}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {diagnostics.length > 0 ? (
                <section className="rounded border border-mk-current bg-mk-abyss px-3 py-2">
                  <h4 className="mk-label mb-1 flex items-center gap-2">
                    <span>diagnostics</span>
                    <span className="font-mono text-[10.5px] text-mk-tide">{diagnostics.length}</span>
                  </h4>
                  <ul className="space-y-1">
                    {diagnostics.slice(0, 6).map((issue) => (
                      <li key={issue.identity.matchBasedId}>
                        <DiagnosticRow issue={issue} />
                      </li>
                    ))}
                    {diagnostics.length > 6 ? (
                      <li className="font-mono text-[10.5px] italic text-mk-tide">
                        + {diagnostics.length - 6} more not shown
                      </li>
                    ) : null}
                  </ul>
                </section>
              ) : null}

              {companionPacket ? (
                <section className="rounded border border-mk-current bg-mk-abyss px-3 py-2">
                  <h4 className="mk-label mb-1 flex items-center gap-2">
                    <span>workflow packet</span>
                    <span className="font-mono text-[10.5px] text-mk-tide">{companionPacket.packet.family}</span>
                  </h4>
                  {companionPacket.attachmentReason ? (
                    <p className="mb-2 text-[11px] text-mk-tide">{companionPacket.attachmentReason}</p>
                  ) : null}
                  {companionPacket.handoff ? (
                    <div className="space-y-1 font-mono text-[10.5px] leading-relaxed text-mk-surface">
                      <div>
                        <span className="text-mk-tide">CURRENT:</span> {companionPacket.handoff.current}
                      </div>
                      <div>
                        <span className="text-mk-tide">STOP WHEN:</span> {companionPacket.handoff.stopWhen}
                      </div>
                      {companionPacket.handoff.refreshWhen ? (
                        <div>
                          <span className="text-mk-tide">REFRESH WHEN:</span> {companionPacket.handoff.refreshWhen}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[10.5px] leading-relaxed text-mk-surface">
                      {companionPacket.rendered}
                    </pre>
                  )}
                </section>
              ) : null}

              {candidateActions.length > 0 ? (
                <section className="rounded border border-mk-current bg-mk-abyss px-3 py-2">
                  <h4 className="mk-label mb-1 flex items-center gap-2">
                    <span>next actions</span>
                    <span className="font-mono text-[10.5px] text-mk-tide">{candidateActions.length}</span>
                  </h4>
                  <ul className="space-y-1.5">
                    {candidateActions.slice(0, 5).map((action) => (
                      <li key={action.actionId} className="rounded border border-mk-current px-2 py-1.5">
                        <div className="font-mono text-[10.5px] text-mk-surface">{action.label}</div>
                        <div className="mt-1 text-[11px] leading-relaxed text-mk-tide">{action.description}</div>
                        {action.execute ? (
                          <div className="mt-1 font-mono text-[10px] text-mk-tide">
                            executes {action.execute.toolName}
                          </div>
                        ) : null}
                      </li>
                    ))}
                    {candidateActions.length > 5 ? (
                      <li className="font-mono text-[10.5px] italic text-mk-tide">
                        + {candidateActions.length - 5} more not shown
                      </li>
                    ) : null}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : null}

          {packet.stalenessFlags.length > 0 || packet.missingInformation.length > 0 ? (
            <div className="mb-3 rounded border border-mk-warn bg-mk-abyss px-3 py-2 text-[11px] text-mk-warn">
              {packet.stalenessFlags.length > 0 ? (
                <div>Staleness: {packet.stalenessFlags.join(", ")}</div>
              ) : null}
              {packet.missingInformation.length > 0 ? (
                <div>Missing: {packet.missingInformation.join(" | ")}</div>
              ) : null}
            </div>
          ) : null}

          {Object.entries(grouped).map(([kind, blocks]) => (
            <section key={kind} className="mb-3 last:mb-0">
              <h4 className="mk-label mb-1 flex items-center gap-2">
                <span>{labelForKind(kind)}</span>
                <span className="font-mono text-[10.5px] text-mk-tide">{blocks.length}</span>
              </h4>
              <ul className="space-y-1.5">
                {blocks.slice(0, 20).map((block) => (
                  <li key={block.blockId}>
                    <EvidenceRow block={block} />
                  </li>
                ))}
                {blocks.length > 20 ? (
                  <li className="font-mono text-[10.5px] italic text-mk-tide">
                    + {blocks.length - 20} more not shown
                  </li>
                ) : null}
              </ul>
            </section>
          ))}

          <details className="mt-3 text-[10.5px] text-mk-tide">
            <summary className="cursor-pointer font-mono">raw args</summary>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10.5px] text-mk-surface">
              {safeJson(args)}
            </pre>
          </details>
        </div>
      ) : null}
    </article>
  );
}

function DiagnosticRow({ issue }: { issue: AnswerSurfaceIssue }) {
  const location = issue.path
    ? `${issue.path}${typeof issue.line === "number" ? `:L${issue.line}` : ""}`
    : null;
  return (
    <div className="rounded border border-mk-current px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-2 font-mono text-[10.5px]">
        <span className={`rounded px-1.5 py-0.5 ${issueSeverityClass(issue.severity)}`}>{issue.severity}</span>
        <span className="text-mk-surface">{issue.code}</span>
        {location ? <span className="text-mk-tide">{location}</span> : null}
      </div>
      <div className="mt-1 text-[11px] text-mk-surface">{issue.message}</div>
    </div>
  );
}

function EvidenceRow({ block }: { block: EvidenceBlock }) {
  const showCode = block.kind === "symbol" || block.kind === "file";
  return (
    <div className="rounded border border-mk-current px-2 py-1.5">
      <div className="flex items-baseline gap-2 font-mono text-[11px]">
        <span className="text-mk-surface">{block.title}</span>
        <span className="text-mk-tide">{block.sourceRef}</span>
        {block.line ? <span className="text-mk-tide">:L{block.line}</span> : null}
        {block.stale ? <span className="text-mk-warn">stale</span> : null}
      </div>
      {showCode && block.content.trim().length > 0 ? (
        <CodeSnippet code={block.content} filePath={block.filePath} />
      ) : block.content.trim().length > 0 ? (
        <div className="mt-1 font-mono text-[10.5px] leading-relaxed text-mk-surface">
          {truncate(block.content, 400)}
        </div>
      ) : null}
    </div>
  );
}

function CodeSnippet({ code, filePath }: { code: string; filePath?: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    highlightToHtml(truncate(code, 1800), filePath)
      .then((out) => {
        if (!canceled) setHtml(out);
      })
      .catch(() => {
        if (!canceled) setHtml(null);
      });
    return () => {
      canceled = true;
    };
  }, [code, filePath]);

  if (html != null) {
    return (
      <div
        className="mt-1 overflow-auto rounded border border-mk-current bg-mk-abyss p-2 text-[10.5px] [&>pre]:!bg-transparent"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[10.5px] text-mk-surface">
      {truncate(code, 1800)}
    </pre>
  );
}

function groupEvidenceByKind(evidence: EvidenceBlock[]): Record<string, EvidenceBlock[]> {
  const groups: Record<string, EvidenceBlock[]> = {};
  for (const block of evidence) {
    groups[block.kind] = groups[block.kind] ?? [];
    groups[block.kind].push(block);
  }
  return groups;
}

function labelForKind(kind: string): string {
  switch (kind) {
    case "file":
      return "Files";
    case "symbol":
      return "Symbols";
    case "route":
      return "Routes";
    case "schema":
      return "Schema";
    case "finding":
      return "Findings";
    case "trace":
      return "Traces";
    case "document":
      return "Documents";
    default:
      return kind;
  }
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

function trustStateClass(state: AnswerTrustState): string {
  switch (state) {
    case "stable":
      return "bg-mk-ok/20 text-mk-ok";
    case "changed":
    case "aging":
      return "bg-mk-warn/20 text-mk-warn";
    default:
      return "bg-mk-danger/20 text-mk-danger";
  }
}

function issueSeverityClass(severity: AnswerSurfaceIssue["severity"]): string {
  switch (severity) {
    case "critical":
    case "high":
      return "bg-mk-danger/20 text-mk-danger";
    case "medium":
      return "bg-mk-warn/20 text-mk-warn";
    default:
      return "bg-mk-ridge text-mk-tide";
  }
}
