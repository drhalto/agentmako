import type { IndexRunStatus, JsonObject, Timestamp } from "./common.js";

export interface IndexRunSummary {
  runId: string;
  projectId: string;
  status: IndexRunStatus;
  triggerSource: string;
  startedAt?: Timestamp;
  finishedAt?: Timestamp;
  stats?: JsonObject;
  errorText?: string;
}

export type ProjectEvent =
  | {
      type: "project.attached";
      projectId: string;
      at: Timestamp;
    }
  | {
      type: "project.index.started";
      projectId: string;
      runId: string;
      at: Timestamp;
    }
  | {
      type: "project.index.finished";
      projectId: string;
      runId: string;
      at: Timestamp;
      status: IndexRunStatus;
    };
