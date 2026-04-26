import type { McpProgressPayload, ProgressEvent } from "../progress/types.js";

export function toMcpProgressPayload(event: ProgressEvent): McpProgressPayload {
  const progress = typeof event.current === "number" ? event.current : 0;
  const payload: McpProgressPayload = { progress };
  if (typeof event.total === "number") {
    payload.total = event.total;
  }
  payload.message = event.message ? `${event.stage}: ${event.message}` : event.stage;
  return payload;
}

