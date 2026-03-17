import { $ } from 'bun';
import { nip19, nip44 } from 'nostr-tools';
import { ensureServiceIdentity } from '../service-identity';
import { getDb, closeDb } from '../db';
import { syncRecords } from '../services/records';
import type { SyncRecordInput, V4Record } from '../types';

const PETE_NPUB = 'npub1jss47s4fvv6usl7tn6yp5zamv2u60923ncgfea0e6thkza5p7c3q0afmzy';
const WM21_NPUB = 'npub1s4658awhcachmhzk5jhsg256gzdl7e4gh5a9zq8skjyt7g3k2axql224qz';
const APP_NPUB = 'npub1hd37reqgfcnz3pvzj4grknd2nkzc94p9ercmunrxx22razr2rfxsw6dns5';
const V3_DB_PATH = '/Users/mini/wingmen/agents/wm21/data/superbased.db';

type V3TaskRow = {
  record_id: string;
  title: string | null;
  state: string | null;
  priority: string | null;
  assigned_to: string | null;
  scheduled_for: string | null;
  tags: string | null;
  description: string | null;
  payload: string | null;
};

type V3TaskPayload = {
  title?: string;
  description?: string;
  state?: string;
  priority?: string;
  tags?: string;
  scheduled_for?: string | null;
  assigned_to?: string | null;
  parent_id?: string | null;
  isPrivate?: boolean;
};

type GroupKeyRow = {
  group_npub: string;
  wrapped_group_nsec: string;
};

type GroupPayloadRow = {
  group_npub: string;
  ciphertext: string;
};

type TaskComparable = {
  title: string;
  description: string;
  state: string;
  priority: string;
  parent_task_id: string | null;
  board_group_id: string | null;
  scheduled_for: string | null;
  tags: string;
  shares: string[];
  record_state: string;
};

function decodeNsec(value: string) {
  const decoded = nip19.decode(value);
  if (decoded.type !== 'nsec' || !(decoded.data instanceof Uint8Array)) {
    throw new Error('Invalid nsec');
  }
  return decoded.data;
}

function decodeNpub(value: string) {
  const decoded = nip19.decode(value);
  if (decoded.type !== 'npub' || typeof decoded.data !== 'string') {
    throw new Error(`Invalid npub: ${value}`);
  }
  return decoded.data;
}

function wrapForRecipient(senderSecret: Uint8Array, recipientNpub: string, plaintext: string) {
  return nip44.encrypt(plaintext, nip44.getConversationKey(senderSecret, decodeNpub(recipientNpub)));
}

function unwrapForRecipient(senderSecret: Uint8Array, recipientNpub: string, ciphertext: string) {
  return nip44.decrypt(ciphertext, nip44.getConversationKey(senderSecret, decodeNpub(recipientNpub)));
}

function encryptForGroup(groupSecret: Uint8Array, groupNpub: string, plaintext: string) {
  return nip44.encrypt(plaintext, nip44.getConversationKey(groupSecret, decodeNpub(groupNpub)));
}

function decryptFromOwner(serviceSecret: Uint8Array, ownerNpub: string, ownerCiphertext: string) {
  let current = ownerCiphertext;
  for (let depth = 0; depth < 4; depth++) {
    const parsed = parseJson(current);
    if (
      !parsed
      || typeof parsed !== 'object'
      || typeof parsed.encrypted_by_npub !== 'string'
      || typeof parsed.ciphertext !== 'string'
    ) {
      break;
    }
    current = unwrapForRecipient(serviceSecret, ownerNpub, parsed.ciphertext);
  }
  return current;
}

