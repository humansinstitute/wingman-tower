import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createHash } from 'crypto';
import postgres from 'postgres';
import { finalizeEvent, getPublicKey, nip19 } from 'nostr-tools';
import { setDb } from '../src/db';
import { createApp } from '../src/server';

const TEST_DB = process.env.TEST_DB_NAME || 'coworker_v4_test_workspaces';

let sql: ReturnType<typeof postgres>;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  const adminOpts: Parameters<typeof postgres>[0] = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: 'postgres',
  };
  if (process.env.DB_USER) adminOpts.username = process.env.DB_USER;
  if (process.env.DB_PASSWORD) adminOpts.password = process.env.DB_PASSWORD;

  const admin = postgres(adminOpts);
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await admin.unsafe(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await admin.end();
  }

  const testOpts: Parameters<typeof postgres>[0] = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: TEST_DB,
  };
  if (process.env.DB_USER) testOpts.username = process.env.DB_USER;
  if (process.env.DB_PASSWORD) testOpts.password = process.env.DB_PASSWORD;

  sql = postgres(testOpts);
  setDb(sql);

  const { readFileSync } = await import('fs');
  const { join, dirname } = await import('path');
  const { fileURLToPath } = await import('url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const migration = readFileSync(join(__dirname, '../src/schema/001_init.sql'), 'utf-8');
  const statements = migration
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await sql.unsafe(stmt);
  }

  app = createApp();
});

afterAll(async () => {
  if (sql) await sql.end();
});

const ownerSecret = new Uint8Array(32).fill(9);
const memberSecret = new Uint8Array(32).fill(8);
const OWNER = nip19.npubEncode(getPublicKey(ownerSecret));
const MEMBER = nip19.npubEncode(getPublicKey(memberSecret));
const WORKSPACE_OWNER = 'npub1workspaceowner000000000000000000000000000000000000000000';

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function authHeader(path: string, method: string, secret: Uint8Array, body?: unknown) {
  const url = `http://localhost${path}`;
  const tags = [
    ['u', url],
    ['method', method.toUpperCase()],
  ];

  if (body !== undefined) {
    tags.push(['payload', sha256Hex(JSON.stringify(body))]);
  }

  const event = finalizeEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  }, secret);

  return `Nostr ${Buffer.from(JSON.stringify(event), 'utf8').toString('base64')}`;
}

describe('Workspaces API', () => {
  test('POST /api/v4/workspaces creates workspace plus default and private groups', async () => {
    const payload = {
      workspace_owner_npub: WORKSPACE_OWNER,
      name: 'Winn Family',
      description: 'Family workspace',
      wrapped_workspace_nsec: 'wrapped-workspace-secret',
      wrapped_by_npub: OWNER,
      default_group_npub: 'npub1workspacegroup000000000000000000000000000000000000000000',
      default_group_name: 'Family Shared',
      default_group_member_keys: [
        { member_npub: OWNER, wrapped_group_nsec: 'wrapped-shared-owner', wrapped_by_npub: OWNER },
      ],
      private_group_npub: 'npub1privategroup0000000000000000000000000000000000000000000',
      private_group_name: 'Pete Private',
      private_group_member_keys: [
        { member_npub: OWNER, wrapped_group_nsec: 'wrapped-private-owner', wrapped_by_npub: OWNER },
      ],
    };

    const res = await app.request('/api/v4/workspaces', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader('/api/v4/workspaces', 'POST', ownerSecret, payload),
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.workspace_owner_npub).toBe(WORKSPACE_OWNER);
    expect(body.name).toBe('Winn Family');
    expect(body.default_group_npub).toBe(payload.default_group_npub);
    expect(body.private_group_npub).toBe(payload.private_group_npub);
    expect(body.wrapped_workspace_nsec).toBe('wrapped-workspace-secret');
  });

  test('GET /api/v4/workspaces lists owned workspace for creator', async () => {
    const res = await app.request(`/api/v4/workspaces?member_npub=${encodeURIComponent(OWNER)}`, {
      headers: {
        Authorization: authHeader(`/api/v4/workspaces?member_npub=${encodeURIComponent(OWNER)}`, 'GET', ownerSecret),
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaces).toHaveLength(1);
    expect(body.workspaces[0].workspace_owner_npub).toBe(WORKSPACE_OWNER);
    expect(body.workspaces[0].private_group_npub).toBeDefined();
    expect(body.workspaces[0].wrapped_workspace_nsec).toBe('wrapped-workspace-secret');
  });

  test('GET /api/v4/workspaces rejects mismatched auth', async () => {
    const res = await app.request(`/api/v4/workspaces?member_npub=${encodeURIComponent(OWNER)}`, {
      headers: {
        Authorization: authHeader(`/api/v4/workspaces?member_npub=${encodeURIComponent(OWNER)}`, 'GET', memberSecret),
      },
    });

    expect(res.status).toBe(403);
  });

  test('POST /api/v4/groups allows workspace creator to create a workspace-owned group with their own wrapped key', async () => {
    const payload = {
      owner_npub: WORKSPACE_OWNER,
      name: 'Parents',
      group_npub: 'npub1parentsgroup000000000000000000000000000000000000000000',
      member_keys: [
        { member_npub: OWNER, wrapped_group_nsec: 'wrapped-creator-key', wrapped_by_npub: OWNER },
        { member_npub: MEMBER, wrapped_group_nsec: 'wrapped-member-key', wrapped_by_npub: OWNER },
      ],
    };

    const res = await app.request('/api/v4/groups', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader('/api/v4/groups', 'POST', ownerSecret, payload),
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.owner_npub).toBe(WORKSPACE_OWNER);
    expect(body.name).toBe('Parents');
  });
});
