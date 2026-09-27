-- Friends by link (0009). Each person has at most one link, with no expiry and
-- no limit on uses. Its token is a bearer secret: whoever holds it sees the
-- owner's name and photo, and can become the owner's friend. The owner reads
-- their own token back at any time, replaces it (the old one stops working) or
-- turns it off; nobody else reads any token, and every lookup takes the exact
-- one. Turning a link on, replacing it and redeeming one spend the write
-- budget.

begin;
select plan(35);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com',    now()),
  ('22222222-2222-2222-2222-222222222222', 'guest@example.com',    now()),
  ('33333333-3333-3333-3333-333333333333', 'stranger@example.com', now()),
  ('44444444-4444-4444-4444-444444444444', 'spender@example.com',  now());
create or replace function private.is_unlocked(p_user uuid) returns boolean
  language sql as $$ select true $$;  -- the lock (0010) is 23's to test

update public.profiles set display_name = 'Owner', photo_url = 'https://example.com/o.png'
  where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set display_name = 'Guest'    where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set display_name = 'Stranger' where id = '33333333-3333-3333-3333-333333333333';

-- Tokens carried between roles.
create temporary table made (label text primary key, token text);
grant all on made to authenticated, anon;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into made values ('first', public.set_invite_link());

select ok(
  (select token ~ '^[A-Za-z0-9_-]{43}$' from made where label = 'first'),
  'a token is 43 characters of unpadded base64url');
select is(
  (select token from public.invite_links),
  (select token from made where label = 'first'),
  'the owner reads their own link back');
select is(
  (select count(*)::int from public.invite_links), 1, 'and has exactly one');

-- A stranger: sees no link, and naming one in a filter finds nothing.
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is((select count(*)::int from public.invite_links), 0,
  'a stranger reads nobody''s link');
select is(
  (select count(*)::int from public.invite_links
    where token = (select token from made where label = 'first')),
  0, 'not even by naming its token');
select throws_ok(
  $$select owner_id from public.invite_links$$, '42501', null,
  'and whose a link is is not a column anyone may read');
select throws_ok(
  $$insert into public.invite_links (owner_id, token)
    values ((select auth.uid()), 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,
  '42501', null, 'nobody plants a token of their choosing');
select throws_ok(
  $$update public.invite_links set token = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'$$,
  '42501', null, 'or rewrites one');
select lives_ok(
  $$delete from public.invite_links$$, 'a stranger''s delete runs');
set local role postgres;
select is((select count(*)::int from public.invite_links), 1,
  'and removes nobody''s link');

-- Whose link it is, by the exact token, signed out as well as in.
set local role anon;
select is(
  (select display_name || ' ' || photo_url
     from public.invite_owner((select token from made where label = 'first'))),
  'Owner https://example.com/o.png', 'signed out, the link names its owner and shows the photo');
select is(
  (select count(*)::int from public.invite_owner('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
  0, 'a token that matches nothing names nobody');
select is(
  (select count(*)::int from public.invite_owner(
     left((select token from made where label = 'first'), 42))),
  0, 'nor does a prefix of a real one');
select is((select count(*)::int from public.invite_owner(null)), 0, 'nor a null');
select throws_ok(
  $$select public.redeem_invite('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$, '42501', null,
  'signed out, a link can be looked at and not used');
select throws_ok(
  $$select public.set_invite_link()$$, '42501', null, 'or made');
select throws_ok(
  $$select count(*) from public.invite_links$$, '42501', null,
  'and the table is not readable at all');
set local role authenticated;

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  public.redeem_invite((select token from made where label = 'first')),
  '11111111-1111-1111-1111-111111111111'::uuid, 'redeeming answers with the owner');
select is(
  (select count(*)::int from public.friendships
    where user_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')
      and friend_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')),
  2, 'and makes both halves of the friendship');
select lives_ok(
  $$select public.redeem_invite((select token from made where label = 'first'))$$,
  'redeeming again as a friend is harmless');

-- The link works for anybody who holds it, as often as it is used.
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is(
  public.redeem_invite((select token from made where label = 'first')),
  '11111111-1111-1111-1111-111111111111'::uuid, 'a second person can use the same link');

-- The owner's own link writes nothing.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  public.redeem_invite((select token from made where label = 'first')),
  '11111111-1111-1111-1111-111111111111'::uuid, 'your own link answers with you');
select is(
  (select count(*)::int from public.friendships
    where user_id = '11111111-1111-1111-1111-111111111111'
      and friend_id = '11111111-1111-1111-1111-111111111111'),
  0, 'and makes no friendship with yourself');

-- Replacing: a new token, the old one dead, still one row.
insert into made values ('second', public.set_invite_link());
select isnt(
  (select token from made where label = 'second'),
  (select token from made where label = 'first'), 'replacing makes a new token');
select is(
  (select token from public.invite_links),
  (select token from made where label = 'second'), 'which is the one the owner reads back');
select is((select count(*)::int from public.invite_links), 1, 'still one link');
set local role anon;
select is(
  (select count(*)::int from public.invite_owner((select token from made where label = 'first'))),
  0, 'the old token names nobody');
set local role authenticated;

set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select is(
  public.redeem_invite((select token from made where label = 'first')), null,
  'and redeems nothing');

-- Turning it off.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
delete from public.invite_links;
select is((select count(*)::int from public.invite_links), 0, 'turning the link off deletes it');
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select is(
  public.redeem_invite((select token from made where label = 'second')), null,
  'after which it redeems nothing');
set local role postgres;
select is(
  (select count(*)::int from public.friendships
    where user_id = '11111111-1111-1111-1111-111111111111'),
  2, 'and the friends it already made stay friends');

-- The budget. Parked two short of the limit.
insert into private.write_budget (user_id, day, writes) values
  ('44444444-4444-4444-4444-444444444444', (now() at time zone 'utc')::date,
   private.daily_write_limit() - 2)
on conflict (user_id, day) do update set writes = excluded.writes;
set local role authenticated;
select lives_ok($$select public.set_invite_link()$$, 'turning a link on spends one write');
select lives_ok($$select public.set_invite_link()$$,
  'replacing it spends one more, not two, so it reaches the limit exactly');
select throws_ok($$select public.set_invite_link()$$, 'PT429', null,
  'and replacing it past the limit is refused');
select throws_ok(
  $$select public.redeem_invite('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$, 'PT429', null,
  'and so is a redeem, even one that would match nothing');

select * from finish();
rollback;
