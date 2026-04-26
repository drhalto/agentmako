/**
 * Offline PL/pgSQL function / trigger extractor.
 *
 * Phase 3.6.0 Workstream C, per research-agent finding: skip libpg_query
 * (3 MB WASM, overkill). Home-grown dollar-quote-aware splitter covers 95% of
 * real-world Supabase-flavoured migrations with ~100 LoC. The only hard part
 * of PL/pgSQL lexing is dollar quoting (`$$ ... $$` or `$tag$ ... $tag$`);
 * the rule is trivially correct — tag opens, matching tag closes, nothing
 * inside is interpreted.
 *
 * What we extract:
 *   - `CREATE [OR REPLACE] (FUNCTION|PROCEDURE) <qualified_name>(...) ... AS $...$ ... $...$`
 *     → `{ kind: "function", schema, name, objectKind, argTypes, returnType, bodyText }`
 *   - `CREATE [OR REPLACE] TRIGGER <name> ... EXECUTE (FUNCTION|PROCEDURE) <fn>(...)`
 *     → `{ kind: "trigger", name, bodyText: "<EXECUTE ...>", executesFunction }`
 *
 * What we deliberately do NOT do:
 *   - Parse bodies (no SQL AST — the body stays as raw text for `searchSchemaBodies`)
 *   - Handle DO-blocks (they contain SQL but are anonymous — not addressable)
 *   - Handle `CREATE POLICY` (that's in the structural-DDL extractor, not here)
 *
 * `deriveFunctionTableRefs` scans each function body for
 *   `FROM|JOIN|UPDATE|INSERT INTO|DELETE FROM <table>`
 * and returns the set of table names referenced — this populates the
 * `schema_snapshot_function_refs` edge table. The shared helper strips SQL
 * comments and string literals before matching, but it remains a heuristic
 * and still misses dynamic SQL.
 */

export { deriveFunctionTableRefs } from "@mako-ai/store";

export interface ExtractedPgFunction {
  kind: "function";
  schema: string;
  name: string;
  objectKind: "function" | "procedure";
  argTypes: string[];
  returnType: string | null;
  bodyText: string;
  file: string;
  line: number;
}

export interface ExtractedPgTrigger {
  kind: "trigger";
  schema: string;
  name: string;
  table: string | null;
  timing: string;
  events: string[];
  executesSchema: string | null;
  executesFunction: string | null;
  bodyText: string;
  file: string;
  line: number;
}

export type ExtractedPgObject = ExtractedPgFunction | ExtractedPgTrigger;

function lineNumberAtIndex(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) line++;
  }
  return line;
}

function stripIdentifierQuoting(identifier: string): string {
  const trimmed = identifier.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseQualifiedName(raw: string): { schema: string; name: string } {
  const stripped = raw.trim();
  const parts = stripped.split(/\s*\.\s*/);
  if (parts.length >= 2) {
    return {
      schema: stripIdentifierQuoting(parts[0]!),
      name: stripIdentifierQuoting(parts[1]!),
    };
  }
  return { schema: "public", name: stripIdentifierQuoting(parts[0]!) };
}

function normalizeSqlText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function splitTopLevelSqlList(value: string): string[] {
  const out: string[] = [];
  let current = "";
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i]!;
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }
    if (!inSingleQuote && !inDoubleQuote) {
      if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth = Math.max(0, depth - 1);
      } else if (char === "," && depth === 0) {
        const trimmed = current.trim();
        if (trimmed !== "") out.push(trimmed);
        current = "";
        continue;
      }
    }
    current += char;
  }
  const trimmed = current.trim();
  if (trimmed !== "") out.push(trimmed);
  return out;
}

