/**
 * CLI commands for the Roadmap 3 harness: `chat`, `session`, `tier`.
 *
 * Every command routes through the `services/harness` HTTP API — no direct
 * imports from `@mako-ai/harness-core`. This keeps the transport boundary
 * honest (Phase 3.5 will prove a browser client can do everything the CLI
 * does through the same routes).
 */

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createParser } from "eventsource-parser";

const DEFAULT_ENDPOINT = process.env.MAKO_HARNESS_URL ?? "http://127.0.0.1:3018";

interface HarnessHttpOptions {
  endpoint?: string;
}

interface HttpResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: { code: string; message: string };
}

async function harnessHttp<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body: unknown,
  options: HarnessHttpOptions = {},
): Promise<HttpResult<T>> {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const response = await fetch(`${endpoint}${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed: { ok?: boolean; data?: T; error?: { code: string; message: string } } = {};
  try {
    parsed = text ? (JSON.parse(text) as typeof parsed) : {};
  } catch {
    parsed = {};
  }
  return {
    ok: response.ok && parsed.ok !== false,
    status: response.status,
    data: parsed.data,
    error: parsed.error,
  };
}

async function* streamSessionEvents(
  sessionId: string,
  afterOrdinal?: number,
  options: HarnessHttpOptions = {},
): AsyncGenerator<{ kind: string; [key: string]: unknown }> {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const query = afterOrdinal !== undefined ? `?after=${afterOrdinal}` : "";
  const response = await fetch(`${endpoint}/api/v1/sessions/${sessionId}/stream${query}`, {
    headers: { accept: "text/event-stream" },
  });
  if (!response.ok || !response.body) {
    throw new Error(`stream failed: ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const pendingEvents: Array<{ kind: string; [key: string]: unknown }> = [];
  const parser = createParser({
    onEvent(event) {
      try {
        // Envelope shape: { sessionId, ordinal, createdAt, event: {...} }.
        // Yield the inner event so `event.kind` works for CLI consumers.
        const envelope = JSON.parse(event.data) as {
          event?: { kind: string; [key: string]: unknown };
          kind?: string;
        };
        const inner = envelope.event ?? (envelope as { kind: string; [key: string]: unknown });
        if (inner && typeof inner.kind === "string") {
          pendingEvents.push(inner as { kind: string; [key: string]: unknown });
        }
      } catch {
        // ignore malformed frames
      }
    },
  });
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      parser.reset({ consume: true });
    } else {
      parser.feed(decoder.decode(value, { stream: true }));
    }
    while (pendingEvents.length > 0) {
      yield pendingEvents.shift()!;
    }
    if (done) {
      return;
    }
  }
}

interface ChatArgs {
  message?: string;
  projectId?: string;
  interactive: boolean;
  endpoint?: string;
}

function parseChatArgs(raw: string[]): ChatArgs {
  const args: ChatArgs = { interactive: true };
  for (let i = 0; i < raw.length; i++) {
    const token = raw[i]!;
    if (token === "-m" || token === "--message") {
      args.message = raw[++i] ?? "";
      args.interactive = false;
    } else if (token === "--project" || token === "--project-id") {
      args.projectId = raw[++i];
    } else if (token === "--endpoint") {
      args.endpoint = raw[++i];
    }
  }
  return args;
}

/**
 * Run a single chat turn against an open session.
 *
 * Returns the highest event ordinal observed during the turn so the caller
 * can pass it as `?after=<ordinal>` on the next stream open. Without this
 * cursor, opening a fresh SSE stream replays every prior event including
 * past `turn.done`s, and an interactive REPL exits early on turn 2+ before
 * the new response arrives. (Phase 3.0 hotfix; the smoke test only ran one
 * turn so the bug shipped silently.)
 */
async function runChatTurn(
  sessionId: string,
  content: string,
  options: HarnessHttpOptions,
  afterOrdinal?: number,
): Promise<number> {
  const result = await harnessHttp<{ messageId: string }>(
    "POST",
    `/api/v1/sessions/${sessionId}/messages`,
    { content },
    options,
  );
  if (!result.ok) {
    throw new Error(
      `postMessage failed: ${result.error?.code ?? result.status} ${result.error?.message ?? ""}`,
    );
  }

  process.stdout.write("\n");
  let highestOrdinal = afterOrdinal ?? -1;
  for await (const event of streamSessionEvents(sessionId, afterOrdinal, options)) {
    if (typeof event.ordinal === "number" && event.ordinal > highestOrdinal) {
      highestOrdinal = event.ordinal;
    }
    if (event.kind === "text.delta" && typeof event.text === "string") {
      process.stdout.write(event.text);
    } else if (event.kind === "turn.done") {
      process.stdout.write("\n");
      return highestOrdinal;
    } else if (event.kind === "error") {
      process.stdout.write(`\n[error] ${String(event.message ?? "turn failed")}\n`);
      return highestOrdinal;
    }
  }
  return highestOrdinal;
}

