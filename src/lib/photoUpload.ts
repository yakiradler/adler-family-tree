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
import { fileToDownscaledDataURL, fileToPhotoBlob, photoStoragePath } from './imageResize'

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
