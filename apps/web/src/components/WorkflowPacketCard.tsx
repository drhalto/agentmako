import {
  WorkflowPacketToolOutputSchema,
  WorkflowPacketSurfaceSchema,
  type WorkflowPacketSurface,
} from "@mako-ai/contracts";
import { useState } from "react";
import { safeJson } from "../lib/safe-json.js";

interface WorkflowPacketToolResult {
  projectId: string;
  result: WorkflowPacketSurface;
}

export function isWorkflowPacketShape(value: unknown): value is WorkflowPacketToolResult {
  const parsed = WorkflowPacketToolOutputSchema.safeParse(value);
  if (parsed.success) {
    return true;
  }

  if (value == null || typeof value !== "object") return false;
  const candidate = value as { toolName?: unknown; projectId?: unknown; result?: unknown };
  return (
    candidate.toolName === "workflow_packet" &&
    typeof candidate.projectId === "string" &&
    WorkflowPacketSurfaceSchema.safeParse(candidate.result).success
  );
}

interface Props {
  toolName: string;
  callId: string;
  toolResult: WorkflowPacketToolResult;
  args: unknown;
}

export function WorkflowPacketCard({ toolName, callId, toolResult, args }: Props) {
  const [open, setOpen] = useState<boolean>(false);
  const { result } = toolResult;
  const triggerCount = result.watch.refreshTriggers.length;

  return (
    <article className="overflow-hidden rounded-md border border-mk-current bg-mk-depth">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-mk-ridge"
        onClick={() => setOpen((value) => !value)}
      >
        <span
          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
            result.watch.mode === "watch" ? "bg-mk-warn" : "bg-mk-ok"
          }`}
          aria-hidden
        />
        <span className="font-mono text-[12px] text-mk-crest">{toolName}</span>
        <span className="font-mono text-[10.5px] text-mk-tide">{callId.slice(0, 8)}</span>
        <span className="font-mono text-[10.5px] text-mk-tide">
          {result.packet.family} | {result.watch.mode} | {triggerCount} trigger{triggerCount === 1 ? "" : "s"}
        </span>
        <span className="ml-auto font-mono text-[10.5px] text-mk-tide">{open ? "hide" : "show"}</span>
      </button>

      {open ? (
        <div className="border-t border-mk-current px-3 py-3">
          <div className="mb-3 space-y-2">
            <div className="rounded border border-mk-current bg-mk-abyss px-3 py-2">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="mk-label">packet</span>
                <span className="rounded bg-mk-ridge px-1.5 py-0.5 font-mono text-[10.5px] text-mk-surface">
                  {result.packet.family}
                </span>
                <span className="rounded bg-mk-ridge px-1.5 py-0.5 font-mono text-[10.5px] text-mk-tide">
                  {result.packet.packetId.slice(0, 16)}
                </span>
              </div>
              <div className="font-mono text-[10.5px] text-mk-tide">
                generate={result.surfacePlan.generateWith} guided=
                {result.surfacePlan.guidedConsumption ?? "none"} reusable=
                {result.surfacePlan.reusableContext ?? "none"}
              </div>
              <div className="mt-1 font-mono text-[10.5px] text-mk-tide">
                watch={result.watch.mode} reason={result.watch.refreshReason}
              </div>
            </div>

            {result.handoff ? (
              <section className="rounded border border-mk-current bg-mk-abyss px-3 py-2">
                <h4 className="mk-label mb-1">handoff</h4>
                <div className="space-y-1 font-mono text-[10.5px] leading-relaxed text-mk-surface">
                  <div>
                    <span className="text-mk-tide">CURRENT:</span> {result.handoff.current}
                  </div>
                  <div>
                    <span className="text-mk-tide">STOP WHEN:</span> {result.handoff.stopWhen}
                  </div>
                  {result.handoff.refreshWhen ? (
                    <div>
                      <span className="text-mk-tide">REFRESH WHEN:</span> {result.handoff.refreshWhen}
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}

            {result.watch.refreshTriggers.length > 0 ? (
              <section className="rounded border border-mk-current bg-mk-abyss px-3 py-2">
                <h4 className="mk-label mb-1 flex items-center gap-2">
                  <span>refresh triggers</span>
                  <span className="font-mono text-[10.5px] text-mk-tide">{result.watch.refreshTriggers.length}</span>
                </h4>
                <ul className="space-y-1">
                  {result.watch.refreshTriggers.slice(0, 6).map((trigger) => (
                    <li key={trigger} className="font-mono text-[10.5px] text-mk-surface">
                      - {trigger}
                    </li>
                  ))}
                  {result.watch.refreshTriggers.length > 6 ? (
                    <li className="font-mono text-[10.5px] italic text-mk-tide">
                      + {result.watch.refreshTriggers.length - 6} more not shown
                    </li>
                  ) : null}
                </ul>
              </section>
            ) : null}
          </div>

          <div className="rounded border border-mk-current bg-mk-abyss px-3 py-2">
            <div className="mk-label mb-1">rendered</div>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-mk-surface">
              {result.rendered}
            </pre>
          </div>

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
