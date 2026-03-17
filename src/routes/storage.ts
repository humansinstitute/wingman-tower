import { Hono } from 'hono';
import { requireNip98Auth } from '../auth';
import {
  canAccessStorageObject,
  completeStorageObject,
  getStorageDownloadUrl,
  getStorageObjectContent,
  getStorageUploadUrl,
  prepareStorageObject,
  writeStorageObject,
} from '../services/storage';
import type { CompleteStorageInput, PrepareStorageInput } from '../types';

export const storageRouter = new Hono();

storageRouter.post('/prepare', async (c) => {
  const authNpub = await requireNip98Auth(c);
  if (authNpub instanceof Response) return authNpub;

  const body = await c.req.json<PrepareStorageInput>();
  if (!body?.owner_npub) return c.json({ error: 'owner_npub required' }, 400);
  if (!body?.content_type) return c.json({ error: 'content_type required' }, 400);

  try {
    const row = await prepareStorageObject(body, authNpub);
    const origin = new URL(c.req.url).origin;
    const uploadUrl = await getStorageUploadUrl(row.id);
    const downloadUrl = await getStorageDownloadUrl(row.id);
    return c.json({
      object_id: row.id,
      owner_npub: row.owner_npub,
      access_group_npubs: row.access_group_npubs,
      file_name: row.file_name,
      content_type: row.content_type,
      size_bytes: row.size_bytes,
      upload_url: uploadUrl || `${origin}/api/v4/storage/${row.id}`,
      complete_url: `${origin}/api/v4/storage/${row.id}/complete`,
      content_url: `${origin}/api/v4/storage/${row.id}/content`,
      download_url: downloadUrl || `${origin}/api/v4/storage/${row.id}/content`,
      completed_at: row.completed_at instanceof Date ? row.completed_at.toISOString() : row.completed_at,
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to prepare storage object' }, 500);
  }
});

storageRouter.get('/:objectId', async (c) => {
  const authNpub = await requireNip98Auth(c);
  if (authNpub instanceof Response) return authNpub;

  const objectId = c.req.param('objectId');
  if (!objectId) return c.json({ error: 'objectId required' }, 400);

  const row = await canAccessStorageObject(objectId, authNpub);
  if (!row) return c.json({ error: 'storage object not found or not readable by this npub' }, 404);

  const origin = new URL(c.req.url).origin;
  const downloadUrl = row.completed_at ? await getStorageDownloadUrl(row.id) : null;
  return c.json({
    object_id: row.id,
    owner_npub: row.owner_npub,
    created_by_npub: row.created_by_npub,
    access_group_npubs: row.access_group_npubs,
    file_name: row.file_name,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    sha256_hex: row.sha256_hex,
    content_url: `${origin}/api/v4/storage/${row.id}/content`,
    download_url: downloadUrl,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    completed_at: row.completed_at instanceof Date ? row.completed_at.toISOString() : row.completed_at,
  });
});

storageRouter.put('/:objectId', async (c) => {
  const authNpub = await requireNip98Auth(c);
  if (authNpub instanceof Response) return authNpub;

  const objectId = c.req.param('objectId');
  if (!objectId) return c.json({ error: 'objectId required' }, 400);

  const body = await c.req.json<{ base64_data?: string }>().catch(() => ({}));
  const base64Data = String(body?.base64_data || '').trim();
  if (!base64Data) return c.json({ error: 'base64_data required' }, 400);

  const buffer = new Uint8Array(Buffer.from(base64Data, 'base64'));
  const row = await writeStorageObject(objectId, buffer, authNpub);
  if (!row) return c.json({ error: 'storage object not found or not writable by this npub' }, 404);

  return c.json({
    object_id: row.id,
    size_bytes: buffer.byteLength,
    content_type: row.content_type,
  });
});

storageRouter.post('/:objectId/complete', async (c) => {
  const authNpub = await requireNip98Auth(c);
  if (authNpub instanceof Response) return authNpub;

  const objectId = c.req.param('objectId');
  if (!objectId) return c.json({ error: 'objectId required' }, 400);

  const body = await c.req.json<CompleteStorageInput>().catch(() => ({} as CompleteStorageInput));
  const row = await completeStorageObject(objectId, body, authNpub);
  if (!row) return c.json({ error: 'storage object not found or not writable by this npub' }, 404);

  return c.json({
    object_id: row.id,
    owner_npub: row.owner_npub,
    access_group_npubs: row.access_group_npubs,
    file_name: row.file_name,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    content_url: `${new URL(c.req.url).origin}/api/v4/storage/${row.id}/content`,
    completed_at: row.completed_at instanceof Date ? row.completed_at.toISOString() : row.completed_at,
  });
});

storageRouter.get('/:objectId/download-url', async (c) => {
  const authNpub = await requireNip98Auth(c);
  if (authNpub instanceof Response) return authNpub;

  const objectId = c.req.param('objectId');
  if (!objectId) return c.json({ error: 'objectId required' }, 400);
  const row = await canAccessStorageObject(objectId, authNpub);
  if (!row) return c.json({ error: 'storage object not found or not readable by this npub' }, 404);

  const origin = new URL(c.req.url).origin;
  return c.json({
    object_id: row.id,
    content_url: `${origin}/api/v4/storage/${row.id}/content`,
    download_url: (await getStorageDownloadUrl(row.id)) || `${origin}/api/v4/storage/${row.id}/content`,
  });
});

storageRouter.get('/:objectId/content', async (c) => {
  const authNpub = await requireNip98Auth(c);
  if (authNpub instanceof Response) return authNpub;

  const objectId = c.req.param('objectId');
  if (!objectId) return c.json({ error: 'objectId required' }, 400);
  const row = await canAccessStorageObject(objectId, authNpub);
  if (!row) return c.json({ error: 'storage object not found or not readable by this npub' }, 404);
  const content = await getStorageObjectContent(objectId);
  if (!content) return c.json({ error: 'storage object content missing' }, 404);
  const { bytes, size } = content;
  if (!row.completed_at) return c.json({ error: 'storage object upload not completed' }, 409);

  return new Response(bytes, {
    headers: {
      'Content-Type': row.content_type || 'application/octet-stream',
      'Content-Length': String(row.size_bytes || size || 0),
      'Content-Disposition': `inline; filename=\"${row.file_name || `${row.id}.bin`}\"`,
      'Cache-Control': 'private, max-age=300',
    },
  });
});