function parseJson(value: string | null | undefined) {
  if (!String(value || '').trim().startsWith('{')) return null;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function normalizeScheduledFor(value: string | null | undefined) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeTags(value: string | null | undefined) {
  return String(value || '').trim();
}

function normalizeComparable(value: TaskComparable) {
  return JSON.stringify({
    ...value,
    shares: [...new Set(value.shares)].sort(),
  });
}

function mapV3Task(row: V3TaskRow, boardGroupNpub: string | null): TaskComparable {
  const payload = (parseJson(row.payload) || {}) as V3TaskPayload;
  const isPrivate = payload.isPrivate === true;
  const taskBoard = isPrivate ? null : boardGroupNpub;
  const shares = taskBoard ? [taskBoard] : [];

  return {
    title: String(payload.title ?? row.title ?? '').trim(),
    description: String(payload.description ?? row.description ?? ''),
    state: String(payload.state ?? row.state ?? 'new'),
    priority: String(payload.priority ?? row.priority ?? 'sand'),
    parent_task_id: payload.parent_id ?? null,
    board_group_id: taskBoard,
    scheduled_for: normalizeScheduledFor(payload.scheduled_for ?? row.scheduled_for),
    tags: normalizeTags(payload.tags ?? row.tags),
    shares,
    record_state: 'active',
  };
}

async function loadOpenV3Tasks() {
  const query = `
    select record_id, title, state, priority, assigned_to, scheduled_for, tags, description, payload
    from records
    where collection = 'todos'
      and deleted = 0
      and done = 0
      and state not in ('done', 'archive')
    order by record_created_at asc
  `;
  const output = await $`sqlite3 -json ${V3_DB_PATH} ${query}`.text();
  return JSON.parse(output) as V3TaskRow[];
}

async function main() {
  const serviceIdentity = await ensureServiceIdentity();
  const serviceSecret = decodeNsec(serviceIdentity.nsec);
  const sql = getDb();

  const [wm21Group] = await sql<{ id: string; group_npub: string }[]>`
    SELECT g.id, g.group_npub
    FROM v4_groups g
    JOIN v4_group_members gm ON gm.group_id = g.id
    WHERE g.owner_npub = ${PETE_NPUB}
      AND gm.member_npub = ${WM21_NPUB}
    ORDER BY CASE WHEN g.name = 'WM21' THEN 0 ELSE 1 END, g.created_at DESC
    LIMIT 1
  `;

  if (!wm21Group?.group_npub) {
    throw new Error('Could not find a live WM21 group for replay');
  }

  const [groupKey] = await sql<GroupKeyRow[]>`
    SELECT g.group_npub, gmk.wrapped_group_nsec
    FROM v4_group_member_keys gmk
    JOIN v4_groups g ON g.id = gmk.group_id
    WHERE g.group_npub = ${wm21Group.group_npub}
      AND gmk.member_npub = ${PETE_NPUB}
      AND gmk.revoked_at IS NULL
    ORDER BY gmk.created_at DESC
    LIMIT 1
  `;

  if (!groupKey?.wrapped_group_nsec) {
    throw new Error('Could not resolve WM21 group key');
  }

  const wm21GroupSecret = decodeNsec(
    unwrapForRecipient(serviceSecret, PETE_NPUB, groupKey.wrapped_group_nsec)
  );

  const v3Tasks = await loadOpenV3Tasks();
  const latestRows = await sql<(V4Record & { id: string })[]>`
    SELECT DISTINCT ON (record_id) *
    FROM v4_records
    WHERE owner_npub = ${PETE_NPUB}
      AND record_family_hash = ${`${APP_NPUB}:task`}
    ORDER BY record_id, version DESC
  `;

  const latestByRecordId = new Map(latestRows.map((row) => [row.record_id, row]));
  const pending: SyncRecordInput[] = [];
  let skipped = 0;

  for (const task of v3Tasks) {
    const mapped = mapV3Task(task, wm21Group.group_npub);
    const existing = latestByRecordId.get(task.record_id);

    if (existing) {
      const groupPayloads = await sql<GroupPayloadRow[]>`
        SELECT group_npub, ciphertext
        FROM v4_record_group_payloads
        WHERE record_row_id = ${existing.id}
      `;

      const ownerPlaintext = decryptFromOwner(serviceSecret, existing.owner_npub, existing.owner_ciphertext);
      const ownerPayload = parseJson(ownerPlaintext) as { data?: Partial<TaskComparable> } | null;
      const current: TaskComparable = {
        title: String(ownerPayload?.data?.title ?? ''),
        description: String(ownerPayload?.data?.description ?? ''),
        state: String(ownerPayload?.data?.state ?? 'new'),
        priority: String(ownerPayload?.data?.priority ?? 'sand'),
        parent_task_id: ownerPayload?.data?.parent_task_id ?? null,
        board_group_id: ownerPayload?.data?.board_group_id ?? null,
        scheduled_for: normalizeScheduledFor(ownerPayload?.data?.scheduled_for ?? null),
        tags: normalizeTags(ownerPayload?.data?.tags ?? ''),
        shares: Array.isArray(ownerPayload?.data?.shares) ? ownerPayload.data?.shares.filter(Boolean) as string[] : [],
        record_state: String(ownerPayload?.data?.record_state ?? 'active'),
      };

      const currentGroupIds = [...new Set(groupPayloads.map((payload) => payload.group_npub).filter(Boolean))].sort();
      const expectedGroupIds = [...new Set(mapped.board_group_id ? [mapped.board_group_id] : [])].sort();
      if (
        normalizeComparable(current) === normalizeComparable(mapped)
        && JSON.stringify(currentGroupIds) === JSON.stringify(expectedGroupIds)
      ) {
        skipped += 1;
        continue;
      }
    }

    const nextVersion = (existing?.version ?? 0) + 1;
    const innerPayload = {
      app_namespace: APP_NPUB,
      collection_space: 'task',
      schema_version: 1,
      record_id: task.record_id,
      data: mapped,
    };

    pending.push({
      record_id: task.record_id,
      owner_npub: PETE_NPUB,
      record_family_hash: `${APP_NPUB}:task`,
      version: nextVersion,
      previous_version: existing?.version ?? 0,
      signature_npub: PETE_NPUB,
      owner_payload: {
        ciphertext: JSON.stringify({
          encrypted_by_npub: serviceIdentity.npub,
          ciphertext: wrapForRecipient(serviceSecret, PETE_NPUB, JSON.stringify(innerPayload)),
        }),
      },
      group_payloads: mapped.board_group_id
        ? [{
            group_npub: mapped.board_group_id,
            ciphertext: encryptForGroup(wm21GroupSecret, mapped.board_group_id, JSON.stringify(innerPayload)),
            write: true,
          }]
        : [],
    });
  }

  const result = pending.length > 0
    ? await syncRecords(PETE_NPUB, pending, PETE_NPUB)
    : { synced: 0, created: 0, updated: 0, rejected: [] };

  console.log(JSON.stringify({
    source_open_tasks: v3Tasks.length,
    skipped_as_already_current: skipped,
    attempted_replay: pending.length,
    ...result,
  }, null, 2));

  await closeDb();
}

await main();
