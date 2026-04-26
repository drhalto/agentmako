import type { IndexRunStatus } from "@mako-ai/contracts";

export interface WorkerJob {
  jobId: string;
  type: "project.index" | "project.refresh" | "cleanup.answer-traces";
  projectId: string;
  status: IndexRunStatus;
}
