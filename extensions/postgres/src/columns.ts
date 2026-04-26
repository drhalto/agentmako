import type { PgReadContext } from "./connection.js";
import type { PgResolvedTable } from "./identifiers.js";

export interface PgColumnDescriptor {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  isPrimaryKey: boolean;
  isIdentity: boolean;
  comment: string | null;
}

export async function fetchColumnsBulk(
  context: PgReadContext,
  oids: number[],
): Promise<Map<number, PgColumnDescriptor[]>> {
  const result = new Map<number, PgColumnDescriptor[]>();
  if (oids.length === 0) {
    return result;
  }

  const rows = await context.query<{
    relid: number;
    name: string;
    type: string;
    nullable: boolean;
    default: string | null;
    is_primary_key: boolean;
    is_identity: boolean;
    comment: string | null;
  }>(
    `SELECT
      a.attrelid::int AS relid,
      a.attname AS name,
      format_type(a.atttypid, a.atttypmod) AS type,
      NOT a.attnotnull AS nullable,
      pg_get_expr(ad.adbin, ad.adrelid) AS "default",
      COALESCE(pk.is_primary, false) AS is_primary_key,
      a.attidentity <> '' AS is_identity,
      col_description(a.attrelid, a.attnum) AS comment
     FROM pg_catalog.pg_attribute a
     LEFT JOIN pg_catalog.pg_attrdef ad
       ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
     LEFT JOIN (
       SELECT conrelid, unnest(conkey) AS attnum, true AS is_primary
       FROM pg_catalog.pg_constraint
       WHERE contype = 'p'
     ) pk ON pk.conrelid = a.attrelid AND pk.attnum = a.attnum
     WHERE a.attrelid = ANY($1::int[])
       AND a.attnum > 0
       AND NOT a.attisdropped
     ORDER BY a.attrelid, a.attnum`,
    [oids],
  );

  for (const row of rows.rows) {
    const bucket = result.get(row.relid);
    const descriptor: PgColumnDescriptor = {
      name: row.name,
      type: row.type,
      nullable: row.nullable,
      default: row.default ?? null,
      isPrimaryKey: row.is_primary_key,
      isIdentity: row.is_identity,
      comment: row.comment ?? null,
    };
    if (bucket) {
      bucket.push(descriptor);
    } else {
      result.set(row.relid, [descriptor]);
    }
  }

  return result;
}

export async function fetchColumns(
  context: PgReadContext,
  table: PgResolvedTable,
): Promise<PgColumnDescriptor[]> {
  const map = await fetchColumnsBulk(context, [table.oid]);
  return map.get(table.oid) ?? [];
}
