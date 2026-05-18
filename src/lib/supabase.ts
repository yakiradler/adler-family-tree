import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// True only when real env vars are present. When false we're in pure
// local/demo mode: the client still exists (with placeholder values so
// createClient doesn't throw) but every network call WILL fail. The
// store reads this flag to suppress the "sync failed" toast in that
// case — a local-only session is the intended UX there, not an error.
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string)
  : createClient('https://placeholder.supabase.co', 'placeholder-key')
