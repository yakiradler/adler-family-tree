/**
 * One-off: confirm connectivity to the new Frankfurt project before migrating.
 * Probes both pooler generations for eu-central-1.
 */
import { Client } from 'pg'

const PROJECT_REF = 'wkbdqdytfjycbbcnzjuv'
const DB_PASSWORD = 'Yakiradler1123'

async function tryConnect(host: string) {
  const c = new Client({
    host,
    port: 6543,
    database: 'postgres',
    user: `postgres.${PROJECT_REF}`,
    password: DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  })
  try {
    await c.connect()
    console.log(`✓ Connected via ${host}`)
    const v = await c.query('select version() as v, current_database() as db')
    console.log(`  ${v.rows[0].v.slice(0, 80)}`)
    console.log(`  database: ${v.rows[0].db}`)
    const tables = await c.query(
      `select count(*) as n from information_schema.tables
        where table_schema = 'public'`,
    )
    console.log(`  public tables: ${tables.rows[0].n}`)
    await c.end()
    return host
  } catch (e) {
    console.log(`  ✗ ${host}: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`)
    try { await c.end() } catch { /* ignore */ }
    return null
  }
}

for (const prefix of ['aws-1', 'aws-0']) {
  const host = `${prefix}-eu-central-1.pooler.supabase.com`
  const ok = await tryConnect(host)
  if (ok) {
    console.log(`\nFrankfurt pooler host: ${host}`)
    process.exit(0)
  }
}
console.error('\nCould not reach the new Frankfurt project pooler.')
process.exit(1)
