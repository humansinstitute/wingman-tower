import { getDb } from '../db';
import type {
  FetchRecordsInput,
  FetchRecordsSummaryInput,
  GroupPayloadInput,
  HeartbeatResponse,
  PaginatedRecordsResponse,
  RecordFamilySummary,
  SyncRecordInput,
  SyncResult,
  V4Record,
  V4RecordGroupPayload,
  RecordResponse,
} from '../types';

async function resolveWriteGroup(sql: ReturnType<typeof getDb>, rec: SyncRecordInput) {
  const writeGroupId = String(rec.write_group_id || '').trim();
  if (writeGroupId) {
    const [row] = await sql<{ group_id: string; group_npub: string; epoch: number }[]>`
      SELECT g.id AS group_id, ge.group_npub, ge.epoch
      FROM v4_groups g
      JOIN v4_group_epochs ge
        ON ge.group_id = g.id
      WHERE g.id = ${writeGroupId}
      ORDER BY ge.epoch DESC
      LIMIT 1
    `;
    return row ?? null;
  }

  const writeGroupNpub = String(rec.write_group_npub || '').trim();
  if (!writeGroupNpub) return null;

  const [row] = await sql<{ group_id: string; group_npub: string; epoch: number }[]>`
    SELECT g.id AS group_id, ge.group_npub, ge.epoch
    FROM v4_groups g
    JOIN v4_group_epochs ge
      ON ge.group_id = g.id
     AND ge.group_npub = g.group_npub
    WHERE g.group_npub = ${writeGroupNpub}
    LIMIT 1
  `;
  return row ?? null;
}

async function resolvePayloadGroup(sql: ReturnType<typeof getDb>, payload: GroupPayloadInput) {
  const groupId = String(payload.group_id || '').trim();
  if (groupId) {
    const targetEpoch = Number.isInteger(payload.group_epoch) ? payload.group_epoch : null;
    const rows = targetEpoch == null
      ? await sql<{ group_id: string; group_npub: string; epoch: number }[]>`
          SELECT ge.group_id, ge.group_npub, ge.epoch
          FROM v4_group_epochs ge
          WHERE ge.group_id = ${groupId}
          ORDER BY ge.epoch DESC
          LIMIT 1
        `
      : await sql<{ group_id: string; group_npub: string; epoch: number }[]>`
          SELECT ge.group_id, ge.group_npub, ge.epoch
          FROM v4_group_epochs ge
          WHERE ge.group_id = ${groupId}
            AND ge.epoch = ${targetEpoch}
          LIMIT 1
        `;
    return rows[0] ?? {
      group_id: groupId,
      group_npub: String(payload.group_npub || '').trim(),
      epoch: targetEpoch,
    };
  }

  const groupNpub = String(payload.group_npub || '').trim();
  if (!groupNpub) return null;

  const [row] = await sql<{ group_id: string; group_npub: string; epoch: number }[]>`
    SELECT ge.group_id, ge.group_npub, ge.epoch
    FROM v4_group_epochs ge
    WHERE ge.group_npub = ${groupNpub}
    LIMIT 1
  `;

  return row ?? {
      group_id: null,
      group_npub: groupNpub,
      epoch: Number.isInteger(payload.group_epoch) ? payload.group_epoch : null,
    };
}

/**
 * Sync records with version-chain enforcement.
 * - New record (version=1, previous_version=0): insert if record_id doesn't exist
 * - Update (version=N, previous_version=N-1): insert only if latest version == previous_version
 * - Reject stale writes where previous_version doesn't match latest
 */
