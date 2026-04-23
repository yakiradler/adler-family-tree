-- ============================================================
-- Family Tree System – Supabase Schema
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ─────────────────────────────────────────────
-- PROFILES  (mirrors auth.users, one row each)
-- ─────────────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  avatar_url  text,
  role        text not null default 'user' check (role in ('admin', 'user')),
  created_at  timestamptz not null default now()
);

-- Auto-create a profile row whenever a user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email, ''),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─────────────────────────────────────────────
-- MEMBERS
-- ─────────────────────────────────────────────
create table if not exists public.members (
  id          uuid primary key default uuid_generate_v4(),
  first_name  text not null,
  last_name   text not null,
  birth_date  date,
  death_date  date,
  bio         text,
  photo_url   text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- RELATIONSHIPS
-- ─────────────────────────────────────────────
create table if not exists public.relationships (
  id           uuid primary key default uuid_generate_v4(),
  member_a_id  uuid not null references public.members(id) on delete cascade,
  member_b_id  uuid not null references public.members(id) on delete cascade,
  type         text not null check (type in ('parent-child', 'spouse', 'sibling')),
  created_at   timestamptz not null default now(),
  unique (member_a_id, member_b_id, type)
);

-- ─────────────────────────────────────────────
-- EDIT REQUESTS
-- ─────────────────────────────────────────────
create table if not exists public.edit_requests (
  id                uuid primary key default uuid_generate_v4(),
  requester_id      uuid not null references auth.users(id) on delete cascade,
  target_member_id  uuid not null references public.members(id) on delete cascade,
  change_data       jsonb not null default '{}',
  status            text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────

-- Profiles: users can read all, update own
alter table public.profiles enable row level security;
create policy "profiles_select_all"  on public.profiles for select using (true);
create policy "profiles_update_own"  on public.profiles for update using (auth.uid() = id);

-- Members: authenticated users can read all, insert own, update own
alter table public.members enable row level security;
create policy "members_select_all"   on public.members for select using (auth.role() = 'authenticated');
create policy "members_insert_auth"  on public.members for insert with check (auth.role() = 'authenticated');
create policy "members_update_auth"  on public.members for update using (auth.role() = 'authenticated');
create policy "members_delete_admin" on public.members for delete using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);

-- Relationships
alter table public.relationships enable row level security;
create policy "rels_select_all"  on public.relationships for select using (auth.role() = 'authenticated');
create policy "rels_insert_auth" on public.relationships for insert with check (auth.role() = 'authenticated');
create policy "rels_delete_auth" on public.relationships for delete using (auth.role() = 'authenticated');

-- Edit requests: users see own, admins see all
alter table public.edit_requests enable row level security;
create policy "er_select_own"   on public.edit_requests for select using (
  requester_id = auth.uid() or
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);
create policy "er_insert_auth"  on public.edit_requests for insert with check (auth.role() = 'authenticated');
create policy "er_update_admin" on public.edit_requests for update using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);

-- ─────────────────────────────────────────────
-- SAMPLE DATA (optional – remove before prod)
-- ─────────────────────────────────────────────
-- Uncomment to seed demo data after creating your first account:
--
-- insert into public.members (first_name, last_name, birth_date, bio, created_by)
-- values
--   ('James',  'Anderson', '1940-03-15', 'Patriarch of the Anderson family.', auth.uid()),
--   ('Mary',   'Anderson', '1943-07-22', 'Loved gardening and cooking.',       auth.uid()),
--   ('Robert', 'Anderson', '1968-11-05', 'Software engineer.',                 auth.uid()),
--   ('Susan',  'Anderson', '1972-04-18', 'Schoolteacher and artist.',          auth.uid()),
--   ('Emily',  'Anderson', '1998-09-30', 'University student.',                auth.uid());
