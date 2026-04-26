export interface ProgressEvent {
  /** Named stage: what the tool is working on now. */
  stage: string;
  /** Human-readable detail for the current stage. */
  message?: string;
  /** For naturally iterative work: current item count. */
  current?: number;
  /** For naturally iterative work: total item count. */
  total?: number;
}

export interface ProgressReporter {
  /** Emit a progress event. Implementations must never throw. */
  report(event: ProgressEvent): void | Promise<void>;
}

export interface McpProgressPayload {
  progress: number;
  total?: number;
  message?: string;
}
