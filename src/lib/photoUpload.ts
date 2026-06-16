/**
 * Member-photo persistence. Single entry point used by every photo picker
 * (AddMemberModal, EditMemberModal, MemberPanel) so the upload logic can
 * never drift between surfaces.
 *
 * Why this exists (red-team round 2, Wave 1 item 2): photos used to be
 * stored as raw base64 data URLs inside `members.photo_url` / `photos[]`.
 * Full-resolution phone photos (3-6 MB each) bloated every row, slowed
 * `fetchMembers` (which pulls every photo), risked silent write rejection
 * on payload limits, and were the source of the "photo disappears on
 * refresh" reports. We now upload to the public `member-photos` Storage
 * bucket and persist only the URL.
 *
 * Fallback: in demo/offline mode (no Supabase) or when no tree anchor is
 * available, we return a DOWNSCALED data URL (~80-200 KB) — small enough
 * to survive in localStorage and far better than the previous full-res
 * inline blob. We never persist a multi-MB string into a DB column again.
 */
import { supabase, isSupabaseConfigured } from './supabase'
import { fileToDownscaledDataURL, fileToPhotoBlob, photoStoragePath, fileToIconBlob, iconStoragePath } from './imageResize'

export const MEMBER_PHOTO_BUCKET = 'member-photos'

/**
 * Upload a member photo and return a persistent URL. `treeId` is the
 * Storage-RLS ownership anchor (first path segment) — pass the tree the
 * member belongs to. Resolves to a downscaled data URL when no real
 * backend / tree is available, or if the upload fails (so the user never
 * loses their pick), logging the failure for diagnosis.
 */
export async function uploadMemberPhoto(file: File, treeId?: string | null): Promise<string> {
  if (!isSupabaseConfigured || !treeId) {
    return fileToDownscaledDataURL(file)
  }
  try {
    const { blob, contentType, ext } = await fileToPhotoBlob(file)
    const rand = Math.random().toString(36).slice(2, 10)
    const path = photoStoragePath(treeId, ext, Date.now(), rand)
    const { error } = await supabase.storage
      .from(MEMBER_PHOTO_BUCKET)
      .upload(path, blob, { contentType })
    if (error) throw error
    const { data: pub } = supabase.storage.from(MEMBER_PHOTO_BUCKET).getPublicUrl(path)
    if (!pub?.publicUrl) throw new Error('no public url')
    return pub.publicUrl
  } catch (e) {
    console.warn('[member-photo] upload failed, falling back to inline image', e)
    return fileToDownscaledDataURL(file)
  }
}

export type StatusMedia = { url: string; type: 'image' | 'video' }

/** Max video size we'll accept (no client-side transcoding). */
const MAX_VIDEO_BYTES = 25 * 1024 * 1024

/**
 * Upload one media file for a family-feed status. Images reuse the
 * downscale+upload path; videos upload raw to the same tree-anchored
 * bucket (size-capped). Returns null if a video can't be stored (no
 * backend, too large, or upload error) so the caller can skip it
 * without losing the rest of the post.
 */
export async function uploadStatusMedia(file: File, treeId?: string | null): Promise<StatusMedia | null> {
  const isVideo = file.type.startsWith('video/')
  if (!isVideo) {
    const url = await uploadMemberPhoto(file, treeId)
    return { url, type: 'image' }
  }
  // Video: needs a real backend (too big to inline) + a size cap.
  if (!isSupabaseConfigured || !treeId) return null
  if (file.size > MAX_VIDEO_BYTES) return null
  try {
    const ext = (file.name.split('.').pop() || 'mp4').toLowerCase()
    const rand = Math.random().toString(36).slice(2, 10)
    const path = photoStoragePath(treeId, ext, Date.now(), rand)
    const { error } = await supabase.storage
      .from(MEMBER_PHOTO_BUCKET)
      .upload(path, file, { contentType: file.type || 'video/mp4' })
    if (error) throw error
    const { data: pub } = supabase.storage.from(MEMBER_PHOTO_BUCKET).getPublicUrl(path)
    if (!pub?.publicUrl) throw new Error('no public url')
    return { url: pub.publicUrl, type: 'video' }
  } catch (e) {
    console.warn('[status-media] video upload failed', e)
    return null
  }
}

/**
 * Upload a family/tree icon (the emblem above the family name on the
 * home page + the tree cards). Downscales to a small square, uploads to
 * the public `tree-icons` bucket, returns the URL; falls back to a small
 * data URL in demo/offline mode. Caller persists via updateTree({icon_url}).
 */
export async function uploadTreeIcon(file: File, treeId: string): Promise<string> {
  if (!isSupabaseConfigured || !treeId) return fileToDownscaledDataURL(file)
  try {
    const { blob, contentType, ext } = await fileToIconBlob(file)
    const path = iconStoragePath(treeId, ext, Date.now())
    const { error } = await supabase.storage.from('tree-icons').upload(path, blob, { contentType })
    if (error) throw error
    const { data: pub } = supabase.storage.from('tree-icons').getPublicUrl(path)
    if (!pub?.publicUrl) throw new Error('no public url')
    return pub.publicUrl
  } catch (e) {
    console.warn('[tree-icon] upload failed', e)
    return fileToDownscaledDataURL(file)
  }
}
