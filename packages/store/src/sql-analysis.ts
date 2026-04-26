function stripIdentifierQuoting(identifier: string): string {
  const trimmed = identifier.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1);
  return trimmed;
}

const FUNCTION_REF_SQL_KEYWORDS = new Set([
  "select",
  "where",
  "with",
  "using",
  "set",
  "values",
  "returning",
  "conflict",
  "having",
  "group",
  "order",
  "limit",
  "offset",
  "as",
  "on",
  "lateral",
]);

function stripSqlCommentsAndStrings(sql: string): string {
  let out = "";
  let index = 0;
  while (index < sql.length) {
    const char = sql[index]!;
    const next = sql[index + 1];

    if (char === "-" && next === "-") {
      while (index < sql.length && sql[index] !== "\n") {
        out += " ";
        index += 1;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      out += "  ";
      index += 2;
      while (index < sql.length - 1 && !(sql[index] === "*" && sql[index + 1] === "/")) {
        out += sql[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      if (index < sql.length - 1) {
        out += "  ";
        index += 2;
      }
      continue;
    }

    if (char === "'") {
      out += " ";
      index += 1;
      while (index < sql.length) {
        const inner = sql[index]!;
        out += inner === "\n" ? "\n" : " ";
        index += 1;
        if (inner === "'") {
          if (sql[index] === "'") {
            out += " ";
            index += 1;
            continue;
          }
          break;
        }
      }
      continue;
    }

    out += char;
    index += 1;
  }
  return out;
}

export function deriveFunctionTableRefs(bodyText: string): Array<{
  targetSchema: string;
  targetTable: string;
}> {
  const refs = new Map<string, { targetSchema: string; targetTable: string }>();
  const scanText = stripSqlCommentsAndStrings(bodyText);
  const patterns = [
    /\bFROM\s+(?:(["A-Za-z_][\w$]*)\s*\.\s*)?(["A-Za-z_][\w$"]*)/gi,
    /\bJOIN\s+(?:(["A-Za-z_][\w$]*)\s*\.\s*)?(["A-Za-z_][\w$"]*)/gi,
    /\bUPDATE\s+(?:(["A-Za-z_][\w$]*)\s*\.\s*)?(["A-Za-z_][\w$"]*)/gi,
    /\bINSERT\s+INTO\s+(?:(["A-Za-z_][\w$]*)\s*\.\s*)?(["A-Za-z_][\w$"]*)/gi,
    /\bDELETE\s+FROM\s+(?:(["A-Za-z_][\w$]*)\s*\.\s*)?(["A-Za-z_][\w$"]*)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of scanText.matchAll(pattern)) {
      const schema = stripIdentifierQuoting(match[1] ?? "public");
      const table = stripIdentifierQuoting(match[2] ?? "");
      if (!table) continue;
      if (FUNCTION_REF_SQL_KEYWORDS.has(table.toLowerCase())) continue;
      const key = `${schema}.${table}`;
      if (!refs.has(key)) refs.set(key, { targetSchema: schema, targetTable: table });
    }
  }
  return [...refs.values()];
}
