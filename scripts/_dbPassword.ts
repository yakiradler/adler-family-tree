// Database password for the maintenance scripts. Never hardcode it:
// set SUPABASE_DB_PASSWORD in your shell (or a gitignored .env.local).
export function dbPassword(): string {
  const pw = process.env.SUPABASE_DB_PASSWORD
  if (!pw) {
    throw new Error('SUPABASE_DB_PASSWORD is not set. Export it before running this script.')
  }
  return pw
}
