-- ============================================================
--  Drop In — realtime signalling authorisation
--
--  Drop In stores nothing in Postgres. It uses one Supabase
--  realtime channel as a pipe: the two devices announce
--  themselves on it and swap the ~4 KB WebRTC handshake, then
--  talk directly to each other. No table, no rows, no video.
--
--  What this file is for: that channel is a *private* channel,
--  and private channels are authorised by row-level security on
--  realtime.messages. Without the policies below, joining
--  `dropin-signal` is refused outright. With them, only the
--  household account can join — which matters, because the anon
--  key in config.js is public by design and on a public channel
--  anyone holding it could listen to the handshake and ask the
--  camera for a stream.
--
--  Safe to re-run. Paste into Supabase → SQL Editor → Run.
--  Adding policies here cannot affect the calendar: policies are
--  additive, and the calendar uses postgres_changes, not this.
-- ============================================================

-- Supabase ships realtime.messages with RLS already on. This is only
-- here for a project where it somehow isn't, and is allowed to fail
-- quietly if the SQL editor's role doesn't own the table.
do $$
begin
  execute 'alter table realtime.messages enable row level security';
exception when others then
  raise notice 'realtime.messages RLS left as-is (%).', sqlerrm;
end $$;

-- ── who is allowed on the channel ─────────────────────────
-- Auth is shared across a whole Supabase project, so "is logged in" is
-- NOT a sufficient test — any user of any other app in this project
-- would pass it. Both policies require this exact account, the same one
-- the calendar uses. To point Drop In at a different account later,
-- change the address in both places and re-run.
--
-- The topic test keeps the grant narrow: it authorises the `dropin-`
-- channels and nothing else on realtime.messages.

drop policy if exists dropin_household_read on realtime.messages;
create policy dropin_household_read
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.topic() like 'dropin-%'
    and coalesce(auth.jwt() ->> 'email', '') = 'family@jonescalendar.local'
  );

drop policy if exists dropin_household_write on realtime.messages;
create policy dropin_household_write
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.topic() like 'dropin-%'
    and coalesce(auth.jwt() ->> 'email', '') = 'family@jonescalendar.local'
  );

-- ── check ─────────────────────────────────────────────────
-- Should list the two policies above.
select policyname, cmd
from pg_policies
where schemaname = 'realtime' and tablename = 'messages'
order by policyname;
