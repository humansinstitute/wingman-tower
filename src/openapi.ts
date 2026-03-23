import { config } from './config';

function docsHtml(specUrl: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>SuperBased V4 API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
    <style>
      body { margin: 0; background: #faf7ef; }
      .topbar { display: none; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: ${JSON.stringify(specUrl)},
        dom_id: '#swagger-ui',
        deepLinking: true,
        docExpansion: 'list',
        defaultModelsExpandDepth: 1,
        persistAuthorization: true
      });
    </script>
  </body>
</html>`;
}

function tableViewerHtml(apiBaseUrl: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>SuperBased V4 Table Viewer</title>
    <style>
      :root {
        --bg: #f6f1e5;
        --panel: #fffdf8;
        --panel-alt: #f3ecdf;
        --line: #d8cfbf;
        --text: #221c16;
        --muted: #6a6258;
        --accent: #0f766e;
        --danger: #b91c1c;
        --mono: "SFMono-Regular", "Menlo", monospace;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, sans-serif;
        background: linear-gradient(180deg, #f8f3e8 0%, #efe6d4 100%);
        color: var(--text);
      }
      .viewer { display: grid; grid-template-columns: 320px minmax(0, 1fr); min-height: 100vh; }
      .sidebar { border-right: 1px solid var(--line); padding: 1rem; background: rgba(255,255,255,0.6); }
      .content { padding: 1rem 1.25rem 2rem; }
      .stack { display: flex; flex-direction: column; gap: 1rem; }
      h1 { margin: 0 0 0.35rem; font-size: 1.2rem; }
      .lede, .meta, .empty, .status { color: var(--muted); font-size: 0.9rem; }
      .status { margin: 0.75rem 0 1rem; min-height: 1.25rem; }
      .status.error { color: var(--danger); }
      .connect, .pager-btn, .limit-select {
        border: 1px solid var(--line);
        background: var(--panel);
        color: var(--text);
        border-radius: 10px;
        padding: 0.5rem 0.75rem;
      }
      .connect { border-radius: 999px; cursor: pointer; }
      .table-list { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1rem; }
      .panel {
        border: 1px solid var(--line);
        background: var(--panel);
        border-radius: 14px;
        padding: 0.85rem;
      }
      .panel h2 { margin: 0 0 0.5rem; font-size: 0.98rem; }
      .field { display: flex; flex-direction: column; gap: 0.35rem; margin-top: 0.6rem; }
      .field input, .field select, .field textarea {
        width: 100%;
        border: 1px solid var(--line);
        background: #fff;
        color: var(--text);
        border-radius: 10px;
        padding: 0.55rem 0.65rem;
        font: inherit;
      }
      .field textarea { min-height: 6rem; font-family: var(--mono); font-size: 0.75rem; }
      .actions { display: flex; gap: 0.5rem; margin-top: 0.7rem; flex-wrap: wrap; }
      .table-row {
        width: 100%;
        text-align: left;
        border: 1px solid var(--line);
        background: var(--panel);
        border-radius: 14px;
        padding: 0.7rem 0.8rem;
        cursor: pointer;
      }
      .table-row.active { border-color: var(--accent); background: #ecfdf5; }
      .table-row-name { display: block; font-weight: 600; }
      .table-row-meta { display: block; color: var(--muted); font-size: 0.82rem; margin-top: 0.2rem; }
      .toolbar { display: flex; gap: 0.75rem; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
      .toolbar-actions { display: flex; gap: 0.5rem; align-items: center; }
      .table-wrap { border: 1px solid var(--line); border-radius: 18px; overflow: auto; background: rgba(255,255,255,0.75); }
      table { width: 100%; min-width: 900px; border-collapse: collapse; }
      th, td { border-bottom: 1px solid var(--line); vertical-align: top; text-align: left; padding: 0.65rem 0.75rem; font-size: 0.85rem; }
      th { position: sticky; top: 0; background: var(--panel-alt); z-index: 1; }
      td code, th code { font-family: var(--mono); font-size: 0.79rem; white-space: pre-wrap; word-break: break-word; }
      @media (max-width: 960px) {
        .viewer { grid-template-columns: 1fr; }
        .sidebar { border-right: none; border-bottom: 1px solid var(--line); }
      }
    </style>
  </head>
  <body>
    <div class="viewer">
      <aside class="sidebar">
        <h1>Table Viewer</h1>
        <p class="lede">Read-only spot checks over live SuperBased v4 backend tables.</p>
        <button id="connect" class="connect" type="button">Connect with Nostr</button>
        <div id="status" class="status">Not connected</div>
        <div class="stack">
          <div class="panel">
            <h2>Connection Tokens</h2>
            <div class="meta">Generate a Yoke/Agent Connect token for a workspace and app namespace.</div>
            <div class="field">
              <label for="workspaceSelect" class="meta">Workspace</label>
              <select id="workspaceSelect">
                <option value="">Load after connect</option>
              </select>
            </div>
            <div class="field">
              <label for="appNpubInput" class="meta">App npub</label>
              <input id="appNpubInput" type="text" placeholder="npub1..." />
            </div>
            <div class="actions">
              <button id="generateTokenBtn" class="connect" type="button">Generate Token</button>
              <button id="copyTokenBtn" class="pager-btn" type="button">Copy Token</button>
            </div>
            <div class="field">
              <label for="tokenOutput" class="meta">Connection token</label>
              <textarea id="tokenOutput" readonly placeholder="Generated token will appear here"></textarea>
            </div>
          </div>
          <div id="tableList" class="table-list"></div>
        </div>
      </aside>
      <main class="content">
        <div class="toolbar">
          <div>
            <div id="activeTable" style="font-size:1.05rem;font-weight:700;">No table selected</div>
            <div id="summary" class="meta">Connect, then select a table.</div>
          </div>
          <div class="toolbar-actions">
            <label class="meta" for="limitSelect">Rows</label>
            <select id="limitSelect" class="limit-select">
              <option value="50">50</option>
              <option value="100" selected>100</option>
              <option value="250">250</option>
            </select>
            <button id="prevBtn" class="pager-btn" type="button">Prev</button>
            <button id="nextBtn" class="pager-btn" type="button">Next</button>
          </div>
        </div>
        <div id="empty" class="empty">No table loaded.</div>
        <div id="tableWrap" class="table-wrap" hidden></div>
      </main>
    </div>
    <script type="module">
      const API_BASE = ${JSON.stringify(apiBaseUrl)};
      const state = { pubkey: null, npub: null, tables: [], activeTable: null, limit: 100, offset: 0 };
      const connectBtn = document.getElementById('connect');
      const statusEl = document.getElementById('status');
      const tableListEl = document.getElementById('tableList');
      const activeTableEl = document.getElementById('activeTable');
      const summaryEl = document.getElementById('summary');
      const tableWrapEl = document.getElementById('tableWrap');
      const emptyEl = document.getElementById('empty');
      const prevBtn = document.getElementById('prevBtn');
      const nextBtn = document.getElementById('nextBtn');
      const limitSelect = document.getElementById('limitSelect');
      const workspaceSelect = document.getElementById('workspaceSelect');
      const appNpubInput = document.getElementById('appNpubInput');
      const generateTokenBtn = document.getElementById('generateTokenBtn');
      const copyTokenBtn = document.getElementById('copyTokenBtn');
      const tokenOutput = document.getElementById('tokenOutput');

      function setStatus(message, isError = false) {
        statusEl.textContent = message;
        statusEl.className = isError ? 'status error' : 'status';
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;');
      }

      function normalizeValue(value) {
        if (value === null || value === undefined) return '';
        if (typeof value === 'object') return JSON.stringify(value, null, 2);
        return String(value);
      }

      async function sha256Hex(input) {
        const bytes = new TextEncoder().encode(input);
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
      }

      function base64Json(value) {
        const raw = JSON.stringify(value);
        const bytes = new TextEncoder().encode(raw);
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return btoa(binary);
      }

      async function npubFromHex(pubkeyHex) {
        const mod = await import('https://esm.sh/nostr-tools@2.17.0/nip19');
        return mod.npubEncode(pubkeyHex);
      }

      async function signAuth(url, method, body = '') {
        if (!window.nostr) throw new Error('Nostr extension not available');
        const pubkey = state.pubkey || await window.nostr.getPublicKey();
        state.pubkey = pubkey;
        state.npub = await npubFromHex(pubkey);
        const tags = [['u', url], ['method', method.toUpperCase()]];
        if (body && method.toUpperCase() !== 'GET') {
          tags.push(['payload', await sha256Hex(body)]);
        }
        const event = await window.nostr.signEvent({
          kind: 27235,
          created_at: Math.floor(Date.now() / 1000),
          tags,
          content: '',
        });
        return 'Nostr ' + base64Json(event);
      }

      async function apiGet(path) {
        const url = API_BASE + path;
        const auth = await signAuth(url, 'GET');
        const res = await fetch(url, { headers: { Authorization: auth } });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      }

      function renderWorkspaceList(workspaces) {
        workspaceSelect.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = workspaces.length ? 'Select a workspace' : 'No workspaces found';
        workspaceSelect.appendChild(placeholder);
        for (const workspace of workspaces) {
          const option = document.createElement('option');
          option.value = workspace.workspace_id;
          option.textContent = workspace.name + ' | ' + workspace.workspace_owner_npub;
          workspaceSelect.appendChild(option);
        }
      }

      function renderTableList() {
        tableListEl.innerHTML = '';
        for (const table of state.tables) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'table-row' + (state.activeTable === table.table ? ' active' : '');
          button.innerHTML = '<span class="table-row-name">' + escapeHtml(table.table) + '</span>'
            + '<span class="table-row-meta">' + table.row_count + ' rows · ' + table.columns.length + ' cols</span>';
          button.addEventListener('click', () => {
            state.activeTable = table.table;
            state.offset = 0;
            renderTableList();
            loadTable().catch((error) => setStatus(error.message || 'Failed to load table', true));
          });
          tableListEl.appendChild(button);
        }
      }

      function renderRows(payload) {
        const columns = payload.columns || [];
        const rows = payload.rows || [];
        activeTableEl.textContent = payload.table;
        summaryEl.textContent = payload.row_count + ' rows total · offset ' + payload.offset;
        if (rows.length === 0) {
          emptyEl.hidden = false;
          emptyEl.textContent = 'No rows returned for this page.';
          tableWrapEl.hidden = true;
          tableWrapEl.innerHTML = '';
          return;
        }
        emptyEl.hidden = true;
        tableWrapEl.hidden = false;
        const head = columns.map((col) => '<th><div>' + escapeHtml(col.column_name) + '</div><code>' + escapeHtml(col.data_type) + '</code></th>').join('');
        const body = rows.map((row) => {
          const cells = columns.map((col) => '<td><code>' + escapeHtml(normalizeValue(row[col.column_name])) + '</code></td>').join('');
          return '<tr>' + cells + '</tr>';
        }).join('');
        tableWrapEl.innerHTML = '<table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';
      }

      async function loadTables() {
        setStatus('Loading table list…');
        const payload = await apiGet('/api/v4/admin/tables');
        state.tables = payload.tables || [];
        const workspacePayload = await apiGet('/api/v4/admin/workspaces');
        state.workspaces = workspacePayload.workspaces || [];
        renderWorkspaceList(state.workspaces);
        if (!state.activeTable && state.tables.length > 0) state.activeTable = state.tables[0].table;
        renderTableList();
        setStatus('Connected as ' + (state.npub || payload.viewer));
        if (state.activeTable) await loadTable();
      }

      async function generateToken() {
        const workspaceId = workspaceSelect.value;
        const appNpub = String(appNpubInput.value || '').trim();
        if (!workspaceId) throw new Error('Select a workspace first');
        if (!appNpub) throw new Error('Enter an app npub first');
        setStatus('Generating connection token…');
        const payload = await apiGet('/api/v4/admin/workspaces/' + encodeURIComponent(workspaceId) + '/connection-token?app_npub=' + encodeURIComponent(appNpub));
        tokenOutput.value = payload.connection_token || '';
        setStatus('Connected as ' + (state.npub || payload.viewer));
      }

      async function loadTable() {
        if (!state.activeTable) return;
        setStatus('Loading ' + state.activeTable + '…');
        const payload = await apiGet('/api/v4/admin/tables/' + encodeURIComponent(state.activeTable) + '?limit=' + state.limit + '&offset=' + state.offset);
        renderRows(payload);
        setStatus('Connected as ' + (state.npub || payload.viewer));
      }

      connectBtn.addEventListener('click', () => loadTables().catch((error) => setStatus(error.message || 'Failed to connect', true)));
      generateTokenBtn.addEventListener('click', () => generateToken().catch((error) => setStatus(error.message || 'Failed to generate token', true)));
      copyTokenBtn.addEventListener('click', async () => {
        if (!tokenOutput.value) return;
        try {
          await navigator.clipboard.writeText(tokenOutput.value);
          setStatus('Connection token copied');
        } catch (error) {
          setStatus((error && error.message) || 'Failed to copy token', true);
        }
      });
      limitSelect.addEventListener('change', () => {
        state.limit = Number.parseInt(limitSelect.value, 10) || 100;
        state.offset = 0;
        loadTable().catch((error) => setStatus(error.message || 'Failed to load table', true));
      });
      prevBtn.addEventListener('click', () => {
        state.offset = Math.max(0, state.offset - state.limit);
        loadTable().catch((error) => setStatus(error.message || 'Failed to load table', true));
      });
      nextBtn.addEventListener('click', () => {
        state.offset += state.limit;
        loadTable().catch((error) => setStatus(error.message || 'Failed to load table', true));
      });
    </script>
  </body>
</html>`;
}

