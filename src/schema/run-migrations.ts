import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';
import { getDb, closeDb } from '../db';
import { config } from '../config';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function ensureDatabaseExists(): Promise<void> {
  const adminOpts: Parameters<typeof postgres>[0] = {
    database: 'postgres',
  };

  if (config.db.host) adminOpts.host = config.db.host;
  if (config.db.port) adminOpts.port = config.db.port;
  if (config.db.user) adminOpts.username = config.db.user;
  if (config.db.password) adminOpts.password = config.db.password;

  const admin = postgres(adminOpts);
  try {
    const rows = await admin<{ exists: number }[]>`
      SELECT 1 as exists FROM pg_database WHERE datname = ${config.db.database}
    `;

    if (rows.length === 0) {
      await admin.unsafe(`CREATE DATABASE "${config.db.database.replace(/"/g, '""')}"`);
      console.log(`Created database ${config.db.database}`);
    }
  } finally {
    await admin.end();
  }
}

async function run() {
  await ensureDatabaseExists();

  const sql = getDb();
  const migrationPath = join(__dirname, '001_init.sql');
  const migration = readFileSync(migrationPath, 'utf-8');

  const statements = migration
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  console.log(`Running ${statements.length} migration statements...`);

  for (let i = 0; i < statements.length; i++) {
    await sql.unsafe(statements[i]);
    console.log(`  [${i + 1}/${statements.length}] OK`);
  }

  console.log('Migrations complete.');
  await closeDb();
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
