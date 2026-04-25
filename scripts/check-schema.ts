import { Client } from 'pg'
const c = new Client({
  connectionString:
    'postgresql://postgres:Yakiradler1123@db.oklwywuxglaefchjbhcw.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false },
})
await c.connect()

for (const t of ['profiles', 'access_requests', 'tree_invites', 'relationships']) {
  const r = await c.query(
    `select column_name, data_type, is_nullable
       from information_schema.columns
      where table_schema = 'public' and table_name = $1
      order by ordinal_position`,
    [t],
  )
  console.log(`\n${t}:`)
  for (const row of r.rows) console.log(' -', row.column_name, row.data_type, row.is_nullable === 'NO' ? 'NOT NULL' : '')
}

await c.end()
