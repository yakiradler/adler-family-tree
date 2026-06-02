/**
 * Smoke test: simulate the production app reading data via the
 * publishable (anon) key against the new Frankfurt project.
 * Confirms that REST + RLS work end-to-end before we touch Vercel.
 */
import { createClient } from '@supabase/supabase-js'

const url = 'https://wkbdqdytfjycbbcnzjuv.supabase.co'
const anonKey = 'sb_publishable_CFnyhXuP0zXsdu885VgE_g_cARjNlyC'

const sb = createClient(url, anonKey)

// 1. Anonymous read: should return rows that RLS allows for the
//    anon role. With our policies, only profiles is readable to all.
const { data: profiles, error: pErr } = await sb.from('profiles').select('id, full_name, role').limit(10)
console.log('profiles (anon read):', pErr ? `ERROR ${pErr.message}` : `${profiles?.length} rows`)

// 2. RLS check: members must NOT leak to anon. We expect an empty
//    array (or an error) — anything else is a security regression.
const { data: members, error: mErr } = await sb.from('members').select('id').limit(5)
console.log('members (anon read):', mErr ? `ERROR ${mErr.message}` : `${members?.length} rows (expect 0)`)

// 3. Confirm auth endpoint responds (we don't know any user's password
//    so we test by triggering a known-bad login and looking for the
//    "invalid credentials" error rather than a network/config error).
const { error: aErr } = await sb.auth.signInWithPassword({
  email: 'definitely-not-a-real-account@example.com',
  password: 'wrong',
})
console.log('auth endpoint:', aErr?.message?.toLowerCase().includes('invalid') ? 'OK (rejected bad creds as expected)' : `unexpected: ${aErr?.message}`)