export async function syncRecords(
  ownerNpub: string,
  inputs: SyncRecordInput[],
  authNpub: string,
  authorizedWriteGroups: Set<string> = new Set(),
): Promise<SyncResult> {
  const sql = getDb();
  let created = 0;
  let updated = 0;
  const rejected: { record_id: string; reason: string }[] = [];

  for (const rec of inputs) {
    // Validate owner matches
    if (rec.owner_npub !== ownerNpub) {
      rejected.push({ record_id: rec.record_id, reason: 'owner_npub mismatch' });
      continue;
    }
    if (rec.signature_npub !== authNpub) {
      rejected.push({ record_id: rec.record_id, reason: 'signature_npub must match authenticated npub' });
      continue;
    }

    // Find the current latest version for this record_id
    const [latest] = await sql<V4Record[]>`
      SELECT * FROM v4_records
      WHERE record_id = ${rec.record_id}
      ORDER BY version DESC
      LIMIT 1
    `;

    const currentVersion = latest?.version ?? 0;

    // Enforce version chain
    if (rec.previous_version !== currentVersion) {
      rejected.push({
        record_id: rec.record_id,
        reason: `version conflict: expected previous_version=${currentVersion}, got ${rec.previous_version}`,
      });
      continue;
    }

    if (rec.version !== currentVersion + 1) {
      rejected.push({
        record_id: rec.record_id,
        reason: `version must be ${currentVersion + 1}, got ${rec.version}`,
      });
      continue;
    }

    const isOwnerWrite = authNpub === ownerNpub;
    if (!isOwnerWrite) {
      const writeGroup = await resolveWriteGroup(sql, rec);
      if (!writeGroup?.group_id) {
        rejected.push({
          record_id: rec.record_id,
          reason: 'write_group_id or current write_group_npub required for non-owner writes',
        });
        continue;
      }
      if (!authorizedWriteGroups.has(writeGroup.group_id)) {
        rejected.push({
          record_id: rec.record_id,
          reason: `missing valid group write proof for ${writeGroup.group_id}`,
        });
        continue;
      }

      const [membership] = await sql<{ ok: number }[]>`
        SELECT 1 as ok
        FROM v4_group_members gm
        WHERE gm.group_id = ${writeGroup.group_id}
          AND gm.member_npub = ${authNpub}
        LIMIT 1
      `;
      if (!membership?.ok) {
        rejected.push({
          record_id: rec.record_id,
          reason: `authenticated npub is not a current member of ${writeGroup.group_id}`,
        });
        continue;
      }

      if (currentVersion === 0) {
        const sharedToGroup = (rec.group_payloads || []).some((gp) =>
          gp.write === true
          && (
            String(gp.group_id || '').trim() === writeGroup.group_id
            || String(gp.group_npub || '').trim() === writeGroup.group_npub
          )
        );
        if (!sharedToGroup) {
          rejected.push({
            record_id: rec.record_id,
            reason: `new shared record must include writable payload for ${writeGroup.group_id}`,
          });
          continue;
        }
      } else {
        const [groupAccess] = await sql<{ ok: number }[]>`
          SELECT 1 as ok
          FROM v4_record_group_payloads
          WHERE record_row_id = ${latest.id}
            AND (
              group_id = ${writeGroup.group_id}
              OR group_npub = ${writeGroup.group_npub}
            )
            AND can_write = TRUE
          LIMIT 1
        `;
        if (!groupAccess?.ok) {
          rejected.push({
            record_id: rec.record_id,
            reason: `group ${writeGroup.group_id} does not have write access on prior version`,
          });
          continue;
        }
      }
    }

    // Insert the new version row
    const [row] = await sql<V4Record[]>`
      INSERT INTO v4_records (record_id, owner_npub, record_family_hash, version, previous_version, signature_npub, owner_ciphertext)
      VALUES (${rec.record_id}, ${rec.owner_npub}, ${rec.record_family_hash}, ${rec.version}, ${rec.previous_version}, ${rec.signature_npub}, ${rec.owner_payload.ciphertext})
      RETURNING *
    `;

    // Insert group payloads
    if (rec.group_payloads && rec.group_payloads.length > 0) {
      for (const gp of rec.group_payloads) {
        const resolvedGroup = await resolvePayloadGroup(sql, gp);
        await sql`
          INSERT INTO v4_record_group_payloads (record_row_id, group_id, group_epoch, group_npub, ciphertext, can_write)
          VALUES (
            ${row.id},
            ${resolvedGroup?.group_id ?? null},
            ${resolvedGroup?.epoch ?? null},
            ${resolvedGroup?.group_npub || gp.group_npub},
            ${gp.ciphertext},
            ${gp.write}
          )
        `;
      }
    }

    if (currentVersion === 0) {
      created++;
    } else {
      updated++;
    }
  }

  return {
    synced: created + updated,
    created,
    updated,
    rejected,
  };
}

