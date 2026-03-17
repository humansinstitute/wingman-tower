import { getDb } from '../db';
import { config } from '../config';
import type { CompleteStorageInput, PrepareStorageInput, V4StorageObject } from '../types';

function createS3Client(endpoint: string) {
  return new Bun.S3Client({
    accessKeyId: config.storage.s3AccessKey,
    secretAccessKey: config.storage.s3SecretKey,
    bucket: config.storage.s3Bucket,
    region: config.storage.s3Region,
    endpoint,
    virtualHostedStyle: !config.storage.s3ForcePathStyle,
  });
}

const storageBucket = createS3Client(config.storage.s3Endpoint);

function sanitizeFilename(name: string | null | undefined) {
  const trimmed = String(name || '').trim();
  const safe = trimmed.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
  return safe || 'file.bin';
}

function buildStorageKey(rowId: string, ownerNpub: string, fileName: string | null | undefined) {
  const datePrefix = new Date().toISOString().slice(0, 10);
  return `v4/${ownerNpub}/${datePrefix}/${rowId}-${sanitizeFilename(fileName)}`;
}

export async function prepareStorageObject(input: PrepareStorageInput, authNpub: string): Promise<V4StorageObject> {
  const sql = getDb();
  const fileName = String(input.file_name || '').trim() || null;
  const contentType = String(input.content_type || '').trim() || 'application/octet-stream';
  const sizeBytes = Number.isFinite(Number(input.size_bytes)) ? Number(input.size_bytes) : 0;
  const accessGroupNpubs = [...new Set((input.access_group_npubs || []).map((value) => String(value || '').trim()).filter(Boolean))];

  const [row] = await sql<V4StorageObject[]>`
    INSERT INTO v4_storage_objects (owner_npub, created_by_npub, access_group_npubs, file_name, content_type, size_bytes, storage_path)
    VALUES (${input.owner_npub}, ${authNpub}, ${accessGroupNpubs}, ${fileName}, ${contentType}, ${sizeBytes}, '')
    RETURNING *
  `;

  const storagePath = buildStorageKey(row.id, row.owner_npub, fileName);

  const [updated] = await sql<V4StorageObject[]>`
    UPDATE v4_storage_objects
    SET storage_path = ${storagePath}
    WHERE id = ${row.id}
    RETURNING *
  `;

  return updated;
}

export async function getStorageUploadUrl(objectId: string): Promise<string | null> {
  const row = await getStorageObject(objectId);
  if (!row || row.completed_at) return null;

  const publicEndpoint = config.storage.s3PublicEndpoint;
  if (!publicEndpoint) return null;

  const publicBucket = createS3Client(publicEndpoint);
  return publicBucket.presign(row.storage_path, {
    method: 'PUT',
    type: row.content_type || 'application/octet-stream',
    expiresIn: Math.max(60, config.storage.presignUploadTtlSeconds),
  });
}

export async function getStorageObject(objectId: string): Promise<V4StorageObject | null> {
  const sql = getDb();
  const [row] = await sql<V4StorageObject[]>`
    SELECT *
    FROM v4_storage_objects
    WHERE id = ${objectId}
    LIMIT 1
  `;
  return row || null;
}

export async function canAccessStorageObject(objectId: string, authNpub: string): Promise<V4StorageObject | null> {
  const sql = getDb();
  const row = await getStorageObject(objectId);
  if (!row) return null;
  if (row.owner_npub === authNpub || row.created_by_npub === authNpub) return row;

  const accessGroups = Array.isArray(row.access_group_npubs)
    ? row.access_group_npubs.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  if (accessGroups.length === 0) return null;

  const [membership] = await sql<{ ok: number }[]>`
    SELECT 1 AS ok
    FROM v4_group_epochs ge
    JOIN v4_group_members gm ON gm.group_id = ge.group_id
    WHERE ge.group_npub = ANY(${accessGroups})
      AND gm.member_npub = ${authNpub}
    LIMIT 1
  `;

  return membership?.ok ? row : null;
}

export async function completeStorageObject(objectId: string, input: CompleteStorageInput, authNpub: string): Promise<V4StorageObject | null> {
  const sql = getDb();
  const existing = await getStorageObject(objectId);
  if (!existing || existing.created_by_npub !== authNpub) return null;

  try {
    await storageBucket.stat(existing.storage_path);
  } catch {
    return null;
  }

  const [row] = await sql<V4StorageObject[]>`
    UPDATE v4_storage_objects
    SET
      sha256_hex = COALESCE(${input.sha256_hex || null}, sha256_hex),
      size_bytes = COALESCE(${Number.isFinite(Number(input.size_bytes)) ? Number(input.size_bytes) : null}, size_bytes),
      completed_at = NOW()
    WHERE id = ${objectId}
      AND created_by_npub = ${authNpub}
    RETURNING *
  `;
  return row || null;
}

export async function writeStorageObject(objectId: string, bytes: Uint8Array, authNpub: string): Promise<V4StorageObject | null> {
  const row = await getStorageObject(objectId);
  if (!row || row.created_by_npub !== authNpub) return null;
  await storageBucket.write(row.storage_path, bytes, { type: row.content_type || 'application/octet-stream' });
  return row;
}

export async function getStorageObjectContent(objectId: string): Promise<{ row: V4StorageObject; bytes: Uint8Array; size: number } | null> {
  const row = await getStorageObject(objectId);
  if (!row) return null;

  try {
    const stat = await storageBucket.stat(row.storage_path);
    const file = storageBucket.file(row.storage_path);
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { row, bytes, size: stat.size };
  } catch {
    return null;
  }
}

export async function getStorageDownloadUrl(objectId: string): Promise<string | null> {
  const row = await getStorageObject(objectId);
  if (!row || !row.completed_at) return null;

  const publicEndpoint = config.storage.s3PublicEndpoint;
  if (!publicEndpoint) return null;

  const publicBucket = createS3Client(publicEndpoint);
  return publicBucket.presign(row.storage_path, {
    expiresIn: Math.max(60, config.storage.presignDownloadTtlSeconds),
  });
}
