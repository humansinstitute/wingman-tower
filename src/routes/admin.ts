import { Hono } from 'hono';
import { requireNip98Auth } from '../auth';
import { config } from '../config';
import { getDb } from '../db';

export const adminRouter = new Hono();

const VIEWER_TABLES = [
  'v4_groups',
  'v4_group_members',
  'v4_group_member_keys',
  'v4_records',
  'v4_record_group_payloads',
] as const;

type ViewerTableName = (typeof VIEWER_TABLES)[number];

function isViewerTableName(value: string): value is ViewerTableName {
  return VIEWER_TABLES.includes(value as ViewerTableName);
}

function normalizeLimit(value: string | undefined): number {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 100;
  return Math.min(parsed, 500);
}

function normalizeOffset(value: string | undefined): number {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function defaultOrderBy(table: ViewerTableName): string {
  switch (table) {
    case 'v4_records':
      return 'updated_at DESC, version DESC';
    case 'v4_record_group_payloads':
      return 'record_row_id DESC';
    case 'v4_group_members':
    case 'v4_group_member_keys':
      return 'created_at DESC';
    case 'v4_groups':
    default:
      return 'created_at DESC';
  }
}

function requireAdminNpub(authNpub: string) {
  if (authNpub !== config.adminNpub) {
    return new Response(JSON.stringify({ error: 'admin npub required' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }
  return null;
}

adminRouter.get('/tables', async (c) => {
  const authNpub = await requireNip98Auth(c);
  if (authNpub instanceof Response) return authNpub;
  const adminError = requireAdminNpub(authNpub);
  if (adminError) return adminError;

  const sql = getDb();
  const tables = [];

  for (const tableName of VIEWER_TABLES) {
    const columns = await sql.unsafe<{ column_name: string; data_type: string }[]>(
      `
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = '${tableName}'
        ORDER BY ordinal_position
      `
    );

    const [countRow] = await sql.unsafe<{ count: string }[]>(
      `SELECT COUNT(*)::text AS count FROM ${tableName}`
    );

    tables.push({
      table: tableName,
      row_count: Number.parseInt(countRow?.count || '0', 10),
      columns,
    });
  }

  return c.json({
    viewer: authNpub,
    tables,
  });
});

adminRouter.get('/tables/:table', async (c) => {
  const authNpub = await requireNip98Auth(c);
  if (authNpub instanceof Response) return authNpub;
  const adminError = requireAdminNpub(authNpub);
  if (adminError) return adminError;

  const table = c.req.param('table');
  if (!isViewerTableName(table)) {
    return c.json({ error: 'unknown table' }, 404);
  }

  const limit = normalizeLimit(c.req.query('limit'));
  const offset = normalizeOffset(c.req.query('offset'));
  const sql = getDb();

  const columns = await sql.unsafe<{ column_name: string; data_type: string }[]>(
    `
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = '${table}'
      ORDER BY ordinal_position
    `
  );

  const [countRow] = await sql.unsafe<{ count: string }[]>(
    `SELECT COUNT(*)::text AS count FROM ${table}`
  );

  const rows = await sql.unsafe<Record<string, unknown>[]>(
    `SELECT * FROM ${table} ORDER BY ${defaultOrderBy(table)} LIMIT ${limit} OFFSET ${offset}`
  );

  return c.json({
    viewer: authNpub,
    table,
    row_count: Number.parseInt(countRow?.count || '0', 10),
    limit,
    offset,
    columns,
    rows,
  });
});