export async function runChatCommand(raw: string[]): Promise<void> {
  const args = parseChatArgs(raw);
  const options: HarnessHttpOptions = { endpoint: args.endpoint };

  const sessionResult = await harnessHttp<{ session: { id: string; tier: string } }>(
    "POST",
    "/api/v1/sessions",
    { projectId: args.projectId },
    options,
  );
  if (!sessionResult.ok || !sessionResult.data) {
    throw new Error(
      `createSession failed: ${sessionResult.error?.code ?? sessionResult.status} ${sessionResult.error?.message ?? ""}`,
    );
  }
  const sessionId = sessionResult.data.session.id;
  process.stdout.write(
    `session ${sessionId} (tier=${sessionResult.data.session.tier})\n`,
  );

  if (!args.interactive) {
    await runChatTurn(sessionId, args.message ?? "", options);
    return;
  }

  const rl = createInterface({ input, output });
  let lastOrdinal: number | undefined;
  try {
    process.stdout.write("chat> ");
    while (true) {
      const line = await rl.question("");
      const content = line.trim();
      if (content === "" || content === "/exit" || content === "/quit") break;
      lastOrdinal = await runChatTurn(sessionId, content, options, lastOrdinal);
      process.stdout.write("chat> ");
    }
  } finally {
    rl.close();
  }
}

export async function runSessionCommand(raw: string[]): Promise<void> {
  const sub = raw[0];
  const options: HarnessHttpOptions = {};
  if (!sub || sub === "list") {
    const result = await harnessHttp<{
      sessions: Array<{ id: string; title: string | null; tier: string; status: string; createdAt: string }>;
    }>("GET", "/api/v1/sessions", undefined, options);
    if (!result.ok || !result.data) {
      throw new Error(`sessions list failed: ${result.error?.code ?? result.status}`);
    }
    if (result.data.sessions.length === 0) {
      process.stdout.write("(no sessions)\n");
      return;
    }
    for (const s of result.data.sessions) {
      process.stdout.write(
        `${s.id}  tier=${s.tier}  status=${s.status}  ${s.title ?? ""}\n`,
      );
    }
    return;
  }

  if (sub === "show") {
    const id = raw[1];
    if (!id) throw new Error("usage: agentmako session show <id>");
    const result = await harnessHttp<{
      session: { harnessVersion?: string | null } | null;
      messages: Array<{ archived?: boolean }>;
      archivedCount?: number;
    }>("GET", `/api/v1/sessions/${id}`, undefined, options);
    if (!result.ok) throw new Error(`session not found: ${id}`);

    const archivedCount =
      result.data?.archivedCount ??
      (result.data?.messages ?? []).filter((m) => m.archived === true).length;
    const totalMessages = result.data?.messages?.length ?? 0;
    const harnessVersion = result.data?.session?.harnessVersion ?? "(legacy)";
    process.stdout.write(
      `session ${id}  harness=v${harnessVersion}  messages=${totalMessages}  archived=${archivedCount}\n`,
    );
    process.stdout.write(`${JSON.stringify(result.data, null, 2)}\n`);
    return;
  }

  if (sub === "rm") {
    const id = raw[1];
    if (!id) throw new Error("usage: agentmako session rm <id>");
    const result = await harnessHttp<unknown>("DELETE", `/api/v1/sessions/${id}`, undefined, options);
    if (!result.ok) throw new Error(`delete failed: ${result.error?.code ?? result.status}`);
    process.stdout.write(`deleted session ${id}\n`);
    return;
  }

  if (sub === "resume") {
    const id = raw[1];
    if (!id) throw new Error("usage: agentmako session resume <id>");

    // Phase 3.4: POST /resume performs the version fence + pending-approval
    // scan, then returns the last-known ordinal. We then stream from there.
    const resumed = await harnessHttp<{
      sessionId: string;
      resumedFromOrdinal: number;
      eventCount: number;
      pendingApprovals: Array<{ requestId: string; tool: string; requestOrdinal: number }>;
    }>("POST", `/api/v1/sessions/${id}/resume`, {}, options);

    if (!resumed.ok || !resumed.data) {
      throw new Error(
        `session resume failed: ${resumed.error?.code ?? resumed.status} ${resumed.error?.message ?? ""}`,
      );
    }

    process.stdout.write(
      `resumed session ${resumed.data.sessionId} at ordinal ${resumed.data.resumedFromOrdinal} (${resumed.data.eventCount} events replayed)\n`,
    );
    if (resumed.data.pendingApprovals.length > 0) {
      process.stdout.write(`pending approvals from previous run (abandoned):\n`);
      for (const p of resumed.data.pendingApprovals) {
        process.stdout.write(`  - ${p.requestId}  tool=${p.tool}  ordinal=${p.requestOrdinal}\n`);
      }
      process.stdout.write(
        `  (post a new user message to re-trigger the tool call if you want to proceed)\n`,
      );
    }

    // Stream new events from after the resumed ordinal.
    for await (const event of streamSessionEvents(id, resumed.data.resumedFromOrdinal, options)) {
      process.stdout.write(`[${event.kind}] ${JSON.stringify(event)}\n`);
      if (event.kind === "turn.done" || event.kind === "error") break;
    }
    return;
  }

  throw new Error(
    `unknown session subcommand: ${sub}. Supported: list, show <id>, rm <id>, resume <id>`,
  );
}