function findMatchingParen(value: string, openIndex: number): number {
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let i = openIndex; i < value.length; i += 1) {
    const char = value[i]!;
    if (char === "'" && !inDoubleQuote) {
      if (inSingleQuote && value[i + 1] === "'") {
        i += 1;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (inSingleQuote || inDoubleQuote) {
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function stripFunctionDefault(rawArg: string): string {
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let i = 0; i < rawArg.length; i += 1) {
    const char = rawArg[i]!;
    if (char === "'" && !inDoubleQuote) {
      if (inSingleQuote && rawArg[i + 1] === "'") {
        i += 1;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (inSingleQuote || inDoubleQuote) {
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) {
      if (char === "=") {
        return rawArg.slice(0, i).trim();
      }
      if (/^default\b/i.test(rawArg.slice(i))) {
        return rawArg.slice(0, i).trim();
      }
    }
  }
  return rawArg.trim();
}

function looksLikeIdentifierToken(value: string): boolean {
  return /^"[^"]+"$|^[A-Za-z_][A-Za-z0-9_$]*$/.test(value);
}

function parseArgumentType(rawArg: string): string | null {
  let normalized = normalizeSqlText(stripFunctionDefault(rawArg));
  if (normalized === "") return null;
  normalized = normalized.replace(/^(?:INOUT|IN|OUT|VARIADIC)\s+/i, "");
  if (normalized === "") return null;
  const tokens = normalized.split(/\s+/);
  if (tokens.length <= 1) {
    return normalized;
  }
  const second = tokens[1]!.toLowerCase();
  const startsTypeWithoutName =
    /[.(\[]/.test(tokens[0]!) ||
    second === "with" ||
    second === "without" ||
    second === "varying" ||
    second === "precision" ||
    second === "time" ||
    second === "zone";
  if (startsTypeWithoutName || !looksLikeIdentifierToken(tokens[0]!)) {
    return normalized;
  }
  return normalizeSqlText(tokens.slice(1).join(" "));
}

function parseFunctionArgTypes(signatureText: string): string[] {
  return splitTopLevelSqlList(signatureText)
    .map((arg) => parseArgumentType(arg))
    .filter((argType): argType is string => argType != null && argType !== "");
}

function parseReturnType(statementText: string): string | null {
  const match = /\bRETURNS\s+(?<returnType>[\s\S]*?)(?=\bLANGUAGE\b|\bAS\b|\bIMMUTABLE\b|\bSTABLE\b|\bVOLATILE\b|\bSECURITY\b|\bSET\b|\bCOST\b|\bROWS\b|\bPARALLEL\b|$)/i.exec(
    statementText,
  );
  return match?.groups?.returnType ? normalizeSqlText(match.groups.returnType) : null;
}

/**
 * Split `sql` into statements, respecting dollar-quoted bodies, single-quoted
 * strings, line comments, and block comments. Returns an array of
 * `{ text, offset }` so callers can convert offsets to line numbers.
 */
export function splitStatements(sql: string): Array<{ text: string; offset: number }> {
  const out: Array<{ text: string; offset: number }> = [];
  let buf = "";
  let bufStart = 0;
  let i = 0;
  const DOLLAR_OPEN = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/y;

  const push = () => {
    const trimmed = buf.trim();
    if (trimmed.length > 0) {
      out.push({ text: buf, offset: bufStart });
    }
    buf = "";
    bufStart = i;
  };

  while (i < sql.length) {
    const c = sql[i];
    // Line comment
    if (c === "-" && sql[i + 1] === "-") {
      const eol = sql.indexOf("\n", i);
      const end = eol < 0 ? sql.length : eol + 1;
      buf += sql.slice(i, end);
      i = end;
      continue;
    }
    // Block comment
    if (c === "/" && sql[i + 1] === "*") {
      const close = sql.indexOf("*/", i + 2);
      const end = close < 0 ? sql.length : close + 2;
      buf += sql.slice(i, end);
      i = end;
      continue;
    }
    // Single-quoted string
    if (c === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] !== "'") break;
        j += sql[j] === "'" ? 2 : 1;
      }
      buf += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    // Dollar-quoted literal
    if (c === "$") {
      DOLLAR_OPEN.lastIndex = i;
      const opener = DOLLAR_OPEN.exec(sql);
      if (opener && opener.index === i) {
        const tag = opener[0];
        const closeAt = sql.indexOf(tag, i + tag.length);
        const end = closeAt < 0 ? sql.length : closeAt + tag.length;
        buf += sql.slice(i, end);
        i = end;
        continue;
      }
    }
    if (c === ";") {
      buf += c;
      i += 1;
      push();
      continue;
    }
    buf += c;
    i += 1;
  }
  push();
  return out;
}

const CREATE_FUNCTION_HEAD =
  /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?<objectKind>FUNCTION|PROCEDURE)\s+(?:(?<schema>"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s*\.\s*)?(?<name>"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s*\(/i;

const CREATE_TRIGGER_HEAD =
  /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+(?<name>"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)/i;

const BODY_DELIMITED = /\$(?<tag>[A-Za-z_][A-Za-z0-9_]*)?\$(?<body>[\s\S]*?)\$\k<tag>\$/;

const EXECUTE_FUNCTION =
  /EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+(?:(?<schema>"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s*\.\s*)?(?<name>"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)/i;

const TRIGGER_ON_TABLE =
  /\bON\s+(?:(?<schema>"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s*\.\s*)?(?<name>"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)/i;

const TRIGGER_TIMING =
  /\b(?<timing>BEFORE|AFTER|INSTEAD\s+OF)\b/i;

const TRIGGER_EVENT_SECTION =
  /\b(?:BEFORE|AFTER|INSTEAD\s+OF)\b\s+(?<events>[\s\S]*?)\s+ON\b/i;

function parseTriggerEvents(rawEvents: string | undefined): string[] {
  if (!rawEvents) return [];
  const seen = new Set<string>();
  const events = rawEvents.match(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/gi) ?? [];
  for (const event of events) {
    seen.add(event.toUpperCase());
  }
  return [...seen];
}

// Strip leading whitespace and SQL comments (`-- line`, `/* block */`) from a
// statement's head so `^\s*CREATE` anchors match. Real-world Supabase-flavoured
// migrations commonly prefix each statement with a `-- ========== name ==========`
// banner, which previously caused `extractPgObjectsFromSql` to silently drop
// the function entirely (the head regex failed and the body was never
// recorded, leaving `function_table_refs` empty). Body text is extracted from
// the original statement afterwards, so comments inside dollar-quoted bodies
// stay intact.
function stripLeadingSqlComments(text: string): string {
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (char === " " || char === "\t" || char === "\r" || char === "\n") {
      index++;
      continue;
    }
    if (char === "-" && text[index + 1] === "-") {
      while (index < text.length && text[index] !== "\n") index++;
      continue;
    }
    if (char === "/" && text[index + 1] === "*") {
      index += 2;
      while (index < text.length - 1 && !(text[index] === "*" && text[index + 1] === "/")) {
        index++;
      }
      index = Math.min(index + 2, text.length);
      continue;
    }
    break;
  }
  return text.slice(index);
}

export function extractPgObjectsFromSql(
  sourceFilePath: string,
  content: string,
): ExtractedPgObject[] {
  const out: ExtractedPgObject[] = [];
  for (const stmt of splitStatements(content)) {
    // Head regex anchors at `^\s*CREATE`; SQL comment banners preceding the
    // statement break that anchor, so match against a leading-stripped view
    // and fall back to the original text for body / return-type extraction.
    const headText = stripLeadingSqlComments(stmt.text);
    const fnHead = CREATE_FUNCTION_HEAD.exec(headText);
    if (fnHead?.groups) {
      const { schema, name } = parseQualifiedName(
        fnHead.groups.schema ? `${fnHead.groups.schema}.${fnHead.groups.name}` : fnHead.groups.name!,
      );
      const openParenIndex = headText.indexOf("(", (fnHead.index ?? 0) + fnHead[0].length - 1);
      const closeParenIndex = openParenIndex >= 0 ? findMatchingParen(headText, openParenIndex) : -1;
      const argSignature =
        openParenIndex >= 0 && closeParenIndex > openParenIndex
          ? headText.slice(openParenIndex + 1, closeParenIndex)
          : "";
      const body = BODY_DELIMITED.exec(stmt.text);
      if (body?.groups?.body != null) {
        out.push({
          kind: "function",
          schema,
          name,
          objectKind: fnHead.groups.objectKind?.toLowerCase() === "procedure" ? "procedure" : "function",
          argTypes: parseFunctionArgTypes(argSignature),
          returnType: parseReturnType(stmt.text),
          bodyText: body.groups.body,
          file: sourceFilePath,
          line: lineNumberAtIndex(content, stmt.offset),
        });
      }
      continue;
    }
    const trigHead = CREATE_TRIGGER_HEAD.exec(headText);
    if (trigHead?.groups) {
      const name = stripIdentifierQuoting(trigHead.groups.name!);
      const tableMatch = TRIGGER_ON_TABLE.exec(stmt.text);
      const tableSchema = tableMatch?.groups?.schema
        ? stripIdentifierQuoting(tableMatch.groups.schema)
        : "public";
      const table = tableMatch?.groups
        ? stripIdentifierQuoting(tableMatch.groups.name!)
        : null;
      const timingMatch = TRIGGER_TIMING.exec(stmt.text);
      const eventSectionMatch = TRIGGER_EVENT_SECTION.exec(stmt.text);
      const execMatch = EXECUTE_FUNCTION.exec(stmt.text);
      const executesSchema = execMatch?.groups?.schema
        ? stripIdentifierQuoting(execMatch.groups.schema)
        : null;
      const executesFunction = execMatch?.groups?.name
        ? stripIdentifierQuoting(execMatch.groups.name)
        : null;
      out.push({
        kind: "trigger",
        schema: tableSchema,
        name,
        table,
        timing: timingMatch?.groups?.timing?.replace(/\s+/g, " ").toUpperCase() ?? "",
        events: parseTriggerEvents(eventSectionMatch?.groups?.events),
        executesSchema,
        executesFunction,
        bodyText: stmt.text.trim(),
        file: sourceFilePath,
        line: lineNumberAtIndex(content, stmt.offset),
      });
    }
  }
  return out;
}
