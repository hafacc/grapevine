-- Following is one-way, and no client writes a follow directly. A row comes
-- from one of three functions, each of which says why the caller may follow
-- that account: they hold its link, it already follows them, or it is a
-- prefilled account. Either end may delete the row. What a locked account may
-- do is 15_invite_only's, and what a follow lets you read is
-- 24_followed_thumbs'.

begin;
select plan(49);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.com', now()),
  ('22222222-2222-2222-2222-222222222222', 'b@example.com', now()),
  ('33333333-3333-3333-3333-333333333333', 'c@example.com', now());
create or replace function private.is_unlocked(p_user uuid) returns boolean
  language sql as $$ select true $$;  -- the lock is 15_invite_only's to test
update public.profiles set display_name = 'A' where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set display_name = 'B' where id = '22222222-2222-2222-2222-222222222222';
insert into public.profiles (id, display_name, prefilled, handle) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'A Critic', true, 'critic');
insert into public.invite_links (owner_id, token) values
  ('11111111-1111-1111-1111-111111111111', 'TokenOfATokenOfATokenOfATokenOfATokenOfATok'),
  ('22222222-2222-2222-2222-222222222222', 'TokenOfBTokenOfBTokenOfBTokenOfBTokenOfBTok');

select throws_ok(
  $$insert into public.follows (follower_id, followed_id)
    values ('11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111')$$,
  '23514', null, 'nobody follows themselves, whoever writes the row');

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- No direct write.
select throws_ok(
  $$insert into public.follows (follower_id, followed_id)
    values ((select auth.uid()), '11111111-1111-1111-1111-111111111111')$$,
  '42501', null, 'a client cannot insert a follow, its own included');
select throws_ok(
  $$insert into public.follows (follower_id, followed_id)
    values ('11111111-1111-1111-1111-111111111111', (select auth.uid()))$$,
  '42501', null, 'or make somebody follow it');
select throws_ok(
  $$update public.follows set followed_id = '33333333-3333-3333-3333-333333333333'$$,
  '42501', null, 'or re-point one');

-- By link: one row, the redeemer's.
select is(
  public.redeem_invite('TokenOfATokenOfATokenOfATokenOfATokenOfATok'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'B redeems A''s link');
select is(
  (select string_agg(follower_id || '>' || followed_id, ',') from public.follows),
  '22222222-2222-2222-2222-222222222222>11111111-1111-1111-1111-111111111111',
  'B follows A, and A does not follow B');
select is(
  (select display_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'A', 'the follower reads the followed account''s name');

-- The read policy: a row you are named in, at either end.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select follower_id from public.follows where followed_id = (select auth.uid())),
  '22222222-2222-2222-2222-222222222222'::uuid, 'the followed account sees who follows it');
select is(
  (select display_name from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  'B', 'and that follower''s name');
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is((select count(*)::int from public.follows), 0,
  'somebody at neither end sees no follow');

-- Following back.
select throws_ok(
  $$select public.follow_back('11111111-1111-1111-1111-111111111111')$$,
  '42501', 'not somebody you can follow',
  'knowing a uuid is not a way to follow: A does not follow C');
select throws_ok(
  $$select public.follow_back('99999999-9999-9999-9999-999999999999')$$,
  '42501', 'not somebody you can follow',
  'and a uuid that names nobody is refused in the same words, so the answer says nothing');
select throws_ok(
  $$select public.follow_back((select auth.uid()))$$,
  '42501', 'not somebody you can follow', 'as is the caller''s own');
select throws_ok(
  $$select public.follow_back(null)$$,
  '42501', 'not somebody you can follow', 'and a null');
set local role postgres;
select is(
  (select count(*)::int from private.write_budget
    where user_id = '33333333-3333-3333-3333-333333333333'),
  0, 'a refused follow spends nothing, since the refusal rolls the spend back');
select is((select count(*)::int from public.follows), 1, 'and writes nothing');
set local role authenticated;

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  $$select public.follow_back('22222222-2222-2222-2222-222222222222')$$,
  'A follows back somebody who follows A');
select lives_ok(
  $$select public.follow_back('22222222-2222-2222-2222-222222222222')$$,
  'and doing it again is harmless');
select is((select count(*)::int from public.follows), 2, 'there is one row each way');
set local role postgres;
select is(
  (select writes from private.write_budget
    where user_id = '11111111-1111-1111-1111-111111111111'),
  2, 'each call spent a write');
update private.write_budget set writes = private.daily_write_limit()
 where user_id = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
select throws_ok(
  $$select public.follow_back('22222222-2222-2222-2222-222222222222')$$, 'PT429', null,
  'and past the day''s budget a follow is refused like any other write');
select throws_ok(
  $$select public.follow_prefilled('cccccccc-cccc-cccc-cccc-cccccccccccc')$$, 'PT429', null,
  'of either kind');

-- Following a prefilled account.
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select lives_ok(
  $$select public.follow_prefilled('cccccccc-cccc-cccc-cccc-cccccccccccc')$$,
  'anyone unlocked follows a prefilled account');
select lives_ok(
  $$select public.follow_prefilled('cccccccc-cccc-cccc-cccc-cccccccccccc')$$,
  'twice, harmlessly');
