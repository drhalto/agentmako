import type { MakoConfig } from "@mako-ai/config";
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

export function createToolRouteHandlers(api: MakoApiService, _config: MakoConfig): {
  list: RouteHandler;
  invoke: RouteHandler;
  methodNotAllowed: RouteHandler;
} {
  return {
    list: (_request: Request, response: Response) => {
      const context = getRequestContext(response);
      writeSuccess(response, context.requestId, 200, api.listTools());
    },
    invoke: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const context = getRequestContext(response);
        const body = getObjectBody(request.body);
        const output = await api.callTool(request.params.name, body, {
          requestId: context.requestId,
          meta: getOptionalJsonObject(body._meta),
        });
        writeSuccess(response, context.requestId, 200, output);
      } catch (error) {
        next(error);
      }
    },
    methodNotAllowed: (request: Request, _response: Response, next: NextFunction) => {
      next(new ApiRequestError(405, "method_not_allowed", `Method ${request.method} is not allowed for ${request.path}.`));
    },
  };
}
