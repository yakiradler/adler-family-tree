-- ============================================================
-- Migration 023: social base — tree-scoped comments, reactions,
--                and parental moderation for minors
-- ------------------------------------------------------------
-- 1. member_notes: stop the cross-tree leak (any authed user could read
--    every note). Scope reads + writes to tree visibility so ALL tree
--    members (including viewer) can comment on members they can see.
-- 2. Parental moderation: notes authored by a MINOR are 'pending' and
--    visible only to the author until a parent/owner approves them.
-- 3. member_reactions: likes / emoji reactions on members.
--
-- Idempotent. Depends on member_visible_to (008), is_tree_owner +
-- member_tree (020/021).
-- ============================================================

set check_function_bodies = off;

-- ─── 1. member_notes: moderation columns + comment-first default ──
alter table public.member_notes
  add column if not exists status text not null default 'public'
    check (status in ('public', 'pending'));
alter table public.member_notes
  add column if not exists approved_by uuid references auth.users(id) on delete set null;
-- Spec: the kind toggle leads with "comment", then "memory".
alter table public.member_notes alter column kind set default 'comment';

-- ─── 2. Minor flag on profiles (parent-managed) ──────────────
alter table public.profiles
  add column if not exists is_minor boolean not null default false;
alter table public.profiles
  add column if not exists guardian_id uuid references auth.users(id) on delete set null;

-- ─── 3. Force minor-authored notes to 'pending' (server-side) ─
create or replace function public.set_note_minor_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.profiles
     where id = new.author_id and coalesce(is_minor, false) = true
  ) then
    new.status := 'pending';
    new.approved_by := null;
  else
    new.status := coalesce(new.status, 'public');
  end if;
  return new;
end;
$$;

drop trigger if exists on_member_note_insert on public.member_notes;
create trigger on_member_note_insert
  before insert on public.member_notes
  for each row execute procedure public.set_note_minor_status();

-- ─── 4. member_notes RLS: tree-scoped + moderation-aware ─────
drop policy if exists "notes_select_auth"   on public.member_notes;
drop policy if exists "notes_select_scoped" on public.member_notes;
drop policy if exists "notes_insert_self"   on public.member_notes;
drop policy if exists "notes_insert_scoped" on public.member_notes;
drop policy if exists "notes_update_owner"  on public.member_notes;
drop policy if exists "notes_delete_owner"  on public.member_notes;

-- Read: must be able to see the member; pending notes are visible only to
-- their author and to the tree owner (the approving parent).
create policy "notes_select_scoped" on public.member_notes for select
  using (
    public.member_visible_to(auth.uid(), member_id)
    and (
      status = 'public'
      or author_id = auth.uid()
      or public.is_tree_owner(auth.uid(), public.member_tree(member_id))
    )
  );

-- Write: any tree member who can SEE the member may comment (viewer too).
create policy "notes_insert_scoped" on public.member_notes for insert
  with check (
    auth.role() = 'authenticated'
    and author_id = auth.uid()
    and public.member_visible_to(auth.uid(), member_id)
  );

-- Owner/parent can update (approve) any note on their tree...
create policy "notes_update_owner" on public.member_notes for update
  using (public.is_tree_owner(auth.uid(), public.member_tree(member_id)))
  with check (public.is_tree_owner(auth.uid(), public.member_tree(member_id)));

-- ...and delete any note on their tree (moderation).
create policy "notes_delete_owner" on public.member_notes for delete
  using (public.is_tree_owner(auth.uid(), public.member_tree(member_id)));

-- (notes_update_self / notes_delete_self / notes_delete_admin remain.)

-- ─── 5. member_reactions (likes / emoji) ─────────────────────
create table if not exists public.member_reactions (
  id          uuid primary key default uuid_generate_v4(),
  member_id   uuid not null references public.members(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  emoji       text not null,
  created_at  timestamptz not null default now(),
  unique (member_id, user_id, emoji)
);
create index if not exists member_reactions_member_idx on public.member_reactions(member_id);

alter table public.member_reactions enable row level security;
drop policy if exists "mr_select_scoped" on public.member_reactions;
drop policy if exists "mr_insert_self"   on public.member_reactions;
drop policy if exists "mr_delete_self"   on public.member_reactions;

create policy "mr_select_scoped" on public.member_reactions for select
  using (public.member_visible_to(auth.uid(), member_id));
create policy "mr_insert_self" on public.member_reactions for insert
  with check (
    auth.role() = 'authenticated'
    and user_id = auth.uid()
    and public.member_visible_to(auth.uid(), member_id)
  );
create policy "mr_delete_self" on public.member_reactions for delete
  using (user_id = auth.uid());

do $$
begin
  raise notice '023 applied: notes tree-scoped + minor moderation; member_reactions ready.';
end$$;
