/**
 * Apply a SQL migration file to the live Supabase Postgres.
 *
 * Usage:  npx tsx scripts/run-migration.ts migrations/001_member_extensions.sql
 *
 * Migrations should be idempotent (use IF NOT EXISTS / CREATE OR REPLACE).
 */
import { Client } from 'pg'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const file = process.argv[2]
if (!file) {
  console.error('Usage: tsx scripts/run-migration.ts <path-to-sql>')
  process.exit(1)
}

const sql = readFileSync(resolve(file), 'utf8')
console.log(`Applying ${file} (${sql.length} bytes)…`)

const c = new Client({
  connectionString:
    'postgresql://postgres:Yakiradler1123@db.oklwywuxglaefchjbhcw.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false },
})
await c.connect()
try {
  await c.query(sql)
  console.log('✓ Migration applied.')
  // Show resulting columns for sanity.
  const cols = await c.query(
    `select column_name, data_type
       from information_schema.columns
      where table_schema = 'public' and table_name = 'members'
      order by ordinal_position`,
  )
  console.log('members columns now:')
  for (const r of cols.rows) console.log(' -', r.column_name, r.data_type)
} catch (e) {
  console.error('✗ Migration failed:', e)
  process.exitCode = 1
} finally {
  await c.end()
}