function preferredOrigin(origin: string) {
  return config.directHttpsUrl || origin;
}

export function buildDocsHtml(origin: string) {
  return docsHtml(`${preferredOrigin(origin)}/openapi.json`);
}

export function buildTableViewerHtml(origin: string) {
  return tableViewerHtml(preferredOrigin(origin));
}

export function buildOpenApiDocument(origin: string) {
  const publicOrigin = preferredOrigin(origin);
  return {
    openapi: '3.1.0',
    info: {
      title: 'SuperBased V4 API',
      version: '0.1.0',
      description:
        'Workspace-scoped groups and append-only record sync for Coworker SuperBased v4.',
    },
    servers: [
      {
        url: publicOrigin,
        description: 'Direct HTTPS endpoint',
      },
      ...(origin !== publicOrigin
        ? [
            {
              url: origin,
              description: 'Internal request origin',
            },
          ]
        : []),
    ],
    tags: [
      { name: 'Health', description: 'Service discovery and basic health' },
      { name: 'Groups', description: 'Workspace group management' },
      { name: 'Records', description: 'Append-only record sync and fetch' },
      { name: 'Storage', description: 'Opaque encrypted object upload and download' },
      { name: 'Admin', description: 'Read-only backend table inspection' },
    ],
    components: {
      securitySchemes: {
        nip98: {
          type: 'apiKey',
          in: 'header',
          name: 'Authorization',
          description:
            'NIP-98 auth header in the format `Nostr <base64-encoded event-json>`.',
        },
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
          required: ['error'],
        },
        HealthResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'ok' },
            service_npub: { type: ['string', 'null'], example: 'npub1...' },
          },
          required: ['status', 'service_npub'],
        },
        MemberKeyInput: {
          type: 'object',
          properties: {
            member_npub: { type: 'string' },
            wrapped_group_nsec: { type: 'string', description: 'NIP-44 encrypted group nsec for this member' },
            wrapped_by_npub: { type: 'string' },
          },
          required: ['member_npub', 'wrapped_group_nsec', 'wrapped_by_npub'],
        },
        CreateGroupRequest: {
          type: 'object',
          properties: {
            owner_npub: { type: 'string' },
            name: { type: 'string' },
            group_npub: { type: 'string', description: 'Nostr public key for the group identity' },
            member_keys: {
              type: 'array',
              items: { $ref: '#/components/schemas/MemberKeyInput' },
              description: 'Wrapped group keys for each member (must include owner)',
            },
          },
          required: ['owner_npub', 'name', 'group_npub', 'member_keys'],
        },
        RotateGroupRequest: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Optional updated group name to persist during rotation' },
            group_npub: { type: 'string', description: 'Fresh epoch npub generated by the rotating client' },
            member_keys: {
              type: 'array',
              items: { $ref: '#/components/schemas/MemberKeyInput' },
              description: 'Wrapped fresh group nsec for each remaining member',
            },
          },
          required: ['group_npub', 'member_keys'],
        },
        UpdateGroupRequest: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
          required: ['name'],
        },
        GroupMember: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            member_npub: { type: 'string' },
          },
          required: ['id', 'member_npub'],
        },
        GroupResponse: {
          type: 'object',
          properties: {
            group_id: { type: 'string', format: 'uuid' },
            group_npub: { type: 'string' },
            current_epoch: { type: 'integer', minimum: 1 },
            owner_npub: { type: 'string' },
            name: { type: 'string' },
            group_kind: { type: 'string' },
            private_member_npub: { type: ['string', 'null'] },
            members: {
              type: 'array',
              items: { $ref: '#/components/schemas/GroupMember' },
            },
            created_at: { type: 'string', format: 'date-time' },
          },
          required: ['group_id', 'group_npub', 'current_epoch', 'owner_npub', 'name', 'group_kind', 'private_member_npub', 'members', 'created_at'],
        },
        ListGroup: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            owner_npub: { type: 'string' },
            name: { type: 'string' },
            group_npub: { type: 'string' },
            current_epoch: { type: 'integer', minimum: 1 },
            group_kind: { type: 'string' },
            private_member_npub: { type: ['string', 'null'] },
            created_at: { type: 'string', format: 'date-time' },
            members: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['id', 'owner_npub', 'name', 'group_npub', 'current_epoch', 'group_kind', 'private_member_npub', 'created_at', 'members'],
        },
        ListGroupsResponse: {
          type: 'object',
          properties: {
            groups: {
              type: 'array',
              items: { $ref: '#/components/schemas/ListGroup' },
            },
          },
          required: ['groups'],
        },
        AddGroupMemberRequest: {
          type: 'object',
          properties: {
            member_npub: { type: 'string' },
            wrapped_group_nsec: { type: 'string', description: 'NIP-44 encrypted group nsec for this member' },
            wrapped_by_npub: { type: 'string' },
          },
          required: ['member_npub', 'wrapped_group_nsec', 'wrapped_by_npub'],
        },
        AddGroupMemberResponse: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            group_id: { type: 'string', format: 'uuid' },
            member_npub: { type: 'string' },
            wrapped_group_nsec: { type: 'string' },
            wrapped_by_npub: { type: 'string' },
            approved_by_npub: { type: 'string' },
            key_version: { type: 'integer' },
            created_at: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'group_id', 'member_npub', 'wrapped_group_nsec', 'wrapped_by_npub', 'approved_by_npub', 'key_version', 'created_at'],
        },
        WrappedKeyEntry: {
          type: 'object',
          properties: {
            group_id: { type: 'string', format: 'uuid' },
            group_npub: { type: 'string' },
            epoch: { type: 'integer', minimum: 1 },
            name: { type: 'string' },
            member_npub: { type: 'string' },
            wrapped_group_nsec: { type: 'string' },
            wrapped_by_npub: { type: 'string' },
            approved_by_npub: { type: 'string' },
            key_version: { type: 'integer' },
          },
          required: ['group_id', 'group_npub', 'epoch', 'name', 'member_npub', 'wrapped_group_nsec', 'wrapped_by_npub', 'approved_by_npub', 'key_version'],
        },
        WrappedKeysResponse: {
          type: 'object',
          properties: {
            keys: {
              type: 'array',
              items: { $ref: '#/components/schemas/WrappedKeyEntry' },
            },
          },
          required: ['keys'],
        },
        DeleteGroupResponse: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', example: true },
            group_id: { type: 'string', format: 'uuid' },
          },
          required: ['ok', 'group_id'],
        },
        DeleteGroupMemberResponse: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', example: true },
            group_id: { type: 'string', format: 'uuid' },
            member_npub: { type: 'string' },
          },
          required: ['ok', 'group_id', 'member_npub'],
        },
        PrepareStorageRequest: {
          type: 'object',
          properties: {
            owner_npub: { type: 'string' },
            content_type: { type: 'string', example: 'audio/webm;codecs=opus' },
            size_bytes: { type: 'integer', example: 182044 },
            file_name: { type: ['string', 'null'], example: 'voice-note.webm' },
          },
          required: ['owner_npub', 'content_type'],
        },
        PrepareStorageResponse: {
          type: 'object',
          properties: {
            object_id: { type: 'string', format: 'uuid' },
            owner_npub: { type: 'string' },
            access_group_npubs: { type: 'array', items: { type: 'string' } },
            file_name: { type: ['string', 'null'] },
            content_type: { type: 'string' },
            size_bytes: { type: 'integer' },
            upload_url: { type: 'string', format: 'uri' },
            complete_url: { type: 'string', format: 'uri' },
            content_url: { type: 'string', format: 'uri' },
            download_url: { type: 'string', format: 'uri' },
            completed_at: { type: ['string', 'null'], format: 'date-time' },
          },
          required: ['object_id', 'owner_npub', 'access_group_npubs', 'content_type', 'size_bytes', 'upload_url', 'complete_url', 'content_url', 'download_url'],
        },
        CompleteStorageRequest: {
          type: 'object',
          properties: {
            sha256_hex: { type: ['string', 'null'] },
            size_bytes: { type: ['integer', 'null'] },
          },
        },
        CompleteStorageResponse: {
          type: 'object',
          properties: {
            object_id: { type: 'string', format: 'uuid' },
            owner_npub: { type: 'string' },
            access_group_npubs: { type: 'array', items: { type: 'string' } },
            file_name: { type: ['string', 'null'] },
            content_type: { type: 'string' },
            size_bytes: { type: 'integer' },
            content_url: { type: 'string', format: 'uri' },
            completed_at: { type: 'string', format: 'date-time' },
          },
          required: ['object_id', 'owner_npub', 'access_group_npubs', 'content_type', 'size_bytes', 'content_url', 'completed_at'],
        },
        StorageObjectResponse: {
          type: 'object',
          properties: {
            object_id: { type: 'string', format: 'uuid' },
            owner_npub: { type: 'string' },
            created_by_npub: { type: 'string' },
            access_group_npubs: { type: 'array', items: { type: 'string' } },
            file_name: { type: ['string', 'null'] },
            content_type: { type: 'string' },
            size_bytes: { type: 'integer' },
            sha256_hex: { type: ['string', 'null'] },
            content_url: { type: 'string', format: 'uri' },
            download_url: { type: ['string', 'null'], format: 'uri' },
            created_at: { type: 'string', format: 'date-time' },
            completed_at: { type: ['string', 'null'], format: 'date-time' },
          },
          required: ['object_id', 'owner_npub', 'created_by_npub', 'access_group_npubs', 'content_type', 'size_bytes', 'content_url', 'created_at'],
        },
        DownloadUrlResponse: {
          type: 'object',
          properties: {
            object_id: { type: 'string', format: 'uuid' },
            content_url: { type: 'string', format: 'uri' },
            download_url: { type: 'string', format: 'uri' },
          },
          required: ['object_id', 'content_url', 'download_url'],
        },
        OwnerPayload: {
          type: 'object',
          properties: {
            ciphertext: { type: 'string' },
          },
          required: ['ciphertext'],
        },
        GroupPayload: {
          type: 'object',
          properties: {
            group_id: { type: 'string', format: 'uuid', description: 'Stable logical group id' },
            group_epoch: { type: 'integer', minimum: 1, description: 'Epoch/version of the group key used for this payload' },
            group_npub: { type: 'string' },
            ciphertext: { type: 'string' },
            write: { type: 'boolean' },
          },
          required: ['group_npub', 'ciphertext', 'write'],
        },
        SyncRecordInput: {
          type: 'object',
          properties: {
            record_id: { type: 'string' },
            owner_npub: { type: 'string' },
            record_family_hash: { type: 'string' },
            version: { type: 'integer' },
            previous_version: { type: 'integer' },
            signature_npub: { type: 'string' },
            write_group_id: { type: 'string', format: 'uuid', description: 'Stable logical group id used for shared-write authorization' },
            write_group_npub: { type: 'string', description: 'Legacy current-epoch group npub for shared-write authorization' },
            owner_payload: { $ref: '#/components/schemas/OwnerPayload' },
            group_payloads: {
              type: 'array',
              items: { $ref: '#/components/schemas/GroupPayload' },
            },
          },
          required: [
            'record_id',
            'owner_npub',
            'record_family_hash',
            'version',
            'previous_version',
            'signature_npub',
            'owner_payload',
          ],
        },
        SyncRequest: {
          type: 'object',
          properties: {
            owner_npub: { type: 'string' },
            group_write_tokens: {
              type: 'object',
              additionalProperties: { type: 'string' },
              description: 'Map keyed by stable group_id or legacy current group_npub to a NIP-98 write-proof token signed by the current group epoch key',
            },
            records: {
              type: 'array',
              items: { $ref: '#/components/schemas/SyncRecordInput' },
            },
          },
          required: ['owner_npub', 'records'],
        },
        SyncRejectedRecord: {
          type: 'object',
          properties: {
            record_id: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['record_id', 'reason'],
        },
        SyncResponse: {
          type: 'object',
          properties: {
            synced: { type: 'integer' },
            created: { type: 'integer' },
            updated: { type: 'integer' },
            rejected: {
              type: 'array',
              items: { $ref: '#/components/schemas/SyncRejectedRecord' },
            },
          },
          required: ['synced', 'created', 'updated', 'rejected'],
        },
        RecordResponse: {
          type: 'object',
          properties: {
            record_id: { type: 'string' },
            owner_npub: { type: 'string' },
            record_family_hash: { type: 'string' },
            version: { type: 'integer' },
            previous_version: { type: 'integer' },
            signature_npub: { type: 'string' },
            owner_payload: { $ref: '#/components/schemas/OwnerPayload' },
            group_payloads: {
              type: 'array',
              items: { $ref: '#/components/schemas/GroupPayload' },
            },
            updated_at: { type: 'string', format: 'date-time' },
          },
          required: [
            'record_id',
            'owner_npub',
            'record_family_hash',
            'version',
            'previous_version',
            'signature_npub',
            'owner_payload',
            'group_payloads',
            'updated_at',
          ],
        },
        FetchRecordsResponse: {
          type: 'object',
          properties: {
            records: {
              type: 'array',
              items: { $ref: '#/components/schemas/RecordResponse' },
            },
          },
          required: ['records'],
        },
        AdminTableColumn: {
          type: 'object',
          properties: {
            column_name: { type: 'string' },
            data_type: { type: 'string' },
          },
          required: ['column_name', 'data_type'],
        },
        AdminTableSummary: {
          type: 'object',
          properties: {
            table: { type: 'string' },
            row_count: { type: 'integer' },
            columns: {
              type: 'array',
              items: { $ref: '#/components/schemas/AdminTableColumn' },
            },
          },
          required: ['table', 'row_count', 'columns'],
        },
        AdminTablesResponse: {
          type: 'object',
          properties: {
            viewer: { type: 'string' },
            tables: {
              type: 'array',
              items: { $ref: '#/components/schemas/AdminTableSummary' },
            },
          },
          required: ['viewer', 'tables'],
        },
        AdminTableRowsResponse: {
          type: 'object',
          properties: {
            viewer: { type: 'string' },
            table: { type: 'string' },
            row_count: { type: 'integer' },
            limit: { type: 'integer' },
            offset: { type: 'integer' },
            columns: {
              type: 'array',
              items: { $ref: '#/components/schemas/AdminTableColumn' },
            },
            rows: {
              type: 'array',
              items: { type: 'object', additionalProperties: true },
            },
          },
          required: ['viewer', 'table', 'row_count', 'limit', 'offset', 'columns', 'rows'],
        },
      },
    },
    security: [{ nip98: [] }],
    paths: {
      '/health': {
        get: {
          tags: ['Health'],
          security: [],
          summary: 'Get service health and service npub',
          responses: {
            '200': {
              description: 'Service is healthy',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/HealthResponse' },
                },
              },
            },
          },
        },
      },
      '/openapi.json': {
        get: {
          tags: ['Health'],
          security: [],
          summary: 'Get OpenAPI document',
          responses: {
            '200': {
              description: 'OpenAPI document',
            },
          },
        },
      },
      '/docs': {
        get: {
          tags: ['Health'],
          security: [],
          summary: 'Open API docs UI',
          responses: {
            '200': {
              description: 'Swagger UI HTML',
            },
          },
        },
      },
      '/table-viewer': {
        get: {
          tags: ['Admin'],
          security: [],
          summary: 'Read-only backend table viewer UI',
          responses: {
            '200': {
              description: 'HTML table viewer',
            },
          },
        },
      },
      '/api/v4/groups/keys': {
        get: {
          tags: ['Groups'],
          summary: 'Bootstrap wrapped group keys for the authenticated member',
          parameters: [
            {
              name: 'member_npub',
              in: 'query',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Wrapped keys list',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/WrappedKeysResponse' },
                },
              },
            },
            '400': {
              description: 'Bad request',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '403': {
              description: 'member_npub/auth mismatch',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/v4/groups': {
        get: {
          tags: ['Groups'],
          summary: 'List groups visible to the authenticated user (owned + member)',
          parameters: [
            {
              name: 'npub',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'npub of the authenticated user',
            },
          ],
          responses: {
            '200': {
              description: 'Groups list',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ListGroupsResponse' },
                },
              },
            },
            '400': {
              description: 'Bad request',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '403': {
              description: 'npub/auth mismatch',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
        post: {
          tags: ['Groups'],
          summary: 'Create a group',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateGroupRequest' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Group created',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/GroupResponse' },
                },
              },
            },
            '400': {
              description: 'Bad request',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '403': {
              description: 'owner_npub/auth mismatch',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/v4/groups/{groupId}/members': {
        post: {
          tags: ['Groups'],
          summary: 'Add a member to an existing group',
          parameters: [
            {
              name: 'groupId',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AddGroupMemberRequest' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Member added',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/AddGroupMemberResponse' },
                },
              },
            },
            '403': {
              description: 'Only owner may add members',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '404': {
              description: 'Group not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/v4/groups/{groupId}/rotate': {
        post: {
          tags: ['Groups'],
          summary: 'Rotate a group to a fresh epoch and keypair',
          description:
            'Used primarily after member removal. The caller generates a fresh group keypair client-side, wraps the new nsec for remaining members, and the backend promotes the new epoch as current.',
          parameters: [
            {
              name: 'groupId',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RotateGroupRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Group rotated to a new epoch',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/GroupResponse' },
                },
              },
            },
            '403': {
              description: 'Only owner may rotate groups',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '404': {
              description: 'Group not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/v4/groups/{groupId}/members/{memberNpub}': {
        delete: {
          tags: ['Groups'],
          summary: 'Remove a member from an existing group',
          parameters: [
            {
              name: 'groupId',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
            {
              name: 'memberNpub',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Member removed',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/DeleteGroupMemberResponse' },
                },
              },
            },
            '403': {
              description: 'Only owner may remove members',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '404': {
              description: 'Group or member not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/v4/groups/{groupId}': {
        patch: {
          tags: ['Groups'],
          summary: 'Rename a group',
          parameters: [
            {
              name: 'groupId',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateGroupRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Group renamed',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/GroupResponse' },
                },
              },
            },
            '403': {
              description: 'Only owner may rename groups',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '404': {
              description: 'Group not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
        delete: {
          tags: ['Groups'],
          summary: 'Delete a group',
          parameters: [
            {
              name: 'groupId',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          responses: {
            '200': {
              description: 'Group deleted',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/DeleteGroupResponse' },
                },
              },
            },
            '403': {
              description: 'Only owner may delete group',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '404': {
              description: 'Group not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/v4/records/heartbeat': {
        post: {
          tags: ['Records'],
          summary: 'Check which record families have updates since client cursors',
          description: 'Accepts client-side cursors (latest_updated_at per family) and returns which families are stale. Designed for efficient 1/sec polling instead of per-family fetches.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    owner_npub: { type: 'string' },
                    viewer_npub: { type: 'string', description: 'Defaults to owner_npub if omitted' },
                    family_cursors: {
                      type: 'object',
                      additionalProperties: { type: 'string', format: 'date-time', nullable: true },
                      description: 'Map of record_family_hash to latest_updated_at ISO timestamp the client has seen (or null)',
                    },
                  },
                  required: ['owner_npub'],
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Heartbeat result',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      stale_families: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Family hashes that have newer data than the client cursor',
                      },
                      server_cursors: {
                        type: 'object',
                        additionalProperties: { type: 'string', format: 'date-time' },
                        description: 'Current server-side latest_updated_at per family',
                      },
                    },
                    required: ['stale_families', 'server_cursors'],
                  },
                },
              },
            },
            '400': {
              description: 'Bad request',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '403': {
              description: 'viewer_npub/auth mismatch',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/v4/records/summary': {
        get: {
          tags: ['Records'],
          summary: 'Fetch per-family freshness summary for visible records',
          parameters: [
            {
              name: 'owner_npub',
              in: 'query',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'viewer_npub',
              in: 'query',
              required: false,
              schema: { type: 'string' },
            },
            {
              name: 'record_family_hash',
              in: 'query',
              required: false,
              schema: { type: 'string' },
            },
            {
              name: 'since',
              in: 'query',
              required: false,
              schema: { type: 'string', format: 'date-time' },
            },
          ],
          responses: {
            '200': {
              description: 'Records summary fetched',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      families: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            record_family_hash: { type: 'string' },
                            latest_updated_at: { type: 'string', format: 'date-time' },
                            latest_record_count: { type: 'integer' },
                            count_since: { type: 'integer', nullable: true },
                          },
                          required: ['record_family_hash', 'latest_updated_at', 'latest_record_count', 'count_since'],
                        },
                      },
                    },
                    required: ['families'],
                  },
                },
              },
            },
            '400': {
              description: 'Bad request',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '403': {
              description: 'viewer_npub/auth mismatch',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/v4/records': {
        get: {
          tags: ['Records'],
          summary: 'Fetch latest visible record versions for a family hash',
          parameters: [
            {
              name: 'owner_npub',
              in: 'query',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'viewer_npub',
              in: 'query',
              required: false,
              schema: { type: 'string' },
            },
            {
              name: 'record_family_hash',
              in: 'query',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'since',
              in: 'query',
              required: false,
              schema: { type: 'string', format: 'date-time' },
            },
          ],
          responses: {
            '200': {
              description: 'Records fetched',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/FetchRecordsResponse' },
                },
              },
            },
            '400': {
              description: 'Bad request',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '403': {
              description: 'viewer_npub/auth mismatch',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/v4/storage/prepare': {
        post: {
          tags: ['Storage'],
          summary: 'Prepare an opaque storage object upload',
          security: [{ nip98: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PrepareStorageRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Prepared upload target',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/PrepareStorageResponse' },
                },
              },
            },
            '400': { description: 'Invalid request', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          },
        },
      },
      '/api/v4/storage/{objectId}': {
        get: {
          tags: ['Storage'],
          summary: 'Get storage object metadata and stable content URL',
          security: [{ nip98: [] }],
          parameters: [
            { name: 'objectId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': {
              description: 'Storage object metadata',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/StorageObjectResponse' },
                },
              },
            },
          },
        },
        put: {
          tags: ['Storage'],
          summary: 'Upload opaque bytes for a prepared storage object',
          security: [{ nip98: [] }],
          parameters: [
            { name: 'objectId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    base64_data: { type: 'string', description: 'Base64 encoded opaque bytes' },
                  },
                  required: ['base64_data'],
                },
              },
            },
          },
          responses: {
            '200': { description: 'Upload stored' },
            '404': { description: 'Object not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          },
        },
      },
      '/api/v4/storage/{objectId}/complete': {
        post: {
          tags: ['Storage'],
          summary: 'Mark a storage object upload as complete',
          security: [{ nip98: [] }],
          parameters: [
            { name: 'objectId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CompleteStorageRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Storage object completed',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CompleteStorageResponse' },
                },
              },
            },
          },
        },
      },
      '/api/v4/storage/{objectId}/download-url': {
        get: {
          tags: ['Storage'],
          summary: 'Get a time-limited download URL for a storage object',
          security: [{ nip98: [] }],
          parameters: [
            { name: 'objectId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': {
              description: 'Download URL',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/DownloadUrlResponse' },
                },
              },
            },
          },
        },
      },
      '/api/v4/storage/{objectId}/content': {
        get: {
          tags: ['Storage'],
          summary: 'Download opaque object bytes',
          security: [{ nip98: [] }],
          parameters: [
            { name: 'objectId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': {
              description: 'Opaque bytes',
              content: {
                'application/octet-stream': {
                  schema: { type: 'string', format: 'binary' },
                },
              },
            },
          },
        },
      },
      '/api/v4/records/sync': {
        post: {
          tags: ['Records'],
          summary: 'Append new record versions',
          description:
            'Creates new record versions only when `previous_version` matches the latest stored version.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SyncRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Sync result',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/SyncResponse' },
                },
              },
            },
            '400': {
              description: 'Bad request',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '403': {
              description: 'owner_npub/auth mismatch',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/v4/admin/tables': {
        get: {
          tags: ['Admin'],
          summary: 'List inspectable backend tables',
          responses: {
            '200': {
              description: 'Table summaries',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/AdminTablesResponse' },
                },
              },
            },
            '401': {
              description: 'NIP-98 auth required',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/v4/admin/tables/{table}': {
        get: {
          tags: ['Admin'],
          summary: 'Read rows from an inspectable backend table',
          parameters: [
            {
              name: 'table',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', default: 100 },
            },
            {
              name: 'offset',
              in: 'query',
              required: false,
              schema: { type: 'integer', default: 0 },
            },
          ],
          responses: {
            '200': {
              description: 'Paged table rows',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/AdminTableRowsResponse' },
                },
              },
            },
            '401': {
              description: 'NIP-98 auth required',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '404': {
              description: 'Unknown table',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
    },
  };
}
