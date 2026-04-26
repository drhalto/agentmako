import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { ProjectProfileRecord } from "./types.js";

export interface ProjectStoreContext {
  readonly db: DatabaseSync;
  readonly projectRoot: string;
  loadProjectProfile(): ProjectProfileRecord | null;
  prepared(sql: string): StatementSync;
}
