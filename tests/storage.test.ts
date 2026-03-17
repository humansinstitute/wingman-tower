import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'crypto';
import postgres from 'postgres';
import { finalizeEvent, getPublicKey, nip19 } from 'nostr-tools';
import { setDb } from '../src/db';

const TEST_DB = process.env.TEST_DB_NAME || 'coworker_v4_test_storage';

let sql: ReturnType<typeof postgres>;
let app: any;

const ownerSecret = new Uint8Array(32).fill(21);
const memberSecret = new Uint8Array(32).fill(22);
const OWNER = nip19.npubEncode(getPublicKey(ownerSecret));
const MEMBER = nip19.npubEncode(getPublicKey(memberSecret));

function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

function authHeader(path: string, method: string, secret: Uint8Array, body?: string) {
  const url = `http://localhost${path}`;
  const tags = [
    ['u', url],
    ['method', method.toUpperCase()],
  ];

  if (body !== undefined && method.toUpperCase() !== 'GET') {
    tags.push(['payload', sha256Hex(body)]);
  }

  const event = finalizeEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  }, secret);

  return `Nostr ${Buffer.from(JSON.stringify(event), 'utf8').toString('base64')}`;
}

beforeAll(async () => {
  process.env.STORAGE_S3_ENDPOINT = process.env.STORAGE_S3_ENDPOINT || 'http://127.0.0.1:9000';
  process.env.STORAGE_S3_REGION = process.env.STORAGE_S3_REGION || 'us-east-1';
  process.env.STORAGE_S3_ACCESS_KEY = process.env.STORAGE_S3_ACCESS_KEY || 'superbased';
  process.env.STORAGE_S3_SECRET_KEY = process.env.STORAGE_S3_SECRET_KEY || 'superbased-secret';
  process.env.STORAGE_S3_BUCKET = process.env.STORAGE_S3_BUCKET || 'superbased-storage';
  process.env.STORAGE_S3_FORCE_PATH_STYLE = process.env.STORAGE_S3_FORCE_PATH_STYLE || 'true';

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

  const serverModule = await import('../src/server');
  app = serverModule.createApp();
});

afterAll(async () => {
  if (sql) await sql.end();
});