interface TierResponse {
  current: string;
  reason: string;
  upgradePath: string[];
  embedding?:
    | { ok: true; providerId: string; modelId: string; source: string; reason: string }
    | { ok: false; reason: string; attempted: Array<{ providerId: string; modelId: string; reason: string }> };
  compaction?: {
    threshold: number;
    harnessVersion: string;
  };
}

export async function runTierCommand(_raw: string[]): Promise<void> {
  const result = await harnessHttp<TierResponse>("GET", "/api/v1/tier", undefined);
  if (!result.ok || !result.data) {
    throw new Error(`tier query failed: ${result.error?.code ?? result.status}`);
  }
  process.stdout.write(`current: ${result.data.current}\n`);
  process.stdout.write(`reason: ${result.data.reason}\n`);
  if (result.data.upgradePath.length > 0) {
    process.stdout.write(`upgrade path:\n`);
    for (const step of result.data.upgradePath) {
      process.stdout.write(`  - ${step}\n`);
    }
  }
  if (result.data.embedding) {
    const e = result.data.embedding;
    if (e.ok) {
      process.stdout.write(`embedding: ${e.providerId}/${e.modelId} (${e.source})\n`);
    } else {
      process.stdout.write(`embedding: fts-fallback — ${e.reason}\n`);
      if (e.attempted.length > 0) {
        for (const a of e.attempted) {
          process.stdout.write(`  - tried ${a.providerId}/${a.modelId}: ${a.reason}\n`);
        }
      }
    }
  }
  if (result.data.compaction) {
    const c = result.data.compaction;
    process.stdout.write(
      `compaction: threshold=${(c.threshold * 100).toFixed(0)}% of context window  harness=v${c.harnessVersion}\n`,
    );
  }
}

// -----------------------------------------------------------------------------
// Phase 3.1 — providers + keys
// -----------------------------------------------------------------------------

interface ProviderListEntry {
  source: string;
  spec: {
    id: string;
    name: string;
    transport: string;
    baseURL?: string;
    auth: string;
    tier: string;
    envVarHints: string[];
    models: Array<{ id: string; displayName: string }>;
  };
}

