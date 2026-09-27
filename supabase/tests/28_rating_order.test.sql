-- The one bit about time the recompute reads (DESIGN §2.3, 0015): a rating in
-- the neighbourhood comes back doubled when it was given after the viewer's own
-- thumb on the same thing, and plain otherwise — before it, or on something the
-- viewer never rated. Never a clock.

begin;
select plan(4);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'viewer@example.com', now()),
  ('22222222-2222-2222-2222-222222222222', 'friend@example.com', now());
create or replace function private.is_unlocked(p_user uuid) returns boolean
  language sql as $$ select true $$;  -- the lock (0010) is 23's to test

insert into public.friendships (user_id, friend_id) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'),
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');

insert into public.ratings (user_id, item_id, tag, value, rated_at) values
  ('11111111-1111-1111-1111-111111111111', 'early', '',      1, '2026-01-02'),
  ('11111111-1111-1111-1111-111111111111', 'late',  '',      1, '2026-01-02'),
  ('11111111-1111-1111-1111-111111111111', 'late',  'quiet', 1, '2026-01-02'),
  ('22222222-2222-2222-2222-222222222222', 'early', '',     -1, '2026-01-01'),
  ('22222222-2222-2222-2222-222222222222', 'late',  '',     -1, '2026-01-03'),
  ('22222222-2222-2222-2222-222222222222', 'late',  'quiet', 1, '2026-01-03'),
  ('22222222-2222-2222-2222-222222222222', 'only',  '',      1, '2026-01-03');

select is(
  (select ratings from private.neighbourhood('11111111-1111-1111-1111-111111111111')
    where id = '22222222-2222-2222-2222-222222222222'),
  '{"early": {"": -1}, "late": {"": -2, "quiet": 2}, "only": {"": 1}}'::jsonb,
  'a thumb given after the viewer''s own on the same thing comes back doubled');
select is(
  (select ratings from private.neighbourhood('11111111-1111-1111-1111-111111111111')
    where id = '11111111-1111-1111-1111-111111111111'),
  '{"early": {"": 1}, "late": {"": 1, "quiet": 1}}'::jsonb,
  'the viewer''s own thumbs are never after themselves');
select is(
  (select ratings from private.load_nodes('11111111-1111-1111-1111-111111111111',
     array['22222222-2222-2222-2222-222222222222']::uuid[])),
  '{"early": {"": -1}, "late": {"": -2, "quiet": 2}, "only": {"": 1}}'::jsonb,
  'and the boundary rounds say the same');
select is(
  (select ratings from private.neighbourhood('22222222-2222-2222-2222-222222222222')
    where id = '11111111-1111-1111-1111-111111111111'),
  '{"early": {"": 2}, "late": {"": 1, "quiet": 1}}'::jsonb,
  'which is relative to whoever asks');

select * from finish();
rollback;