/**
 * Fetch the latest version of each record matching the filters.
 * Supports pagination via limit/offset.
 */
export async function fetchRecords(
  input: FetchRecordsInput
): Promise<PaginatedRecordsResponse> {
  const sql = getDb();
  const ownerNpub = input.owner_npub;
  const viewerNpub = input.viewer_npub || ownerNpub;
  const recordFamilyHash = input.record_family_hash;
  const since = input.since;
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 1000);
  const offset = Math.max(input.offset ?? 0, 0);

  let rows: V4Record[];
  let total: number;

  if (since) {
    // Count total visible records
    const [countRow] = await sql<{ count: string }[]>`
      WITH latest_records AS (
        SELECT DISTINCT ON (record_id) *
        FROM v4_records
        WHERE owner_npub = ${ownerNpub}
          AND record_family_hash = ${recordFamilyHash}
          AND updated_at > ${since}
        ORDER BY record_id, version DESC
      )
      SELECT COUNT(*)::text AS count
      FROM latest_records
      WHERE ${viewerNpub} = ${ownerNpub}
      OR EXISTS (
        SELECT 1
        FROM v4_record_group_payloads rgp
        JOIN v4_group_member_keys gmk
          ON gmk.group_id = rgp.group_id
         AND gmk.key_version = rgp.group_epoch
         AND gmk.member_npub = ${viewerNpub}
         AND gmk.revoked_at IS NULL
        WHERE rgp.record_row_id = latest_records.id
      )
    `;
    total = parseInt(countRow.count, 10);

    rows = await sql<V4Record[]>`
      WITH latest_records AS (
        SELECT DISTINCT ON (record_id) *
        FROM v4_records
        WHERE owner_npub = ${ownerNpub}
          AND record_family_hash = ${recordFamilyHash}
          AND updated_at > ${since}
        ORDER BY record_id, version DESC
      )
        SELECT latest_records.*
        FROM latest_records
        WHERE ${viewerNpub} = ${ownerNpub}
        OR EXISTS (
          SELECT 1
          FROM v4_record_group_payloads rgp
          JOIN v4_group_member_keys gmk
            ON gmk.group_id = rgp.group_id
           AND gmk.key_version = rgp.group_epoch
           AND gmk.member_npub = ${viewerNpub}
           AND gmk.revoked_at IS NULL
          WHERE rgp.record_row_id = latest_records.id
        )
      ORDER BY latest_records.updated_at ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    // Count total visible records
    const [countRow] = await sql<{ count: string }[]>`
      WITH latest_records AS (
        SELECT DISTINCT ON (record_id) *
        FROM v4_records
        WHERE owner_npub = ${ownerNpub}
          AND record_family_hash = ${recordFamilyHash}
        ORDER BY record_id, version DESC
      )
      SELECT COUNT(*)::text AS count
      FROM latest_records
      WHERE ${viewerNpub} = ${ownerNpub}
      OR EXISTS (
        SELECT 1
        FROM v4_record_group_payloads rgp
        JOIN v4_group_member_keys gmk
          ON gmk.group_id = rgp.group_id
         AND gmk.key_version = rgp.group_epoch
         AND gmk.member_npub = ${viewerNpub}
         AND gmk.revoked_at IS NULL
        WHERE rgp.record_row_id = latest_records.id
      )
    `;
    total = parseInt(countRow.count, 10);

    rows = await sql<V4Record[]>`
      WITH latest_records AS (
        SELECT DISTINCT ON (record_id) *
        FROM v4_records
        WHERE owner_npub = ${ownerNpub}
          AND record_family_hash = ${recordFamilyHash}
        ORDER BY record_id, version DESC
      )
        SELECT latest_records.*
        FROM latest_records
        WHERE ${viewerNpub} = ${ownerNpub}
        OR EXISTS (
          SELECT 1
          FROM v4_record_group_payloads rgp
          JOIN v4_group_member_keys gmk
            ON gmk.group_id = rgp.group_id
           AND gmk.key_version = rgp.group_epoch
           AND gmk.member_npub = ${viewerNpub}
           AND gmk.revoked_at IS NULL
          WHERE rgp.record_row_id = latest_records.id
        )
      ORDER BY latest_records.updated_at ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  // Batch-fetch group payloads for all rows in a single query
  const results: RecordResponse[] = [];
  if (rows.length > 0) {
    const rowIds = rows.map((r) => r.id);
    const allPayloads = await sql<V4RecordGroupPayload[]>`
      SELECT * FROM v4_record_group_payloads WHERE record_row_id IN ${sql(rowIds)}
    `;

    // Group payloads by record_row_id
    const payloadsByRowId = new Map<string, V4RecordGroupPayload[]>();
    for (const p of allPayloads) {
      const existing = payloadsByRowId.get(p.record_row_id);
      if (existing) {
        existing.push(p);
      } else {
        payloadsByRowId.set(p.record_row_id, [p]);
      }
    }

    for (const row of rows) {
      const payloads = payloadsByRowId.get(row.id) || [];
      results.push({
        record_id: row.record_id,
        owner_npub: row.owner_npub,
        record_family_hash: row.record_family_hash,
        version: row.version,
        previous_version: row.previous_version,
        signature_npub: row.signature_npub,
        owner_payload: { ciphertext: row.owner_ciphertext },
        group_payloads: payloads.map((p) => ({
          group_id: p.group_id ?? undefined,
          group_epoch: p.group_epoch ?? undefined,
          group_npub: p.group_npub,
          ciphertext: p.ciphertext,
          write: p.can_write,
        })),
        updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
      });
    }
  }

  return {
    records: results,
    total,
    limit,
    offset,
    has_more: offset + rows.length < total,
  };
}

