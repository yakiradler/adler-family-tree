/**
 * One-off: report current DB size + per-table row counts + auth.users count.
 * Run once before migrating the project to a new region.
 */
import { Client } from 'pg'

const PROJECT_REF = 'oklwywuxglaefchjbhcw'
const DB_PASSWORD = 'Yakiradler1123'

const client = new Client({
  host: 'aws-1-ap-south-1.pooler.supabase.com',
  port: 6543,
  database: 'postgres',
  user: `postgres.${PROJECT_REF}`,
  password: DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
})

await client.connect()
console.log('Connected to Mumbai pooler.\n')

const dbSize = await client.query(
  `select pg_size_pretty(pg_database_size(current_database())) as size,
          pg_database_size(current_database()) as bytes`,
)
console.log('DB size:', dbSize.rows[0])

const tables = await client.query(
  `select schemaname, relname, n_live_tup as rows,
          pg_size_pretty(pg_total_relation_size(relid)) as size
     from pg_stat_user_tables
    where schemaname in ('public', 'auth')
    order by n_live_tup desc nulls last`,
)
console.log('\nTables:')
for (const r of tables.rows) {
  console.log(` - ${r.schemaname}.${r.relname.padEnd(35)} ${String(r.rows ?? 0).padStart(7)} rows  ${r.size}`)
}

const authUsers = await client.query(`select count(*) as n from auth.users`)
console.log(`\nauth.users count: ${authUsers.rows[0].n}`)

const storageObjs = await client.query(
  `select count(*) as n, coalesce(sum((metadata->>'size')::bigint), 0) as bytes
     from storage.objects`,
).catch(() => ({ rows: [{ n: 0, bytes: 0 }] }))
const mb = (Number(storageObjs.rows[0].bytes) / 1024 / 1024).toFixed(2)
console.log(`storage.objects: ${storageObjs.rows[0].n} files (${mb} MB)`)

await client.end()
