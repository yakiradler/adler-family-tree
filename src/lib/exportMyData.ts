import { useFamilyStore } from '../store/useFamilyStore'

/**
 * Download everything the signed-in user can see as a single JSON file —
 * their own personal backup ("my data, in my hands"). The store already
 * holds exactly what RLS lets them access (their trees + members +
 * relationships + notes), so we snapshot that. Pure client-side; no
 * network call, works offline.
 */
export function downloadMyData(): void {
  const s = useFamilyStore.getState()
  const payload = {
    app: 'InfiniTree',
    format: 'infinitree-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: s.profile
      ? { id: s.profile.id, full_name: s.profile.full_name }
      : null,
    trees: s.trees,
    members: s.members,
    relationships: s.relationships,
    notes: s.notes,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `infinitree-backup-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