/**
 * Fetch all versions of a single record, ordered newest-first.
 * Access is granted if the viewer is the owner or has group access to at least one version.
 */
export async function fetchRecordHistory(
  recordId: string,
  ownerNpub: string,
  viewerNpub: string,
): Promise<RecordResponse[]> {
  const sql = getDb();

  // Fetch all versions of this record
  const rows = await sql<V4Record[]>`
    SELECT * FROM v4_records
    WHERE record_id = ${recordId}
      AND owner_npub = ${ownerNpub}
    ORDER BY version DESC
  `;

  if (rows.length === 0) return [];

  // Access check: viewer must be owner or have group access to at least one version
  if (viewerNpub !== ownerNpub) {
    const rowIds = rows.map((r) => r.id);
    const accessCheck = await sql<{ cnt: string }[]>`
      SELECT COUNT(*)::text AS cnt
      FROM v4_record_group_payloads rgp
      JOIN v4_group_member_keys gmk
        ON gmk.group_id = rgp.group_id
       AND gmk.key_version = rgp.group_epoch
       AND gmk.member_npub = ${viewerNpub}
       AND gmk.revoked_at IS NULL
      WHERE rgp.record_row_id IN ${sql(rowIds)}
    `;
    if (parseInt(accessCheck[0].cnt, 10) === 0) return [];
  }

  // Batch-fetch group payloads
  const rowIds = rows.map((r) => r.id);
  const allPayloads = await sql<V4RecordGroupPayload[]>`
    SELECT * FROM v4_record_group_payloads WHERE record_row_id IN ${sql(rowIds)}
  `;
  const payloadsByRowId = new Map<string, V4RecordGroupPayload[]>();
  for (const p of allPayloads) {
    const existing = payloadsByRowId.get(p.record_row_id);
    if (existing) existing.push(p);
    else payloadsByRowId.set(p.record_row_id, [p]);
  }

  return rows.map((row) => {
    const payloads = payloadsByRowId.get(row.id) || [];
    return {
      record_id: row.record_id,
      owner_npub: row.owner_npub,
      record_family_hash: row.record_family_hash,
      version: row.version,
      previous_version: row.previous_version,
      signature_npub: row.signature_npub,
      owner_payload: { ciphertext: row.owner_ciphertext },
      group_payloads: payloads.map((p) => ({
        group_id: p.group_id ?? undefined,
        group_epoch: p.group_epoch ?? undefined,
        group_npub: p.group_npub,
        ciphertext: p.ciphertext,
        write: p.can_write,
      })),
      updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    };
  });
}