describe('Storage API', () => {
  test('prepare, upload, complete, and fetch content', async () => {
    const preparePayload = JSON.stringify({
      owner_npub: OWNER,
      content_type: 'audio/webm;codecs=opus',
      size_bytes: 4,
      file_name: 'note.webm',
    });

    const prepareRes = await app.request('/api/v4/storage/prepare', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader('/api/v4/storage/prepare', 'POST', ownerSecret, preparePayload),
      },
      body: preparePayload,
    });

    expect(prepareRes.status).toBe(200);
    const prepared = await prepareRes.json();
    expect(prepared.object_id).toBeTruthy();
    expect(prepared.content_url).toContain(`/api/v4/storage/${prepared.object_id}/content`);

    const bytes = new Uint8Array([1, 2, 3, 4]);
    const uploadPath = `/api/v4/storage/${prepared.object_id}`;
    const uploadPayload = JSON.stringify({
      base64_data: Buffer.from(bytes).toString('base64'),
    });
    const uploadRes = await app.request(uploadPath, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader(uploadPath, 'PUT', ownerSecret, uploadPayload),
      },
      body: uploadPayload,
    });
    expect(uploadRes.status).toBe(200);

    const completePath = `/api/v4/storage/${prepared.object_id}/complete`;
    const completePayload = JSON.stringify({
      sha256_hex: sha256Hex(bytes),
      size_bytes: bytes.byteLength,
    });
    const completeRes = await app.request(completePath, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader(completePath, 'POST', ownerSecret, completePayload),
      },
      body: completePayload,
    });
    expect(completeRes.status).toBe(200);
    const completed = await completeRes.json();
    expect(completed.content_url).toContain(`/api/v4/storage/${prepared.object_id}/content`);

    const metadataPath = `/api/v4/storage/${prepared.object_id}`;
    const metadataRes = await app.request(metadataPath, {
      headers: {
        Authorization: authHeader(metadataPath, 'GET', ownerSecret),
      },
    });
    expect(metadataRes.status).toBe(200);
    const metadata = await metadataRes.json();
    expect(metadata.object_id).toBe(prepared.object_id);
    expect(metadata.content_url).toContain(`/api/v4/storage/${prepared.object_id}/content`);
    expect(metadata.file_name).toBe('note.webm');

    const downloadUrlPath = `/api/v4/storage/${prepared.object_id}/download-url`;
    const downloadUrlRes = await app.request(downloadUrlPath, {
      headers: {
        Authorization: authHeader(downloadUrlPath, 'GET', ownerSecret),
      },
    });
    expect(downloadUrlRes.status).toBe(200);

    const contentPath = `/api/v4/storage/${prepared.object_id}/content`;
    const contentRes = await app.request(contentPath, {
      headers: {
        Authorization: authHeader(contentPath, 'GET', ownerSecret),
      },
    });
    expect(contentRes.status).toBe(200);
    const fetched = new Uint8Array(await contentRes.arrayBuffer());
    expect(Array.from(fetched)).toEqual([1, 2, 3, 4]);
    expect(contentRes.headers.get('content-type')).toContain('audio/webm');
  });

  test('group members can read blobs shared to an older rotated group epoch npub', async () => {
    const historicalGroupNpub = 'npub1storage_epoch_v1_test';
    const currentGroupNpub = 'npub1storage_epoch_v2_test';

    const preparePayload = JSON.stringify({
      owner_npub: OWNER,
      content_type: 'audio/webm;codecs=opus',
      size_bytes: 3,
      file_name: 'rotated-note.webm',
      access_group_npubs: [historicalGroupNpub],
    });

    const prepareRes = await app.request('/api/v4/storage/prepare', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader('/api/v4/storage/prepare', 'POST', ownerSecret, preparePayload),
      },
      body: preparePayload,
    });

    expect(prepareRes.status).toBe(200);
    const prepared = await prepareRes.json();

    const bytes = new Uint8Array([9, 8, 7]);
    const uploadPath = `/api/v4/storage/${prepared.object_id}`;
    const uploadPayload = JSON.stringify({
      base64_data: Buffer.from(bytes).toString('base64'),
    });
    const uploadRes = await app.request(uploadPath, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader(uploadPath, 'PUT', ownerSecret, uploadPayload),
      },
      body: uploadPayload,
    });
    expect(uploadRes.status).toBe(200);

    const completePath = `/api/v4/storage/${prepared.object_id}/complete`;
    const completePayload = JSON.stringify({
      sha256_hex: sha256Hex(bytes),
      size_bytes: bytes.byteLength,
    });
    const completeRes = await app.request(completePath, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader(completePath, 'POST', ownerSecret, completePayload),
      },
      body: completePayload,
    });
    expect(completeRes.status).toBe(200);

    await sql`
      INSERT INTO v4_groups (id, owner_npub, name, group_npub, group_kind)
      VALUES ('00000000-0000-0000-0000-000000000123', ${OWNER}, 'Other Stuff', ${currentGroupNpub}, 'shared')
    `;
    await sql`
      INSERT INTO v4_group_epochs (group_id, epoch, group_npub, created_by_npub)
      VALUES
        ('00000000-0000-0000-0000-000000000123', 1, ${historicalGroupNpub}, ${OWNER}),
        ('00000000-0000-0000-0000-000000000123', 2, ${currentGroupNpub}, ${OWNER})
    `;
    await sql`
      INSERT INTO v4_group_members (group_id, member_npub)
      VALUES ('00000000-0000-0000-0000-000000000123', ${MEMBER})
    `;

    const metadataPath = `/api/v4/storage/${prepared.object_id}`;
    const metadataRes = await app.request(metadataPath, {
      headers: {
        Authorization: authHeader(metadataPath, 'GET', memberSecret),
      },
    });
    expect(metadataRes.status).toBe(200);
    const metadata = await metadataRes.json();
    expect(metadata.object_id).toBe(prepared.object_id);
    expect(metadata.content_url).toContain(`/api/v4/storage/${prepared.object_id}/content`);

    const downloadUrlPath = `/api/v4/storage/${prepared.object_id}/download-url`;
    const downloadUrlRes = await app.request(downloadUrlPath, {
      headers: {
        Authorization: authHeader(downloadUrlPath, 'GET', memberSecret),
      },
    });
    expect(downloadUrlRes.status).toBe(200);

    const contentPath = `/api/v4/storage/${prepared.object_id}/content`;
    const contentRes = await app.request(contentPath, {
      headers: {
        Authorization: authHeader(contentPath, 'GET', memberSecret),
      },
    });
    expect(contentRes.status).toBe(200);
    const fetched = new Uint8Array(await contentRes.arrayBuffer());
    expect(Array.from(fetched)).toEqual([9, 8, 7]);
  });
});
