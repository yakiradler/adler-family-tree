import { Client } from 'pg'
const c = new Client({
  connectionString:
    'postgresql://postgres:Yakiradler1123@db.oklwywuxglaefchjbhcw.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false },
})
await c.connect()

const r = await c.query(
  `SELECT first_name, last_name FROM members
     WHERE first_name LIKE '%נחום%'
        OR first_name LIKE '%רחל%'
        OR first_name LIKE '%שמחה%'
     LIMIT 20`,
)
console.log('Matches for nachum/rachel/simcha:')
for (const row of r.rows) console.log(' ', JSON.stringify(row))

console.log('\nRows where last_name appears INSIDE first_name (the duplication bug):')
const d = await c.query(
  `SELECT first_name, last_name FROM members
    WHERE last_name IS NOT NULL AND last_name != ''
      AND first_name LIKE '%' || last_name || '%'`,
)
console.log('  count =', d.rows.length)
for (const row of d.rows) console.log(' ', JSON.stringify(row))

await c.end()