/**
 * Fetch a per-family summary of latest visible records.
 */
export async function fetchRecordsSummary(
  input: FetchRecordsSummaryInput
): Promise<RecordFamilySummary[]> {
  const sql = getDb();
  const ownerNpub = input.owner_npub;
  const viewerNpub = input.viewer_npub || ownerNpub;
  const recordFamilyHash = input.record_family_hash;
  const since = input.since;

  // Build the base query: latest version per record_id, optionally filtered by family
  // Then apply visibility, then group by family
  interface SummaryRow {
    record_family_hash: string;
    latest_updated_at: Date;
    latest_record_count: string;
  }
  interface SummaryRowWithSince extends SummaryRow {
    count_since: string;
  }

  if (since) {
    const rows = recordFamilyHash
      ? await sql<SummaryRowWithSince[]>`
        WITH latest_records AS (
          SELECT DISTINCT ON (record_id) id, record_family_hash, updated_at
          FROM v4_records
          WHERE owner_npub = ${ownerNpub}
            AND record_family_hash = ${recordFamilyHash}
          ORDER BY record_id, version DESC
        ),
        visible_records AS (
          SELECT lr.*
          FROM latest_records lr
          WHERE ${viewerNpub} = ${ownerNpub}
          OR EXISTS (
            SELECT 1
            FROM v4_record_group_payloads rgp
            JOIN v4_group_member_keys gmk
              ON gmk.group_id = rgp.group_id
             AND gmk.key_version = rgp.group_epoch
             AND gmk.member_npub = ${viewerNpub}
             AND gmk.revoked_at IS NULL
            WHERE rgp.record_row_id = lr.id
          )
        )
        SELECT
          record_family_hash,
          MAX(updated_at) AS latest_updated_at,
          COUNT(*)::text AS latest_record_count,
          COUNT(*) FILTER (WHERE updated_at > ${since})::text AS count_since
        FROM visible_records
        GROUP BY record_family_hash
      `
      : await sql<SummaryRowWithSince[]>`
        WITH latest_records AS (
          SELECT DISTINCT ON (record_id) id, record_family_hash, updated_at
          FROM v4_records
          WHERE owner_npub = ${ownerNpub}
          ORDER BY record_id, version DESC
        ),
        visible_records AS (
          SELECT lr.*
          FROM latest_records lr
          WHERE ${viewerNpub} = ${ownerNpub}
          OR EXISTS (
            SELECT 1
            FROM v4_record_group_payloads rgp
            JOIN v4_group_member_keys gmk
              ON gmk.group_id = rgp.group_id
             AND gmk.key_version = rgp.group_epoch
             AND gmk.member_npub = ${viewerNpub}
             AND gmk.revoked_at IS NULL
            WHERE rgp.record_row_id = lr.id
          )
        )
        SELECT
          record_family_hash,
          MAX(updated_at) AS latest_updated_at,
          COUNT(*)::text AS latest_record_count,
          COUNT(*) FILTER (WHERE updated_at > ${since})::text AS count_since
        FROM visible_records
        GROUP BY record_family_hash
      `;

    return rows.map((r) => ({
      record_family_hash: r.record_family_hash,
      latest_updated_at: r.latest_updated_at instanceof Date ? r.latest_updated_at.toISOString() : String(r.latest_updated_at),
      latest_record_count: parseInt(r.latest_record_count, 10),
      count_since: parseInt(r.count_since, 10),
    }));
  }

  const rows = recordFamilyHash
    ? await sql<SummaryRow[]>`
      WITH latest_records AS (
        SELECT DISTINCT ON (record_id) id, record_family_hash, updated_at
        FROM v4_records
        WHERE owner_npub = ${ownerNpub}
          AND record_family_hash = ${recordFamilyHash}
        ORDER BY record_id, version DESC
      ),
      visible_records AS (
        SELECT lr.*
        FROM latest_records lr
        WHERE ${viewerNpub} = ${ownerNpub}
        OR EXISTS (
          SELECT 1
          FROM v4_record_group_payloads rgp
          JOIN v4_group_member_keys gmk
            ON gmk.group_id = rgp.group_id
           AND gmk.key_version = rgp.group_epoch
           AND gmk.member_npub = ${viewerNpub}
           AND gmk.revoked_at IS NULL
          WHERE rgp.record_row_id = lr.id
        )
      )
      SELECT
        record_family_hash,
        MAX(updated_at) AS latest_updated_at,
        COUNT(*)::text AS latest_record_count
      FROM visible_records
      GROUP BY record_family_hash
    `
    : await sql<SummaryRow[]>`
      WITH latest_records AS (
        SELECT DISTINCT ON (record_id) id, record_family_hash, updated_at
        FROM v4_records
        WHERE owner_npub = ${ownerNpub}
        ORDER BY record_id, version DESC
      ),
      visible_records AS (
        SELECT lr.*
        FROM latest_records lr
        WHERE ${viewerNpub} = ${ownerNpub}
        OR EXISTS (
          SELECT 1
          FROM v4_record_group_payloads rgp
          JOIN v4_group_member_keys gmk
            ON gmk.group_id = rgp.group_id
           AND gmk.key_version = rgp.group_epoch
           AND gmk.member_npub = ${viewerNpub}
           AND gmk.revoked_at IS NULL
          WHERE rgp.record_row_id = lr.id
        )
      )
      SELECT
        record_family_hash,
        MAX(updated_at) AS latest_updated_at,
        COUNT(*)::text AS latest_record_count
      FROM visible_records
      GROUP BY record_family_hash
    `;

  return rows.map((r) => ({
    record_family_hash: r.record_family_hash,
    latest_updated_at: r.latest_updated_at instanceof Date ? r.latest_updated_at.toISOString() : String(r.latest_updated_at),
    latest_record_count: parseInt(r.latest_record_count, 10),
    count_since: null,
  }));
}

/**
 * Lightweight heartbeat check: compare client family cursors against server state.
 * Returns only the families that have updates the client hasn't seen.
 */
export async function heartbeatCheck(
  ownerNpub: string,
  viewerNpub: string,
  familyCursors: Record<string, string | null>,
): Promise<HeartbeatResponse> {
  const families = await fetchRecordsSummary({
    owner_npub: ownerNpub,
    viewer_npub: viewerNpub,
  });

  const serverCursors: Record<string, string> = {};
  const staleFamilies: string[] = [];

  for (const family of families) {
    const serverTs = family.latest_updated_at;
    serverCursors[family.record_family_hash] = serverTs;

    const clientTs = familyCursors[family.record_family_hash];
    if (!clientTs || serverTs > clientTs) {
      staleFamilies.push(family.record_family_hash);
    }
  }

  return {
    stale_families: staleFamilies,
    server_cursors: serverCursors,
  };
}
