import type { AgentClient } from "../agent-clients/types.js";
import type { McpProgressPayload, ProgressEvent, ProgressReporter } from "./types.js";

export interface McpProgressNotification {
  method: "notifications/progress";
  params: McpProgressPayload & {
    progressToken: string | number;
  };
}

export function createMcpProgressReporter(options: {
  sendNotification: (notification: McpProgressNotification) => Promise<void> | void;
  progressToken: string | number;
  client: AgentClient;
  logger?: (msg: string, err?: unknown) => void;
}): ProgressReporter {
  // MCP spec requires `progress` to be a number, and some clients
  // deduplicate consecutive events that share the same value. Stage-only
  // events (no `current`) would otherwise all emit `progress: 0` and
  // collapse. Assign a per-reporter monotonic tick as the fallback so each
  // emission advances the counter visibly. Explicit `current` from the
  // caller always wins — tools with natural iteration keep their own math.
  let tick = 0;
  return {
    async report(event: ProgressEvent): Promise<void> {
      tick += 1;
      const effectiveEvent: ProgressEvent =
        typeof event.current === "number" ? event : { ...event, current: tick };

      let payload: McpProgressPayload;
      try {
        payload = options.client.progressShape(effectiveEvent);
      } catch (error) {
        options.logger?.("progress.shape-failed", error);
        return;
      }

      try {
        const notification: McpProgressNotification = {
          method: "notifications/progress",
          params: {
            progressToken: options.progressToken,
            ...payload,
          },
        };
        await options.sendNotification(notification);
      } catch (error) {
        options.logger?.("progress.emit-failed", error);
      }
    },
  };
}
