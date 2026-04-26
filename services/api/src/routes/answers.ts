import type { MakoConfig } from "@mako-ai/config";
import type { AnswerPacket } from "@mako-ai/contracts";
import type { MakoApiService } from "../service.js";
import {
  ApiRequestError,
  getObjectBody,
  getOptionalEvidenceStatus,
  getOptionalJsonObject,
  getOptionalNumber,
  getOptionalReasoningTier,
  getOptionalString,
  getOptionalStringArray,
  getOptionalSupportLevel,
  getQueryKind,
  getRequestContext,
  getRequiredString,
  type NextFunction,
  type Request,
  type Response,
  type RouteHandler,
  writeSuccess,
} from "../server-utils.js";

export function createAnswerRouteHandlers(api: MakoApiService, _config: MakoConfig): {
  ask: RouteHandler;
  methodNotAllowed: RouteHandler;
} {
  return {
    ask: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const body = getObjectBody(request.body);
        const projectIdFromBody = getOptionalString(body.projectId);
        const projectRef = getOptionalString(body.projectRef);
        const meta = getOptionalJsonObject(body._meta);
        const queryKind = getQueryKind(body.queryKind);
        const queryText = getRequiredString(body.queryText, "queryText");
        const resolvedProject = await api.resolveProject(
          {
            projectId: projectIdFromBody,
            projectRef,
          },
          {
            meta,
          },
        );

        const packet: AnswerPacket = {
          queryId: getOptionalString(body.queryId) ?? `query_${Date.now()}`,
          projectId: resolvedProject.project.projectId,
          queryKind,
          queryText,
          tierUsed: getOptionalReasoningTier(body.tierUsed) ?? "standard",
          supportLevel:
            getOptionalSupportLevel(body.supportLevel) ??
            resolvedProject.profile?.supportLevel ??
            "best_effort",
          evidenceStatus: getOptionalEvidenceStatus(body.evidenceStatus) ?? "partial",
          evidenceConfidence: getOptionalNumber(body.evidenceConfidence, "evidenceConfidence") ?? 0,
          missingInformation: getOptionalStringArray(body.missingInformation, "missingInformation"),
          stalenessFlags: getOptionalStringArray(body.stalenessFlags, "stalenessFlags"),
          evidence: Array.isArray(body.evidence) ? (body.evidence as AnswerPacket["evidence"]) : [],
          generatedAt: getOptionalString(body.generatedAt) ?? new Date().toISOString(),
        };

        const context = getRequestContext(response);
        writeSuccess(response, context.requestId, 200, await api.ask(packet, { meta }));
      } catch (error) {
        next(error);
      }
    },
    methodNotAllowed: (request: Request, _response: Response, next: NextFunction) => {
      next(new ApiRequestError(405, "method_not_allowed", `Method ${request.method} is not allowed for ${request.path}.`));
    },
  };
}
