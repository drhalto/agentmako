import type {
  ContextPacketDatabaseObject,
  ContextPacketReadableCandidate,
} from "@mako-ai/contracts";

export type ContextPacketCandidateSeed = Omit<
  ContextPacketReadableCandidate,
  "id" | "score" | "freshness"
> & {
  id?: string;
  objectType?: ContextPacketDatabaseObject["objectType"];
  schemaName?: string;
  method?: string;
  baseScore?: number;
};

export interface ContextPacketProviderResult {
  provider: string;
  candidates: ContextPacketCandidateSeed[];
}

