-- Delete the two truly-orphan placeholder members.
--
-- Discovery diagnostic identified these as having ZERO connections
-- (no parents, no children, no spouse) — they were created as
-- placeholders that never got filled in.  The user (yakir) explicitly
-- approved deleting them on 2026-05-25.
--
--   1. "סבא אדלר"  id=b9786b21-0daf-4ef7-ae4c-b966d813553b
--   2. "ילד 1"     id=77b32fdc-5551-4a33-a4ab-e7ab773172a1
--
-- Idempotent: each delete is by primary key, will simply skip if the
-- row is already gone.  No cascading needed since these rows have
-- zero outgoing relationships, but we run a precautionary check for
-- any relationship row that mentions them just in case the diagnostic
-- missed something.

do $$
declare
  rel_count int;
  member_count int;
  r record;
begin
  -- Sanity: confirm zero relationships before deleting members.
  select count(*) into rel_count
    from public.relationships
   where member_a_id in (
           'b9786b21-0daf-4ef7-ae4c-b966d813553b',  -- סבא אדלר
           '77b32fdc-5551-4a33-a4ab-e7ab773172a1'   -- ילד 1
         )
      or member_b_id in (
           'b9786b21-0daf-4ef7-ae4c-b966d813553b',
           '77b32fdc-5551-4a33-a4ab-e7ab773172a1'
         );
  raise notice '── relationship rows mentioning either placeholder: % ──', rel_count;
  if rel_count > 0 then
    raise notice '── (will delete those rows first to avoid FK violation) ──';
    for r in
      select id, type, member_a_id, member_b_id
        from public.relationships
       where member_a_id in (
               'b9786b21-0daf-4ef7-ae4c-b966d813553b',
               '77b32fdc-5551-4a33-a4ab-e7ab773172a1'
             )
          or member_b_id in (
               'b9786b21-0daf-4ef7-ae4c-b966d813553b',
               '77b32fdc-5551-4a33-a4ab-e7ab773172a1'
             )
    loop
      raise notice 'unexpected rel: id=% type=% a=% b=%', r.id, r.type, r.member_a_id, r.member_b_id;
    end loop;
    delete from public.relationships
     where member_a_id in (
             'b9786b21-0daf-4ef7-ae4c-b966d813553b',
             '77b32fdc-5551-4a33-a4ab-e7ab773172a1'
           )
        or member_b_id in (
             'b9786b21-0daf-4ef7-ae4c-b966d813553b',
             '77b32fdc-5551-4a33-a4ab-e7ab773172a1'
           );
  end if;

  delete from public.members
   where id in (
           'b9786b21-0daf-4ef7-ae4c-b966d813553b',  -- סבא אדלר
           '77b32fdc-5551-4a33-a4ab-e7ab773172a1'   -- ילד 1
         );
  get diagnostics member_count = row_count;
  raise notice '── deleted % placeholder member(s) ──', member_count;
end$$;
