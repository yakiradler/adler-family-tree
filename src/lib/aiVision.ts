/**
 * Thin abstraction over the AI vision endpoint that powers the
 * AI-Scan flow. Three modes:
 *
 *   1. ENV-configured live endpoint   — POST to `VITE_AI_VISION_URL` with
 *                                        files as base64 in JSON. Expected
 *                                        response: `{ candidates: [...] }`.
 *   2. Supabase Edge function fallback — if `VITE_AI_VISION_URL` isn't set
 *                                        but Supabase is, try calling
 *                                        `parse-family-document` via
 *                                        `supabase.functions.invoke`.
 *   3. Demo / no-config               — returns a small synthetic candidate
 *                                        list so the UI is fully demonstrable
 *                                        without any backend.
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
const SUPABASE_CONFIGURED =
  !!import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_URL !== ''

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

  // ── Mode 2: Supabase edge function ────────────────────────────────────
  if (SUPABASE_CONFIGURED) {
    try {
      const formData = new FormData()
      files.forEach((f, i) => formData.append(`file_${i}`, f, f.name))
      const { data, error } = await supabase.functions.invoke<{
        candidates?: unknown[]
      }>('parse-family-document', {
        body: formData,
      })
      if (!error && data?.candidates) return normalize(data.candidates)
    } catch {
      // fall through to demo
    }
  }

  // ── Mode 3: demo / no config — synthesize candidates ─────────────────
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

/** True when the live API is wired, so the UI can hide the "demo" notice. */
export function isLiveAIScanConfigured(): boolean {
  return !!VISION_URL || SUPABASE_CONFIGURED
}