export async function runProvidersCommand(raw: string[]): Promise<void> {
  const sub = raw[0] ?? "list";
  const options: HarnessHttpOptions = {};

  if (sub === "list") {
    const result = await harnessHttp<{ providers: ProviderListEntry[] }>(
      "GET",
      "/api/v1/providers",
      undefined,
      options,
    );
    if (!result.ok || !result.data) {
      throw new Error(`providers list failed: ${result.error?.code ?? result.status}`);
    }
    if (result.data.providers.length === 0) {
      process.stdout.write("(no providers registered)\n");
      return;
    }
    for (const { source, spec } of result.data.providers) {
      const url = spec.baseURL ? ` baseURL=${spec.baseURL}` : "";
      const models =
        spec.models.length === 0
          ? "(no bundled models)"
          : spec.models.map((m) => m.id).join(", ");
      process.stdout.write(
        `${spec.id.padEnd(20)} tier=${spec.tier.padEnd(5)} transport=${spec.transport.padEnd(20)} auth=${spec.auth.padEnd(8)} src=${source}${url}\n`,
      );
      process.stdout.write(`  models: ${models}\n`);
    }
    return;
  }

  if (sub === "test") {
    const id = raw[1];
    if (!id) throw new Error("usage: agentmako providers test <id>");
    const result = await harnessHttp<{
      provider: string;
      keyResolved: boolean;
      keySource: string | null;
      note: string;
    }>("POST", `/api/v1/providers/${id}/test`, {}, options);
    if (!result.ok || !result.data) {
      throw new Error(`provider test failed: ${result.error?.code ?? result.status} ${result.error?.message ?? ""}`);
    }
    const { keyResolved, keySource, note } = result.data;
    process.stdout.write(
      `provider=${id} keyResolved=${keyResolved}${keySource ? ` source=${keySource}` : ""}\n${note}\n`,
    );
    return;
  }

  if (sub === "add") {
    process.stdout.write(
      "usage: pipe a ProviderSpec JSON document to stdin, e.g.:\n" +
        "  cat my-provider.json | agentmako providers add\n",
    );
    const stdin: Buffer[] = [];
    for await (const chunk of process.stdin) stdin.push(Buffer.from(chunk));
    const raw = Buffer.concat(stdin).toString("utf8").trim();
    if (raw.length === 0) {
      throw new Error("no provider JSON received on stdin");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("invalid JSON on stdin");
    }
    const result = await harnessHttp<{ provider: { id: string } }>(
      "POST",
      "/api/v1/providers",
      parsed,
      options,
    );
    if (!result.ok || !result.data) {
      throw new Error(
        `provider add failed: ${result.error?.code ?? result.status} ${result.error?.message ?? ""}`,
      );
    }
    process.stdout.write(`added provider ${result.data.provider.id}\n`);
    return;
  }

  if (sub === "remove") {
    const id = raw[1];
    if (!id) throw new Error("usage: agentmako providers remove <id>");
    const result = await harnessHttp<unknown>(
      "DELETE",
      `/api/v1/providers/${id}`,
      undefined,
      options,
    );
    if (!result.ok) {
      throw new Error(`provider remove failed: ${result.error?.code ?? result.status}`);
    }
    process.stdout.write(`removed provider ${id}\n`);
    return;
  }

  throw new Error(
    `unknown providers subcommand: ${sub}. Supported: list, test <id>, add (stdin), remove <id>`,
  );
}

export async function runKeysCommand(raw: string[]): Promise<void> {
  const sub = raw[0];
  if (sub !== "set" && sub !== "delete") {
    throw new Error(
      `usage: agentmako keys set <provider> [--from-env VAR | --prompt | --value VAL] | agentmako keys delete <provider>`,
    );
  }
  const provider = raw[1];
  if (!provider) throw new Error("missing provider id");

  if (sub === "delete") {
    const result = await harnessHttp<{ deleted: boolean }>(
      "DELETE",
      `/api/v1/keys/${provider}`,
      undefined,
    );
    if (!result.ok) {
      throw new Error(`keys delete failed: ${result.error?.code ?? result.status}`);
    }
    process.stdout.write(
      `key for ${provider} ${result.data?.deleted ? "deleted from keychain" : "not present"}\n`,
    );
    return;
  }

  let body: { from_env?: string; value?: string };
  let i = 2;
  if (raw[i] === "--from-env") {
    const varName = raw[i + 1];
    if (!varName) throw new Error("missing env var name after --from-env");
    body = { from_env: varName };
  } else if (raw[i] === "--value") {
    const v = raw[i + 1];
    if (!v) throw new Error("missing value after --value");
    body = { value: v };
  } else if (raw[i] === "--prompt" || raw[i] === undefined) {
    process.stdout.write(`API key for ${provider}: `);
    const stdin: Buffer[] = [];
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
      stdin.push(Buffer.from(chunk));
      if (chunk.toString().includes("\n")) break;
    }
    const value = Buffer.concat(stdin).toString("utf8").trim();
    if (value.length === 0) throw new Error("no key entered");
    body = { value };
  } else {
    throw new Error(`unknown flag: ${raw[i]}`);
  }

  const result = await harnessHttp<{ stored: boolean }>(
    "POST",
    `/api/v1/keys/${provider}`,
    body,
    {},
  );
  if (!result.ok) {
    throw new Error(`keys set failed: ${result.error?.code ?? result.status} ${result.error?.message ?? ""}`);
  }
  process.stdout.write(`key for ${provider} stored in system keychain\n`);
}

// -----------------------------------------------------------------------------
// Phase 3.2 — permissions + undo
// -----------------------------------------------------------------------------

interface RuleListEntry {
  permission: string;
  pattern: string;
  action: "allow" | "deny" | "ask";
  source: "project" | "global";
}

