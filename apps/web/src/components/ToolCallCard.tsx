/**
 * Collapsible card for a tool call + its result. Closed by default unless
 * the result is an error.
 *
 * The card is monochrome by default. Color only appears in the status
 * bar: success dot in `mk-ok`, failure dot in `mk-danger`. Preview data
 * is mono + muted.
 */

import { useState, type ReactNode } from "react";
import { safeJson } from "../lib/safe-json.js";
import { AnswerPacketCard, isAnswerResultShape } from "./AnswerPacketCard.js";
import { WorkflowPacketCard, isWorkflowPacketShape } from "./WorkflowPacketCard.js";

interface Props {
  call: { callId: string; tool: string; args: unknown; preview?: unknown };
  result?: { ok: boolean; summary?: unknown; error?: string; result?: unknown };
}

export function ToolCallCard({ call, result }: Props) {
  const errored = result ? !result.ok : false;
  const [open, setOpen] = useState<boolean>(errored);

  // Phase 3.6.0 Workstream D: answer tools + composers emit AnswerResult-shaped
  // packets. Dispatch to the styled card when we can identify that shape; fall
  // back to JSON for everything else. `result.summary ?? result` is the shape
  // emitted by the tool-bridge (see tool-bridge.ts).
  if (result && result.ok && !result.error) {
    const payload = result.summary ?? (result as unknown);
    if (isWorkflowPacketShape(payload)) {
      return (
        <WorkflowPacketCard
          toolName={call.tool}
          callId={call.callId}
          toolResult={payload}
          args={call.args}
        />
      );
    }
    if (isAnswerResultShape(payload)) {
      return (
        <AnswerPacketCard
          toolName={call.tool}
          callId={call.callId}
          toolResult={payload}
          args={call.args}
        />
      );
    }
  }

  return (
    <article className="overflow-hidden rounded-md border border-mk-current bg-mk-depth">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-mk-ridge"
        onClick={() => setOpen((v) => !v)}
      >
        <StatusDot
          state={
            result === undefined ? "pending" : result.ok ? "ok" : "error"
          }
        />
        <span className="font-mono text-[12px] text-mk-crest">{call.tool}</span>
        <span className="font-mono text-[10.5px] text-mk-tide">
          {call.callId.slice(0, 8)}
        </span>
        <span className="ml-auto font-mono text-[10.5px] text-mk-tide">
          {open ? "hide" : "show"}
        </span>
      </button>

      {open ? (
        <div className="border-t border-mk-current px-3 py-3">
          <Row label="args">
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-mk-surface">
              {safeJson(call.args)}
            </pre>
          </Row>

          {result !== undefined ? (
            <Row label="result">
              {result.error ? (
                <pre className="whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-mk-danger">
                  {result.error}
                </pre>
              ) : (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-mk-surface">
                  {safeJson(result.summary ?? result)}
                </pre>
              )}
            </Row>
          ) : (
            <Row label="result">
              <div className="font-mono text-[11px] italic text-mk-tide">awaiting...</div>
            </Row>
          )}
        </div>
      ) : null}
    </article>
  );
}

function StatusDot({ state }: { state: "ok" | "error" | "pending" }) {
  const bg =
    state === "ok" ? "bg-mk-ok" : state === "error" ? "bg-mk-danger" : "bg-mk-tide";
  return <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${bg}`} aria-hidden />;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mk-label mb-1">{label}</div>
      {children}
    </div>
  );
}