select is(
  (select string_agg(follower_id || '>' || followed_id, ',') from public.follows),
  '33333333-3333-3333-3333-333333333333>cccccccc-cccc-cccc-cccc-cccccccccccc',
  'which is one row, and the only one C sees');
select throws_ok(
  $$select public.follow_prefilled('11111111-1111-1111-1111-111111111111')$$,
  '42501', 'not somebody you can follow', 'a person cannot be followed that way');
select throws_ok(
  $$select public.follow_prefilled('99999999-9999-9999-9999-999999999999')$$,
  '42501', 'not somebody you can follow', 'and nor can nobody, in the same words');
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select count(*)::int from public.follows
    where followed_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  0, 'who follows a prefilled account is nobody else''s to read');

-- Signed out, and signed in as nobody.
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$select public.follow_back('22222222-2222-2222-2222-222222222222')$$, '42501', null,
  'signed out, nobody follows back');
select throws_ok(
  $$select public.follow_prefilled('cccccccc-cccc-cccc-cccc-cccccccccccc')$$, '42501', null,
  'or follows a prefilled account');
select throws_ok($$select count(*) from public.follows$$, '42501', null,
  'or reads a follow');
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';
select throws_ok(
  $$select public.follow_prefilled('cccccccc-cccc-cccc-cccc-cccccccccccc')$$, '42501', null,
  'and a session that names no account follows nobody');

-- Deleting, from each end and from neither.
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select lives_ok(
  $$delete from public.follows
     where follower_id = '22222222-2222-2222-2222-222222222222'$$,
  'a stranger''s delete of somebody else''s follow runs');
set local role postgres;
select is((select count(*)::int from public.follows), 3, 'and removes nothing');
set local role authenticated;

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
delete from public.follows
 where follower_id = (select auth.uid()) and followed_id = '11111111-1111-1111-1111-111111111111';
select is(
  (select string_agg(follower_id || '>' || followed_id, ',') from public.follows),
  '11111111-1111-1111-1111-111111111111>22222222-2222-2222-2222-222222222222',
  'the follower unfollows, and the follow the other way stays');
select is(
  (select count(*)::int from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  1, 'so the two still read each other''s names');
delete from public.follows
 where follower_id = '11111111-1111-1111-1111-111111111111' and followed_id = (select auth.uid());
select is((select count(*)::int from public.follows), 0,
  'the followed account removes a follower');
select is(
  (select count(*)::int from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  0, 'and with no follow either way, neither reads the other');

-- Removing a follower replaces the remover's link, so the person removed
-- cannot walk back in with the one they were given. Only then.
select isnt((select token from public.invite_links),
            'TokenOfBTokenOfBTokenOfBTokenOfBTokenOfBTok',
  'removing a follower replaces the link of the account that removed them');
select ok((select token ~ '^[A-Za-z0-9_-]{43}$' from public.invite_links),
  'with a token of the usual shape, still one link');
select is(
  (select count(*)::int from public.invite_owner('TokenOfBTokenOfBTokenOfBTokenOfBTokenOfBTok')),
  0, 'the old token names nobody');
select is(
  (select display_name from public.invite_owner((select token from public.invite_links))),
  'B', 'and the new one names its owner');
set local role postgres;
delete from private.write_budget where user_id = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(public.redeem_invite('TokenOfBTokenOfBTokenOfBTokenOfBTokenOfBTok'), null,
  'so the person removed redeems nothing with it');
select is((select token from public.invite_links),
          'TokenOfATokenOfATokenOfATokenOfATokenOfATok',
  'the link of an account whose follower unfollowed, and of the follower removed, is untouched');
set local role postgres;
select is(
  (select coalesce(sum(writes), 0)::int from private.write_budget
    where user_id = '22222222-2222-2222-2222-222222222222'),
  1, 'replacing it spent no write: B''s one is the redeem at the top');

-- Not when a connection with no request identity deletes the row.
set local request.jwt.claims = '';
create temporary table b_token as
  select token from public.invite_links where owner_id = '22222222-2222-2222-2222-222222222222';
insert into public.follows (follower_id, followed_id) values
  ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222');
delete from public.follows where followed_id = '22222222-2222-2222-2222-222222222222';
select is(
  (select token from public.invite_links where owner_id = '22222222-2222-2222-2222-222222222222'),
  (select token from b_token), 'a follow deleted by the owner of the database replaces no link');
-- Nor when somebody else is the caller: C deleting its own follow of B.
insert into public.follows (follower_id, followed_id) values
  ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222');
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
delete from public.follows where followed_id = '22222222-2222-2222-2222-222222222222';
set local role postgres;
select is(
  (select token from public.invite_links where owner_id = '22222222-2222-2222-2222-222222222222'),
  (select token from b_token), 'nor does a follower unfollowing');

set local role postgres;
select is(
  (select count(*)::int from pg_trigger
    where tgrelid = 'public.follows'::regclass and not tgisinternal
      and tgname <> 'follows_revoke_link_if_locked'),
  0, 'nothing makes a follow mutual: the one trigger on the table revokes or replaces a link');
select ok(
  not has_function_privilege('anon', 'public.follow_back(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.follow_prefilled(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.redeem_invite(text)', 'execute')
  and has_function_privilege('authenticated', 'public.follow_back(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.follow_prefilled(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.redeem_invite(text)', 'execute'),
  'the three ways to follow are a signed-in account''s, and nobody else''s');

select * from finish();
rollback;
