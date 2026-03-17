import postgres from 'postgres';
const sql = postgres({ host: 'localhost', port: 5432, database: 'postgres' });
try {
  const rows = await sql`select current_user, current_database()`;
  console.log(JSON.stringify(rows));
} finally {
  await sql.end();
}
