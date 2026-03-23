import { Hono } from 'hono';
import { syncRecords, fetchRecords, fetchRecordsSummary, heartbeatCheck } from '../services/records';
import { getCurrentGroupEpoch, getGroupByCurrentNpub } from '../services/groups';
import { requireNip98Auth, verifyNip98AuthHeader } from '../auth';
import type { FetchRecordsInput, FetchRecordsSummaryInput, HeartbeatRequestBody, SyncRequestBody } from '../types';

export const recordsRouter = new Hono();

function looksLikeUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function buildGroupWriteProofHash(body: SyncRequestBody) {
  return JSON.stringify({
    owner_npub: body.owner_npub,
    records: body.records,
  });
}

// POST /api/v4/records/sync
recordsRouter.post('/sync', async (c) => {
  const authNpub = await requireNip98Auth(c);
  if (authNpub instanceof Response) return authNpub;

  const rawBody = await c.req.raw.clone().text();
  const body = await c.req.json<SyncRequestBody>();

  if (!body.owner_npub) {
    return c.json({ error: 'owner_npub required' }, 400);
  }
  if (!body.records || !Array.isArray(body.records)) {
    return c.json({ error: 'records array required' }, 400);
  }

  try {
    const groupWriteProofPayload = buildGroupWriteProofHash(body);
    const overridePayloadHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(groupWriteProofPayload),
    ).then((digest) => Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join(''));

    const authorizedWriteGroups = new Set<string>();
    for (const [groupRef, token] of Object.entries(body.group_write_tokens || {})) {
      let targetGroupId = '';
      let targetGroupNpub = '';

      const currentEpoch = looksLikeUuid(groupRef) ? await getCurrentGroupEpoch(groupRef) : null;
      if (currentEpoch) {
        targetGroupId = currentEpoch.group_id;
        targetGroupNpub = currentEpoch.group_npub;
      } else {
        const group = await getGroupByCurrentNpub(groupRef);
        if (!group) continue;
        targetGroupId = group.id;
        targetGroupNpub = group.group_npub;
      }

      const proofNpub = await verifyNip98AuthHeader(token, c.req.raw, {
        rawBody,
        overridePayloadHash,
      });
      if (proofNpub && proofNpub === targetGroupNpub) {
        authorizedWriteGroups.add(targetGroupId);
      }
    }

    const result = await syncRecords(body.owner_npub, body.records, authNpub, authorizedWriteGroups);
    return c.json(result);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to sync records' }, 500);
  }
});

// POST /api/v4/records/heartbeat
recordsRouter.post('/heartbeat', async (c) => {
  const authNpub = await requireNip98Auth(c);
  if (authNpub instanceof Response) return authNpub;

  const body = await c.req.json<HeartbeatRequestBody>();
  if (!body.owner_npub) {
    return c.json({ error: 'owner_npub required' }, 400);
  }
  if (body.viewer_npub && body.viewer_npub !== authNpub) {
    return c.json({ error: 'viewer_npub must match authenticated npub' }, 403);
  }

  try {
    const result = await heartbeatCheck(
      body.owner_npub,
      body.viewer_npub || body.owner_npub,
      body.family_cursors || {},
    );
    return c.json(result);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Heartbeat failed' }, 500);
  }
});

// GET /api/v4/records/summary?owner_npub=<npub>&record_family_hash=<hash>&since=<iso>
recordsRouter.get('/summary', async (c) => {
  const authNpub = await requireNip98Auth(c);
  if (authNpub instanceof Response) return authNpub;

  const ownerNpub = c.req.query('owner_npub');
  const viewerNpub = c.req.query('viewer_npub');
  const recordFamilyHash = c.req.query('record_family_hash');
  const since = c.req.query('since');

  if (!ownerNpub) {
    return c.json({ error: 'owner_npub query param required' }, 400);
  }
  if (viewerNpub && viewerNpub !== authNpub) {
    return c.json({ error: 'viewer_npub must match authenticated npub' }, 403);
  }

  try {
    const families = await fetchRecordsSummary({
      owner_npub: ownerNpub,
      viewer_npub: authNpub,
      record_family_hash: recordFamilyHash || undefined,
      since: since || undefined,
    } satisfies FetchRecordsSummaryInput);
    return c.json({ families });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to fetch records summary' }, 500);
  }
});

// GET /api/v4/records?owner_npub=<npub>&record_family_hash=<hash>&since=<iso>
recordsRouter.get('/', async (c) => {
  const authNpub = await requireNip98Auth(c);
  if (authNpub instanceof Response) return authNpub;

  const ownerNpub = c.req.query('owner_npub');
  const viewerNpub = c.req.query('viewer_npub');
  const recordFamilyHash = c.req.query('record_family_hash');
  const since = c.req.query('since');

  if (!ownerNpub) {
    return c.json({ error: 'owner_npub query param required' }, 400);
  }
  if (!recordFamilyHash) {
    return c.json({ error: 'record_family_hash query param required' }, 400);
  }
  if (viewerNpub && viewerNpub !== authNpub) {
    return c.json({ error: 'viewer_npub must match authenticated npub' }, 403);
  }

  const limitParam = c.req.query('limit');
  const offsetParam = c.req.query('offset');
  const limit = limitParam ? parseInt(limitParam, 10) : undefined;
  const offset = offsetParam ? parseInt(offsetParam, 10) : undefined;

  try {
    const result = await fetchRecords({
      owner_npub: ownerNpub,
      viewer_npub: authNpub,
      record_family_hash: recordFamilyHash,
      since: since || undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
      offset: Number.isFinite(offset) ? offset : undefined,
    } satisfies FetchRecordsInput);
    return c.json(result);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to fetch records' }, 500);
  }
});
