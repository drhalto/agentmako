import type { ProgressReporter } from "./types.js";

export const NOOP_PROGRESS_REPORTER: ProgressReporter = {
  report: () => {},
};

