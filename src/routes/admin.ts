import { Hono } from 'hono';
import { requireNip98Auth } from '../auth';
import { buildAdminAgentConnectPackage, buildSuperBasedConnectionToken } from '../admin-token';
import { config } from '../config';
import { getDb } from '../db';

export const adminRouter = new Hono();

const VIEWER_TABLES = [
  'v4_workspaces',
  'v4_groups',
  'v4_group_epochs',
  'v4_group_members',
  'v4_group_member_keys',
  'v4_records',
  'v4_record_group_payloads',
  'v4_storage_objects',
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
    case 'v4_workspaces':
      return 'updated_at DESC, created_at DESC';
    case 'v4_records':
      return 'updated_at DESC, version DESC';
    case 'v4_record_group_payloads':
      return 'record_row_id DESC';
    case 'v4_storage_objects':
      return 'created_at DESC';
    case 'v4_group_members':
    case 'v4_group_member_keys':
    case 'v4_group_epochs':
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

adminRouter.get('/workspaces', async (c) => {
  const authNpub = await requireNip98Auth(c);
  if (authNpub instanceof Response) return authNpub;
  const adminError = requireAdminNpub(authNpub);
  if (adminError) return adminError;

  const sql = getDb();
  const workspaces = await sql<{
    workspace_id: string;
    workspace_owner_npub: string;
    creator_npub: string;
    name: string;
    description: string;
    default_group_id: string | null;
    default_group_npub: string | null;
    created_at: string;
    updated_at: string;
  }[]>`
    SELECT
      w.id AS workspace_id,
      w.workspace_owner_npub,
      w.creator_npub,
      w.name,
      w.description,
      w.default_group_id,
      g.group_npub AS default_group_npub,
      w.created_at,
      w.updated_at
    FROM v4_workspaces w
    LEFT JOIN v4_groups g
      ON g.id = w.default_group_id
    ORDER BY w.updated_at DESC, w.created_at DESC
  `;

  return c.json({
    viewer: authNpub,
    workspaces,
  });
});

adminRouter.get('/workspaces/:workspaceId/connection-token', async (c) => {
  const authNpub = await requireNip98Auth(c);
  if (authNpub instanceof Response) return authNpub;
  const adminError = requireAdminNpub(authNpub);
  if (adminError) return adminError;

  const workspaceId = String(c.req.param('workspaceId') || '').trim();
  const appNpub = String(c.req.query('app_npub') || '').trim();
  if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
  if (!appNpub) return c.json({ error: 'app_npub query param required' }, 400);

  const sql = getDb();
  const [workspace] = await sql<{
    workspace_id: string;
    workspace_owner_npub: string;
    creator_npub: string;
    name: string;
    description: string;
    default_group_id: string | null;
    default_group_npub: string | null;
    created_at: string;
    updated_at: string;
  }[]>`
    SELECT
      w.id AS workspace_id,
      w.workspace_owner_npub,
      w.creator_npub,
      w.name,
      w.description,
      w.default_group_id,
      g.group_npub AS default_group_npub,
      w.created_at,
      w.updated_at
    FROM v4_workspaces w
    LEFT JOIN v4_groups g
      ON g.id = w.default_group_id
    WHERE w.id = ${workspaceId}
    LIMIT 1
  `;

  if (!workspace) return c.json({ error: 'workspace not found' }, 404);

  const relayUrls = c.req.query('relay')
    ? [String(c.req.query('relay')).trim()].filter(Boolean)
    : [];

  const connectionToken = buildSuperBasedConnectionToken({
    directHttpsUrl: config.directHttpsUrl,
    serviceNpub: config.service.npub || null,
    workspaceOwnerNpub: workspace.workspace_owner_npub,
    appNpub,
    relayUrls,
  });

  const agentConnectPackage = buildAdminAgentConnectPackage({
    directHttpsUrl: config.directHttpsUrl,
    serviceNpub: config.service.npub || null,
    workspaceOwnerNpub: workspace.workspace_owner_npub,
    appNpub,
    relayUrls,
  });

  return c.json({
    viewer: authNpub,
    workspace,
    app_npub: appNpub,
    direct_https_url: config.directHttpsUrl,
    service_npub: config.service.npub || null,
    connection_token: connectionToken,
    agent_connect_package: agentConnectPackage,
  });
});
