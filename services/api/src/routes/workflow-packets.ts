import { WorkflowPacketToolInputSchema } from "@mako-ai/contracts";
import type { MakoApiService } from "../service.js";
import {
  ApiRequestError,
  getObjectBody,
  getOptionalJsonObject,
  getRequestContext,
  type NextFunction,
  type Request,
  type Response,
  type RouteHandler,
  writeSuccess,
} from "../server-utils.js";

export function createWorkflowPacketRouteHandlers(
  api: MakoApiService,
): {
  generate: RouteHandler;
  methodNotAllowed: RouteHandler;
} {
  return {
    generate: async (request: Request, response: Response, next: NextFunction) => {
      try {
        // Request-size limits are enforced by the shared HTTP server/body parser
        // before route dispatch; this handler only performs schema validation.
        const body = getObjectBody(request.body);
        const { _meta: _ignoredMeta, ...candidate } = body;
        const parsed = WorkflowPacketToolInputSchema.safeParse(candidate);
        if (!parsed.success) {
          throw new ApiRequestError(
            400,
            "invalid_request",
            parsed.error.issues[0]?.message ?? "Invalid workflow packet request.",
          );
        }

        const context = getRequestContext(response);
        writeSuccess(
          response,
          context.requestId,
          200,
          await api.generateWorkflowPacket(parsed.data, {
            requestId: context.requestId,
            meta: getOptionalJsonObject(body._meta),
          }),
        );
      } catch (error) {
        next(error);
      }
    },
    methodNotAllowed: (request: Request, _response: Response, next: NextFunction) => {
      next(new ApiRequestError(405, "method_not_allowed", `Method ${request.method} is not allowed for ${request.path}.`));
    },
  };
}
