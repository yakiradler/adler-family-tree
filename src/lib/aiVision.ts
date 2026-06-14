/**
 * Thin abstraction over the AI vision endpoint that powers the
 * AI-Scan flow. Three modes:
 *
 *   1. ENV-configured live endpoint   — POST to `VITE_AI_VISION_URL` with
 *                                        files as base64 in JSON. Expected
 *                                        response: `{ candidates: [...] }`.
 *   2. Supabase Edge function         — when `VITE_AI_VISION_EDGE === 'true'`
 *                                        (i.e. the `parse-family-document`
 *                                        function is actually deployed), call
 *                                        it via `supabase.functions.invoke`.
 *   3. Demo / no-config               — returns a small synthetic candidate
 *                                        list so the UI is demonstrable
 *                                        without any backend.
 *
 * CRITICAL — honesty contract: demo data is ONLY returned when no real
 * backend is configured (mode 3). When a live backend *is* configured
 * (mode 1 or 2) and the call fails, we THROW so the UI shows an error
 * state. We must never silently fabricate "scanned" people on top of a
 * real backend failure — a user could otherwise add invented ancestors to
 * a real family tree believing the AI read their photo. The "demo mode"
 * notice in AIScanModal is driven by `isLiveAIScanConfigured()`, which is
 * false in mode 3, so synthetic data is always clearly labelled.
 *
 * The backend contract is intentionally simple — keep schema work to a
 * minimum on the model side. All fields except `first_name` are optional
 * so even the cheapest vision pass can produce something useful.
 */
import { supabase } from './supabase'
import type { Gender } from '../types'

/** One person extracted from a scanned asset. */
export interface AIScanCandidate {
  /** Stable key for React lists & user-edited overrides. */
  id: string
  first_name: string
  last_name?: string
  gender?: Gender
  /** Approximate birth year if visible (undated photos still pass). */
  birth_year?: number
  /** Free-form AI rationale shown under the row. */
  notes?: string
  /** 0–1 confidence the model emitted. */
  confidence?: number
}

const VISION_URL = import.meta.env.VITE_AI_VISION_URL as string | undefined
/**
 * Whether the `parse-family-document` Supabase Edge Function is actually
 * deployed. Must be opted into explicitly — the mere presence of a Supabase
 * project does NOT imply the vision function exists (it currently does not),
 * and assuming so is exactly what caused live-looking demo data with the
 * "demo" notice hidden in production.
 */
const EDGE_ENABLED = import.meta.env.VITE_AI_VISION_EDGE === 'true'

/**
 * Run vision parsing on a list of user-supplied files. Returns the
 * candidates the model proposed. Throws on hard errors so the UI can
 * show its error state.
 */
export async function scanFiles(files: File[]): Promise<AIScanCandidate[]> {
  if (files.length === 0) return []

  // ── Mode 1: env-configured live endpoint ─────────────────────────────
  if (VISION_URL) {
    const payload = {
      files: await Promise.all(
        files.map(async (f) => ({
          name: f.name,
          mime: f.type,
          data: await fileToBase64(f),
        })),
      ),
    }
    const res = await fetch(VISION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(`AI vision endpoint returned ${res.status}`)
    const json = await res.json()
    return normalize(json.candidates ?? [])
  }

  // ── Mode 2: Supabase edge function (only when explicitly deployed) ────
  if (EDGE_ENABLED) {
    const formData = new FormData()
    files.forEach((f, i) => formData.append(`file_${i}`, f, f.name))
    const { data, error } = await supabase.functions.invoke<{
      candidates?: unknown[]
    }>('parse-family-document', {
      body: formData,
    })
    // A configured backend that errors must surface as an error — never
    // fall through to fabricated demo data (see honesty contract above).
    if (error) throw new Error(error.message || 'AI vision edge function failed')
    return normalize(data?.candidates ?? [])
  }

  // ── Mode 3: demo / no config — synthesize candidates ─────────────────
  // Reached only when no real backend is configured; the UI shows the
  // "demo mode" notice in this case (isLiveAIScanConfigured() === false).
  return demoCandidates(files)
}

/** Coerce wire-format objects into our local interface, dropping junk. */
function normalize(raw: unknown[]): AIScanCandidate[] {
  return raw
    .map((r, i): AIScanCandidate | null => {
      if (!r || typeof r !== 'object') return null
      const o = r as Record<string, unknown>
      const first = String(o.first_name ?? o.firstName ?? '').trim()
      if (!first) return null
      const genderRaw = String(o.gender ?? '').toLowerCase()
      const gender: Gender | undefined =
        genderRaw === 'male' ? 'male' : genderRaw === 'female' ? 'female' : undefined
      const birthYear =
        typeof o.birth_year === 'number'
          ? o.birth_year
          : typeof o.birthYear === 'number'
            ? o.birthYear
            : undefined
      return {
        id: String(o.id ?? `cand-${i}-${Date.now()}`),
        first_name: first,
        last_name: o.last_name ? String(o.last_name).trim() : o.lastName ? String(o.lastName).trim() : undefined,
        gender,
        birth_year: birthYear,
        notes: o.notes ? String(o.notes) : undefined,
        confidence: typeof o.confidence === 'number' ? o.confidence : undefined,
      }
    })
    .filter((c): c is AIScanCandidate => c !== null)
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      // result is a data URL — strip the "data:...;base64," prefix.
      const s = String(reader.result ?? '')
      const i = s.indexOf(',')
      resolve(i >= 0 ? s.slice(i + 1) : s)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/**
 * Synthetic candidates for demo mode. Returns a varied set so the user
 * can see the review-and-confirm UI exercised without a real API. Number
 * of candidates scales loosely with the upload count to feel responsive.
 */
function demoCandidates(files: File[]): AIScanCandidate[] {
  const seeds: Omit<AIScanCandidate, 'id'>[] = [
    { first_name: 'אברהם', last_name: 'אדלר', gender: 'male', birth_year: 1922, notes: 'דמות בכובע, פינה שמאלית עליונה', confidence: 0.91 },
    { first_name: 'שרה', last_name: 'אדלר', gender: 'female', birth_year: 1925, notes: 'אישה בשמלה, מימין לאברהם', confidence: 0.88 },
    { first_name: 'משה', last_name: 'אדלר', gender: 'male', birth_year: 1948, notes: 'ילד צעיר במרכז התמונה', confidence: 0.83 },
    { first_name: 'דבורה', last_name: 'אדלר', gender: 'female', birth_year: 1951, notes: 'ילדה עם סרט בשיער', confidence: 0.79 },
    { first_name: 'יעקב', last_name: 'כהן', gender: 'male', birth_year: 1965, notes: 'מתאריך כתוב על המסמך', confidence: 0.74 },
  ]
  const count = Math.min(seeds.length, Math.max(2, files.length + 1))
  return seeds.slice(0, count).map((s, i) => ({ ...s, id: `demo-${i}-${Date.now()}` }))
}

/** True when a real backend is wired, so the UI can hide the "demo" notice. */
export function isLiveAIScanConfigured(): boolean {
  return !!VISION_URL || EDGE_ENABLED
}
