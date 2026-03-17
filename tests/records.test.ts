import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createHash } from 'crypto';
import postgres from 'postgres';
import { finalizeEvent, getPublicKey, nip19 } from 'nostr-tools';
import { setDb } from '../src/db';
import { createApp } from '../src/server';

const TEST_DB = process.env.TEST_DB_NAME || 'coworker_v4_test_records';

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

  // Run migrations
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

const ownerSecret = new Uint8Array(32).fill(11);
const memberSecret = new Uint8Array(32).fill(12);
const outsiderSecret = new Uint8Array(32).fill(13);
const groupSecret = new Uint8Array(32).fill(14);
const OWNER = nip19.npubEncode(getPublicKey(ownerSecret));
const MEMBER = nip19.npubEncode(getPublicKey(memberSecret));
const OUTSIDER = nip19.npubEncode(getPublicKey(outsiderSecret));
const GROUP_WRITE_NPUB = nip19.npubEncode(getPublicKey(groupSecret));
const FAMILY_HASH = 'chat_channel_abc123';
const GROUP_NPUB = 'npub1group_test_xyz';
const RECORD_ID = 'rec-001-uuid';

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

describe('Records API', () => {
  test('POST /api/v4/records/sync - create new record (v1)', async () => {
    const payload = {
      owner_npub: OWNER,
      records: [
        {
          record_id: RECORD_ID,
          owner_npub: OWNER,
          record_family_hash: FAMILY_HASH,
          version: 1,
          previous_version: 0,
          signature_npub: OWNER,
          owner_payload: { ciphertext: 'encrypted_hello_v1' },
          group_payloads: [
            {
              group_npub: GROUP_NPUB,
              ciphertext: 'group_encrypted_hello_v1',
              write: true,
            },
          ],
        },
      ],
    };
    const res = await app.request('/api/v4/records/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader('/api/v4/records/sync', 'POST', ownerSecret, payload),
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.synced).toBe(1);
    expect(body.created).toBe(1);
    expect(body.updated).toBe(0);
    expect(body.rejected).toHaveLength(0);
  });

  test('POST /api/v4/records/sync - update record (v2)', async () => {
    const payload = {
      owner_npub: OWNER,
      records: [
        {
          record_id: RECORD_ID,
          owner_npub: OWNER,
          record_family_hash: FAMILY_HASH,
          version: 2,
          previous_version: 1,
          signature_npub: OWNER,
          owner_payload: { ciphertext: 'encrypted_hello_v2' },
          group_payloads: [
            {
              group_npub: GROUP_NPUB,
              ciphertext: 'group_encrypted_hello_v2',
              write: true,
            },
          ],
        },
      ],
    };
    const res = await app.request('/api/v4/records/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader('/api/v4/records/sync', 'POST', ownerSecret, payload),
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.synced).toBe(1);
    expect(body.updated).toBe(1);
    expect(body.rejected).toHaveLength(0);
  });

  test('POST /api/v4/records/sync - reject stale previous_version', async () => {
    const payload = {
      owner_npub: OWNER,
      records: [
        {
          record_id: RECORD_ID,
          owner_npub: OWNER,
          record_family_hash: FAMILY_HASH,
          version: 2,
          previous_version: 1,
          signature_npub: OWNER,
          owner_payload: { ciphertext: 'stale_write' },
        },
      ],
    };
    const res = await app.request('/api/v4/records/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader('/api/v4/records/sync', 'POST', ownerSecret, payload),
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.synced).toBe(0);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0].record_id).toBe(RECORD_ID);
    expect(body.rejected[0].reason).toContain('version conflict');
  });

  test('POST /api/v4/records/sync - validates input', async () => {
    const payload = { owner_npub: OWNER };
    const res = await app.request('/api/v4/records/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader('/api/v4/records/sync', 'POST', ownerSecret, payload),
      },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(400);
  });

  test('GET /api/v4/records - fetch latest by record_family_hash', async () => {
    const path = `/api/v4/records?owner_npub=${OWNER}&record_family_hash=${FAMILY_HASH}`;
    const res = await app.request(path, {
      headers: {
        Authorization: authHeader(path, 'GET', ownerSecret),
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.records).toHaveLength(1);

    const rec = body.records[0];
    expect(rec.record_id).toBe(RECORD_ID);
    expect(rec.version).toBe(2);
    expect(rec.owner_payload.ciphertext).toBe('encrypted_hello_v2');
    expect(rec.group_payloads).toHaveLength(1);
    expect(rec.group_payloads[0].group_npub).toBe(GROUP_NPUB);
  });

  test('GET /api/v4/records - since filter', async () => {
    // Use a far-future date to get no results
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    const path = `/api/v4/records?owner_npub=${OWNER}&record_family_hash=${FAMILY_HASH}&since=${futureDate}`;
    const res = await app.request(path, {
      headers: {
        Authorization: authHeader(path, 'GET', ownerSecret),
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.records).toHaveLength(0);
  });

  test('GET /api/v4/records - member viewer only sees records shared to their groups', async () => {
    const createGroupPayload = {
      owner_npub: OWNER,
      name: 'Shared docs',
      group_npub: 'npub1shared_docs_group_test',
      member_keys: [
        {
          member_npub: OWNER,
          wrapped_group_nsec: 'wrapped_key_owner_shared',
          wrapped_by_npub: OWNER,
        },
        {
          member_npub: MEMBER,
          wrapped_group_nsec: 'wrapped_key_member_shared',
          wrapped_by_npub: OWNER,
        },
      ],
    };
    const groupRes = await app.request('/api/v4/groups', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader('/api/v4/groups', 'POST', ownerSecret, createGroupPayload),
      },
      body: JSON.stringify(createGroupPayload),
    });

    expect(groupRes.status).toBe(201);
    const groupBody = await groupRes.json();
    const sharedGroupNpub = groupBody.group_npub;

    const syncPayload = {
      owner_npub: OWNER,
      records: [
        {
          record_id: 'member-private-doc',
          owner_npub: OWNER,
          record_family_hash: 'coworker:document',
          version: 1,
          previous_version: 0,
          signature_npub: OWNER,
          owner_payload: { ciphertext: 'private_doc' },
        },
        {
          record_id: 'member-shared-doc',
          owner_npub: OWNER,
          record_family_hash: 'coworker:document',
          version: 1,
          previous_version: 0,
          signature_npub: OWNER,
          owner_payload: { ciphertext: 'shared_doc' },
          group_payloads: [
            {
              group_npub: sharedGroupNpub,
              ciphertext: 'shared_doc_for_member',
              write: false,
            },
          ],
        },
      ],
    };
    const syncRes = await app.request('/api/v4/records/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader('/api/v4/records/sync', 'POST', ownerSecret, syncPayload),
      },
      body: JSON.stringify(syncPayload),
    });

    expect(syncRes.status).toBe(200);

    const ownerFetchPath = `/api/v4/records?owner_npub=${OWNER}&viewer_npub=${OWNER}&record_family_hash=coworker:document`;
    const ownerFetchRes = await app.request(ownerFetchPath, {
      headers: {
        Authorization: authHeader(ownerFetchPath, 'GET', ownerSecret),
      },
    });
    expect(ownerFetchRes.status).toBe(200);
    const ownerFetchBody = await ownerFetchRes.json();
    expect(ownerFetchBody.records.map((record) => record.record_id)).toEqual(
      expect.arrayContaining(['member-private-doc', 'member-shared-doc'])
    );

    const memberFetchPath = `/api/v4/records?owner_npub=${OWNER}&viewer_npub=${MEMBER}&record_family_hash=coworker:document`;
    const memberFetchRes = await app.request(memberFetchPath, {
      headers: {
        Authorization: authHeader(memberFetchPath, 'GET', memberSecret),
      },
    });
    expect(memberFetchRes.status).toBe(200);
    const memberFetchBody = await memberFetchRes.json();
    expect(memberFetchBody.records).toHaveLength(1);
    expect(memberFetchBody.records[0].record_id).toBe('member-shared-doc');

    const outsiderFetchPath = `/api/v4/records?owner_npub=${OWNER}&viewer_npub=${OUTSIDER}&record_family_hash=coworker:document`;
    const outsiderFetchRes = await app.request(outsiderFetchPath, {
      headers: {
        Authorization: authHeader(outsiderFetchPath, 'GET', outsiderSecret),
      },
    });
    expect(outsiderFetchRes.status).toBe(200);
    const outsiderFetchBody = await outsiderFetchRes.json();
    expect(outsiderFetchBody.records).toHaveLength(0);
  });

  test('GET /api/v4/records - removed members keep access to old epoch records but not new epoch records', async () => {
    const createGroupPayload = {
      owner_npub: OWNER,
      name: 'Epoch test',
      group_npub: 'npub1epoch_test_group_v1',
      member_keys: [
        {
          member_npub: OWNER,
          wrapped_group_nsec: 'epoch1_owner_key',
          wrapped_by_npub: OWNER,
        },
        {
          member_npub: MEMBER,
          wrapped_group_nsec: 'epoch1_member_key',
          wrapped_by_npub: OWNER,
        },
      ],
    };
    const groupRes = await app.request('/api/v4/groups', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader('/api/v4/groups', 'POST', ownerSecret, createGroupPayload),
      },
      body: JSON.stringify(createGroupPayload),
    });
    expect(groupRes.status).toBe(201);
    const groupBody = await groupRes.json();

    const beforeRotatePayload = {
      owner_npub: OWNER,
      records: [
        {
          record_id: 'epoch-shared-v1',
          owner_npub: OWNER,
          record_family_hash: 'coworker:document',
          version: 1,
          previous_version: 0,
          signature_npub: OWNER,
          owner_payload: { ciphertext: 'epoch_1_owner_payload' },
          group_payloads: [
            {
              group_id: groupBody.group_id,
              group_epoch: 1,
              group_npub: groupBody.group_npub,
              ciphertext: 'epoch_1_group_payload',
              write: true,
            },
          ],
        },
      ],
    };
    const beforeRotateRes = await app.request('/api/v4/records/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader('/api/v4/records/sync', 'POST', ownerSecret, beforeRotatePayload),
      },
      body: JSON.stringify(beforeRotatePayload),
    });
    expect(beforeRotateRes.status).toBe(200);

    const rotatePath = `/api/v4/groups/${groupBody.group_id}/rotate`;
    const rotatePayload = {
      group_npub: 'npub1epoch_test_group_v2',
      member_keys: [
        {
          member_npub: OWNER,
          wrapped_group_nsec: 'epoch2_owner_key',
          wrapped_by_npub: OWNER,
        },
      ],
    };
    const rotateRes = await app.request(rotatePath, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader(rotatePath, 'POST', ownerSecret, rotatePayload),
      },
      body: JSON.stringify(rotatePayload),
    });
    expect(rotateRes.status).toBe(200);
    const rotateBody = await rotateRes.json();
    expect(rotateBody.current_epoch).toBe(2);

    const afterRotatePayload = {
      owner_npub: OWNER,
      records: [
        {
          record_id: 'epoch-shared-v2',
          owner_npub: OWNER,
          record_family_hash: 'coworker:document',
          version: 1,
          previous_version: 0,
          signature_npub: OWNER,
          owner_payload: { ciphertext: 'epoch_2_owner_payload' },
          group_payloads: [
            {
              group_id: groupBody.group_id,
              group_epoch: rotateBody.current_epoch,
              group_npub: rotateBody.group_npub,
              ciphertext: 'epoch_2_group_payload',
              write: true,
            },
          ],
        },
      ],
    };
    const afterRotateRes = await app.request('/api/v4/records/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader('/api/v4/records/sync', 'POST', ownerSecret, afterRotatePayload),
      },
      body: JSON.stringify(afterRotatePayload),
    });
    expect(afterRotateRes.status).toBe(200);

    const memberFetchPath = `/api/v4/records?owner_npub=${OWNER}&viewer_npub=${MEMBER}&record_family_hash=coworker:document`;
    const memberFetchRes = await app.request(memberFetchPath, {
      headers: {
        Authorization: authHeader(memberFetchPath, 'GET', memberSecret),
      },
    });
    expect(memberFetchRes.status).toBe(200);
    const memberFetchBody = await memberFetchRes.json();
    expect(memberFetchBody.records.map((record: any) => record.record_id)).toContain('epoch-shared-v1');
    expect(memberFetchBody.records.map((record: any) => record.record_id)).not.toContain('epoch-shared-v2');
  });

  test('GET /api/v4/records - requires owner_npub and record_family_hash', async () => {
    const res1 = await app.request('/api/v4/records', {
      headers: {
        Authorization: authHeader('/api/v4/records', 'GET', ownerSecret),
      },
    });
    expect(res1.status).toBe(400);

    const path = `/api/v4/records?owner_npub=${OWNER}`;
    const res2 = await app.request(path, {
      headers: {
        Authorization: authHeader(path, 'GET', ownerSecret),
      },
    });
    expect(res2.status).toBe(400);
  });

  test('POST /api/v4/records/sync - multiple records in one batch', async () => {
    const payload = {
      owner_npub: OWNER,
      records: [
        {
          record_id: 'rec-batch-1',
          owner_npub: OWNER,
          record_family_hash: 'chat_msg_hash',
          version: 1,
          previous_version: 0,
          signature_npub: OWNER,
          owner_payload: { ciphertext: 'msg1' },
        },
        {
          record_id: 'rec-batch-2',
          owner_npub: OWNER,
          record_family_hash: 'chat_msg_hash',
          version: 1,
          previous_version: 0,
          signature_npub: OWNER,
          owner_payload: { ciphertext: 'msg2' },
        },
      ],
    };
    const res = await app.request('/api/v4/records/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader('/api/v4/records/sync', 'POST', ownerSecret, payload),
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.synced).toBe(2);
    expect(body.created).toBe(2);
  });

  test('POST /api/v4/records/sync - member can create shared record with valid group write proof', async () => {
    const createGroupPayload = {
      owner_npub: OWNER,
      name: 'Writers',
      group_npub: GROUP_WRITE_NPUB,
      member_keys: [
        {
          member_npub: OWNER,
          wrapped_group_nsec: 'wrapped_owner_writer_key',
          wrapped_by_npub: OWNER,
        },
        {
          member_npub: MEMBER,
          wrapped_group_nsec: 'wrapped_member_writer_key',
          wrapped_by_npub: OWNER,
        },
      ],
    };
    const groupRes = await app.request('/api/v4/groups', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader('/api/v4/groups', 'POST', ownerSecret, createGroupPayload),
      },
      body: JSON.stringify(createGroupPayload),
    });
    expect(groupRes.status).toBe(201);

    const proofPayload = {
      owner_npub: OWNER,
      records: [
        {
          record_id: 'member-shared-write',
          owner_npub: OWNER,
          record_family_hash: 'coworker:chat_message',
          version: 1,
          previous_version: 0,
          signature_npub: MEMBER,
          write_group_npub: GROUP_WRITE_NPUB,
          owner_payload: { ciphertext: 'member_owner_payload' },
          group_payloads: [
            {
              group_npub: GROUP_WRITE_NPUB,
              ciphertext: 'member_group_payload',
              write: true,
            },
          ],
        },
      ],
    };
    const payload = {
      ...proofPayload,
      group_write_tokens: {
        [GROUP_WRITE_NPUB]: authHeader('/api/v4/records/sync', 'POST', groupSecret, proofPayload),
      },
    };

    const res = await app.request('/api/v4/records/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader('/api/v4/records/sync', 'POST', memberSecret, payload),
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.synced).toBe(1);
    expect(body.rejected).toHaveLength(0);
  });

  test('POST /api/v4/records/sync - member shared write without group proof is rejected', async () => {
    const proofPayload = {
      owner_npub: OWNER,
      records: [
        {
          record_id: 'member-shared-write-no-proof',
          owner_npub: OWNER,
          record_family_hash: 'coworker:chat_message',
          version: 1,
          previous_version: 0,
          signature_npub: MEMBER,
          write_group_npub: GROUP_WRITE_NPUB,
          owner_payload: { ciphertext: 'member_owner_payload' },
          group_payloads: [
            {
              group_npub: GROUP_WRITE_NPUB,
              ciphertext: 'member_group_payload',
              write: true,
            },
          ],
        },
      ],
    };

    const res = await app.request('/api/v4/records/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader('/api/v4/records/sync', 'POST', memberSecret, proofPayload),
      },
      body: JSON.stringify(proofPayload),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.synced).toBe(0);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0].reason).toContain('missing valid group write proof');
  });

  test('POST /api/v4/records/sync - document family preserves mixed read/write payloads', async () => {
    const payload = {
      owner_npub: OWNER,
      records: [
        {
          record_id: 'doc-001',
          owner_npub: OWNER,
          record_family_hash: 'coworker:document',
          version: 1,
          previous_version: 0,
          signature_npub: OWNER,
          owner_payload: { ciphertext: 'encrypted_doc_payload' },
          group_payloads: [
            {
              group_npub: 'group-readers',
              ciphertext: 'doc_for_readers',
              write: false,
            },
            {
              group_npub: 'group-editors',
              ciphertext: 'doc_for_editors',
              write: true,
            },
          ],
        },
      ],
    };
    const res = await app.request('/api/v4/records/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader('/api/v4/records/sync', 'POST', ownerSecret, payload),
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(1);
    expect(body.rejected).toHaveLength(0);

    const path = `/api/v4/records?owner_npub=${OWNER}&record_family_hash=coworker:document`;
    const fetchRes = await app.request(path, {
      headers: {
        Authorization: authHeader(path, 'GET', ownerSecret),
      },
    });
    expect(fetchRes.status).toBe(200);
    const fetchBody = await fetchRes.json();
    const documentRecord = fetchBody.records.find((record) => record.record_id === 'doc-001');
    expect(documentRecord).toBeDefined();
    expect(documentRecord.group_payloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ group_npub: 'group-readers', write: false }),
        expect.objectContaining({ group_npub: 'group-editors', write: true }),
      ])
    );
  });

  test('POST /api/v4/records/sync - directory family supports normal version updates', async () => {
    const createPayload = {
      owner_npub: OWNER,
      records: [
        {
          record_id: 'dir-001',
          owner_npub: OWNER,
          record_family_hash: 'coworker:directory',
          version: 1,
          previous_version: 0,
          signature_npub: OWNER,
          owner_payload: { ciphertext: 'directory_v1' },
        },
      ],
    };
    const createRes = await app.request('/api/v4/records/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader('/api/v4/records/sync', 'POST', ownerSecret, createPayload),
      },
      body: JSON.stringify(createPayload),
    });

    expect(createRes.status).toBe(200);

    const updatePayload = {
      owner_npub: OWNER,
      records: [
        {
          record_id: 'dir-001',
          owner_npub: OWNER,
          record_family_hash: 'coworker:directory',
          version: 2,
          previous_version: 1,
          signature_npub: OWNER,
          owner_payload: { ciphertext: 'directory_v2' },
        },
      ],
    };
    const updateRes = await app.request('/api/v4/records/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader('/api/v4/records/sync', 'POST', ownerSecret, updatePayload),
      },
      body: JSON.stringify(updatePayload),
    });

    expect(updateRes.status).toBe(200);
    const body = await updateRes.json();
    expect(body.updated).toBe(1);
    expect(body.rejected).toHaveLength(0);
  });

  test('GET /api/v4/records - rejects spoofed viewer_npub', async () => {
    const path = `/api/v4/records?owner_npub=${OWNER}&viewer_npub=${MEMBER}&record_family_hash=${FAMILY_HASH}`;
    const res = await app.request(path, {
      headers: {
        Authorization: authHeader(path, 'GET', ownerSecret),
      },
    });
    expect(res.status).toBe(403);
  });

  test('records sync/fetch treats ciphertext as opaque strings', async () => {
    const opaqueOwnerCiphertext = 'not-json-just-opaque-bytes-abc123!@#$%';
    const opaqueGroupCiphertext = 'also-opaque-group-payload-xyz789';

    const syncPayload = {
      owner_npub: OWNER,
      records: [
        {
          record_id: 'opaque-test-001',
          owner_npub: OWNER,
          record_family_hash: 'opaque_test_family',
          version: 1,
          previous_version: 0,
          signature_npub: OWNER,
          owner_payload: { ciphertext: opaqueOwnerCiphertext },
          group_payloads: [
            {
              group_npub: GROUP_NPUB,
              ciphertext: opaqueGroupCiphertext,
              write: false,
            },
          ],
        },
      ],
    };
    const syncRes = await app.request('/api/v4/records/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader('/api/v4/records/sync', 'POST', ownerSecret, syncPayload),
      },
      body: JSON.stringify(syncPayload),
    });
    expect(syncRes.status).toBe(200);
    const syncBody = await syncRes.json();
    expect(syncBody.created).toBe(1);

    const fetchPath = `/api/v4/records?owner_npub=${OWNER}&record_family_hash=opaque_test_family`;
    const fetchRes = await app.request(fetchPath, {
      headers: {
        Authorization: authHeader(fetchPath, 'GET', ownerSecret),
      },
    });
    expect(fetchRes.status).toBe(200);
    const fetchBody = await fetchRes.json();
    const rec = fetchBody.records.find((r: any) => r.record_id === 'opaque-test-001');
    expect(rec).toBeDefined();
    expect(rec.owner_payload.ciphertext).toBe(opaqueOwnerCiphertext);
    expect(rec.group_payloads[0].ciphertext).toBe(opaqueGroupCiphertext);
  });
});
