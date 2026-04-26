import { AsyncLocalStorage } from "node:async_hooks";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  requestId?: string;
  [key: string]: unknown;
}

export interface LogFields {
  [key: string]: unknown;
}

export interface Logger {
  readonly service: string;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
  span<T>(name: string, fn: () => T): T;
  span<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

const contextStorage = new AsyncLocalStorage<LogContext>();

export function runWithContext<T>(context: LogContext, fn: () => T): T {
  return contextStorage.run(context, fn);
}

export function getLogContext(): LogContext | undefined {
  return contextStorage.getStore();
}

export function updateLogContext(patch: LogContext): void {
  const current = contextStorage.getStore();
  if (current) {
    Object.assign(current, patch);
  }
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveMinLevel(): LogLevel {
  const raw = (process.env.MAKO_LOG_LEVEL ?? "info").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
}

function emit(
  service: string,
  bindings: LogFields,
  level: LogLevel,
  message: string,
  fields: LogFields | undefined,
): void {
  const minLevel = resolveMinLevel();
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) {
    return;
  }

  const context = contextStorage.getStore();
  const payload: Record<string, unknown> = {
    level,
    service,
    time: new Date().toISOString(),
    message,
  };

  if (context) {
    for (const [key, value] of Object.entries(context)) {
      if (value !== undefined) {
        payload[key] = value;
      }
    }
  }

  for (const [key, value] of Object.entries(bindings)) {
    if (value !== undefined) {
      payload[key] = value;
    }
  }

  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        payload[key] = value;
      }
    }
  }

  const line = safeStringify(payload);
  if (level === "error") {
    process.stderr.write(`${line}\n`);
  } else {
    process.stderr.write(`${line}\n`);
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, v) => {
      if (v instanceof Error) {
        return { name: v.name, message: v.message, stack: v.stack };
      }
      return v;
    });
  } catch {
    return JSON.stringify({ level: "error", service: "mako-logger", message: "log_serialization_failed" });
  }
}

class LoggerImpl implements Logger {
  constructor(
    readonly service: string,
    private readonly bindings: LogFields,
  ) {}

  debug(message: string, fields?: LogFields): void {
    emit(this.service, this.bindings, "debug", message, fields);
  }

  info(message: string, fields?: LogFields): void {
    emit(this.service, this.bindings, "info", message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    emit(this.service, this.bindings, "warn", message, fields);
  }

  error(message: string, fields?: LogFields): void {
    emit(this.service, this.bindings, "error", message, fields);
  }

  child(bindings: LogFields): Logger {
    return new LoggerImpl(this.service, { ...this.bindings, ...bindings });
  }

  span<T>(name: string, fn: () => T | Promise<T>): T | Promise<T> {
    const start = Date.now();
    this.debug(`${name}.start`);
    try {
      const result = fn();
      if (result instanceof Promise) {
        return result.then(
          (value) => {
            this.debug(`${name}.end`, { durationMs: Date.now() - start });
            return value;
          },
          (error: unknown) => {
            this.error(`${name}.fail`, { durationMs: Date.now() - start, error });
            throw error;
          },
        );
      }
      this.debug(`${name}.end`, { durationMs: Date.now() - start });
      return result;
    } catch (error) {
      this.error(`${name}.fail`, { durationMs: Date.now() - start, error });
      throw error;
    }
  }
}

export function createLogger(service: string, bindings: LogFields = {}): Logger {
  return new LoggerImpl(service, bindings);
}