export async function runPermissionsCommand(raw: string[]): Promise<void> {
  const sub = raw[0] ?? "list";

  if (sub === "list") {
    const result = await harnessHttp<{ rules: RuleListEntry[] }>(
      "GET",
      "/api/v1/permissions/rules",
      undefined,
    );
    if (!result.ok || !result.data) {
      throw new Error(`permissions list failed: ${result.error?.code ?? result.status}`);
    }
    if (result.data.rules.length === 0) {
      process.stdout.write(
        "(no rules configured — every action tool defaults to `ask`)\n",
      );
      return;
    }
    for (const r of result.data.rules) {
      process.stdout.write(
        `${r.action.padEnd(5)}  ${r.permission.padEnd(16)} ${r.pattern.padEnd(40)} (${r.source})\n`,
      );
    }
    return;
  }

  if (sub === "add") {
    const permission = raw[1];
    const pattern = raw[2];
    const action = raw[3] as "allow" | "deny" | "ask" | undefined;
    if (!permission || !pattern || (action !== "allow" && action !== "deny" && action !== "ask")) {
      throw new Error(
        "usage: agentmako permissions add <permission> <pattern> <allow|deny|ask> [--global]",
      );
    }
    const scope = raw.includes("--global") ? "global" : "project";
    const result = await harnessHttp<{ rule: unknown }>(
      "POST",
      "/api/v1/permissions/rules",
      { permission, pattern, action, scope },
    );
    if (!result.ok) {
      throw new Error(
        `permissions add failed: ${result.error?.code ?? result.status} ${result.error?.message ?? ""}`,
      );
    }
    process.stdout.write(
      `added ${scope} rule: ${action} ${permission} ${pattern}\n`,
    );
    return;
  }

  if (sub === "remove" || sub === "rm") {
    const permission = raw[1];
    const pattern = raw[2];
    if (!permission || !pattern) {
      throw new Error("usage: agentmako permissions remove <permission> <pattern>");
    }
    const result = await harnessHttp<{ removed: boolean }>(
      "DELETE",
      `/api/v1/permissions/rules/${permission}/${encodeURIComponent(pattern)}`,
      undefined,
    );
    if (!result.ok) {
      throw new Error(`permissions remove failed: ${result.error?.code ?? result.status}`);
    }
    process.stdout.write(
      result.data?.removed ? `removed rule: ${permission} ${pattern}\n` : "(no matching rule)\n",
    );
    return;
  }

  if (sub === "approve" || sub === "deny") {
    const sessionId = raw[1];
    const requestId = raw[2];
    if (!sessionId || !requestId) {
      throw new Error(
        `usage: agentmako permissions ${sub} <sessionId> <requestId> [--scope turn|session|project|global]`,
      );
    }
    const scopeIdx = raw.indexOf("--scope");
    const scope = scopeIdx >= 0 ? raw[scopeIdx + 1] : "turn";
    const result = await harnessHttp<unknown>(
      "POST",
      `/api/v1/sessions/${sessionId}/permissions/requests/${requestId}`,
      { action: sub === "approve" ? "allow" : "deny", scope },
    );
    if (!result.ok) {
      throw new Error(
        `permissions ${sub} failed: ${result.error?.code ?? result.status} ${result.error?.message ?? ""}`,
      );
    }
    process.stdout.write(`${sub === "approve" ? "approved" : "denied"} request ${requestId}\n`);
    return;
  }

  throw new Error(
    `unknown permissions subcommand: ${sub}. Supported: list, add <perm> <pattern> <action> [--global], remove <perm> <pattern>, approve|deny <session> <request> [--scope ...]`,
  );
}

export async function runUndoCommand(raw: string[]): Promise<void> {
  const sessionId = raw[0];
  const ordinalRaw = raw[1];
  if (!sessionId || !ordinalRaw) {
    throw new Error("usage: agentmako undo <session-id> <message-ordinal>");
  }
  const ordinal = Number.parseInt(ordinalRaw, 10);
  if (!Number.isFinite(ordinal)) {
    throw new Error(`message-ordinal must be an integer; got: ${ordinalRaw}`);
  }
  const result = await harnessHttp<{ filesRestored: number; filesDeleted: number }>(
    "POST",
    `/api/v1/sessions/${sessionId}/undo/${ordinal}`,
    {},
  );
  if (!result.ok || !result.data) {
    throw new Error(
      `undo failed: ${result.error?.code ?? result.status} ${result.error?.message ?? ""}`,
    );
  }
  process.stdout.write(
    `restored ${result.data.filesRestored} file${result.data.filesRestored === 1 ? "" : "s"}, ` +
      `deleted ${result.data.filesDeleted} created-since file${result.data.filesDeleted === 1 ? "" : "s"}\n`,
  );
}
