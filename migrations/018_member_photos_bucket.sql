-- ============================================================
-- Migration 018: member-photos storage bucket
-- ------------------------------------------------------------
-- Why this exists (red-team round 2, Wave 1 item 2)
--   Member photos were stored as raw base64 data URLs inside
--   `members.photo_url` / `members.photos[]`. Full-resolution phone
--   photos bloated every row, slowed `fetchMembers`, risked silent
--   write rejection on payload limits, and caused "photo disappears on
--   refresh" reports. The client now uploads to this bucket and stores
--   only the resulting public URL (see src/lib/photoUpload.ts).
--
-- Path convention: `<treeId>/p-<rand>-<ts>.<ext>`. The tree id is the
-- FIRST path segment so storage-RLS can anchor write access to the same
-- writer roles enforced on members (migration 017). Read is public so
-- <img src> works without signed URLs (same model as tree-icons, 014).
--
-- Safety: idempotent. storage.objects policies need elevated rights; if
-- this role lacks them we degrade to a NOTICE and they can be added from
-- Dashboard → Storage → Policies (same pattern as migration 014).
-- ============================================================

insert into storage.buckets (id, name, public)
values ('member-photos', 'member-photos', true)
on conflict (id) do nothing;

do $$
begin
  drop policy if exists "member_photos_public_read"  on storage.objects;
  drop policy if exists "member_photos_writer_insert" on storage.objects;
  drop policy if exists "member_photos_writer_update" on storage.objects;
  drop policy if exists "member_photos_writer_delete" on storage.objects;

  create policy "member_photos_public_read" on storage.objects for select
    using (bucket_id = 'member-photos');

  -- Insert/update/delete allowed for admins, or a user with a WRITER
  -- tree_access role (owner/editor/member; viewer excluded) on the tree
  -- named by the first path segment. Inlined rather than calling
  -- has_tree_write() so this migration is self-contained even if 017
  -- hasn't been applied yet.
  create policy "member_photos_writer_insert" on storage.objects for insert
    with check (
      bucket_id = 'member-photos' and (
        public.is_admin(auth.uid())
        or exists (
          select 1 from public.tree_access ta
          where ta.tree_id::text = split_part(storage.objects.name, '/', 1)
            and ta.user_id = auth.uid()
            and ta.role in ('owner', 'editor', 'member')
        )
      )
    );
  create policy "member_photos_writer_update" on storage.objects for update
    using (
      bucket_id = 'member-photos' and (
        public.is_admin(auth.uid())
        or exists (
          select 1 from public.tree_access ta
          where ta.tree_id::text = split_part(storage.objects.name, '/', 1)
            and ta.user_id = auth.uid()
            and ta.role in ('owner', 'editor', 'member')
        )
      )
    );
  create policy "member_photos_writer_delete" on storage.objects for delete
    using (
      bucket_id = 'member-photos' and (
        public.is_admin(auth.uid())
        or exists (
          select 1 from public.tree_access ta
          where ta.tree_id::text = split_part(storage.objects.name, '/', 1)
            and ta.user_id = auth.uid()
            and ta.role in ('owner', 'editor', 'member')
        )
      )
    );
exception when insufficient_privilege then
  raise notice 'storage.objects policies skipped (insufficient privilege) — create them in Dashboard > Storage > Policies';
end$$;
