import { createReadStream } from "node:fs";
import { spawn } from "node:child_process";
import type { MakoConfig } from "@mako-ai/config";
import type { MakoApiService } from "../service.js";
import {
  ApiRequestError,
  getObjectBody,
  getOptionalString,
  getRequestContext,
  getRequiredString,
  type NextFunction,
  type Request,
  type Response,
  type RouteHandler,
  writeSuccess,
} from "../server-utils.js";

export function createProjectRouteHandlers(api: MakoApiService, _config: MakoConfig): {
  list: RouteHandler;
  status: RouteHandler;
  attach: RouteHandler;
  detach: RouteHandler;
  index: RouteHandler;
  favicon: RouteHandler;
  reveal: RouteHandler;
  methodNotAllowed: RouteHandler;
} {
  return {
    list: (_request: Request, response: Response) => {
      const context = getRequestContext(response);
      writeSuccess(response, context.requestId, 200, api.listProjects());
    },
    status: (request: Request, response: Response, next: NextFunction) => {
      try {
        const reference = getOptionalString(request.query.ref);
        if (!reference) {
          throw new ApiRequestError(400, "invalid_request", "Missing required query parameter `ref`.");
        }

        const status = api.getProjectStatus(reference);
        if (!status) {
          throw new ApiRequestError(404, "not_found", `No attached project found for: ${reference}`);
        }

        const context = getRequestContext(response);
        writeSuccess(response, context.requestId, 200, status);
      } catch (error) {
        next(error);
      }
    },
    attach: (request: Request, response: Response, next: NextFunction) => {
      try {
        const body = getObjectBody(request.body);
        const projectRoot = getRequiredString(body.projectRoot, "projectRoot");
        const context = getRequestContext(response);
        writeSuccess(response, context.requestId, 200, api.attachProject(projectRoot));
      } catch (error) {
        next(error);
      }
    },
    detach: (request: Request, response: Response, next: NextFunction) => {
      try {
        const body = getObjectBody(request.body);
        const projectReference = getRequiredString(body.projectRef, "projectRef");
        const purge = body.purge === true;
        const context = getRequestContext(response);
        writeSuccess(response, context.requestId, 200, api.detachProject(projectReference, purge));
      } catch (error) {
        next(error);
      }
    },
    index: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const body = getObjectBody(request.body);
        const projectRoot = getRequiredString(body.projectRoot, "projectRoot");
        const context = getRequestContext(response);
        const result = await api.indexProject(projectRoot);
        writeSuccess(response, context.requestId, 200, result);
      } catch (error) {
        next(error);
      }
    },
    favicon: (request: Request, response: Response, next: NextFunction) => {
      try {
        const projectId = getRequiredString(request.params.projectId, "projectId");
        const found = api.resolveProjectFavicon(projectId);
        if (!found) {
          throw new ApiRequestError(404, "not_found", `No favicon found for project: ${projectId}`);
        }

        // Drop the JSON content-type the global middleware sets — this
        // route streams a binary asset.
        response.setHeader("content-type", found.contentType);
        response.setHeader("content-length", String(found.byteLength));
        // Conservative cache: favicons rarely change, but a project edit
        // should be reflected without manual refresh — short max-age + revalidate.
        response.setHeader("cache-control", "public, max-age=300, must-revalidate");
        response.status(200);

        // The narrowed `Response` type only exposes the JSON helpers we
        // hand to most handlers. The underlying Node response is a real
        // `http.ServerResponse`, so we cast through `unknown` to hand
        // `stream.pipe` something it accepts.
        const writable = response as unknown as NodeJS.WritableStream;
        const stream = createReadStream(found.absolutePath);
        stream.on("error", () => {
          // We've already flushed headers, so the cleanest signal to the
          // client is a truncated body. End the response so it stops
          // expecting more bytes.
          response.end();
        });
        stream.pipe(writable);
      } catch (error) {
        next(error);
      }
    },
    reveal: (request: Request, response: Response, next: NextFunction) => {
      try {
        const projectId = getRequiredString(request.params.projectId, "projectId");
        const project = api
          .listProjects()
          .find((p) => p.projectId === projectId);
        if (!project) {
          throw new ApiRequestError(
            404,
            "not_found",
            `No attached project found for id: ${projectId}`,
          );
        }
        openInFileManager(project.canonicalPath);
        const context = getRequestContext(response);
        writeSuccess(response, context.requestId, 200, {
          projectId,
          revealed: true,
          path: project.canonicalPath,
        });
      } catch (error) {
        next(error);
      }
    },
    methodNotAllowed: (request: Request, _response: Response, next: NextFunction) => {
      next(new ApiRequestError(405, "method_not_allowed", `Method ${request.method} is not allowed for ${request.path}.`));
    },
  };
}

/**
 * Launch the OS-native file manager at `target`. Spawns in detached
 * mode so the child keeps running after the request returns. We never
 * await — the user-visible success is purely "the command was issued".
 */
function openInFileManager(target: string): void {
  if (process.platform === "win32") {
    spawn("explorer.exe", [target], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  if (process.platform === "darwin") {
    spawn("open", [target], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  spawn("xdg-open", [target], { detached: true, stdio: "ignore" }).unref();
}
