-- The words a suggestion row and a pending ask carry (DESIGN §5.1): the
-- attributes the caller and one other person agree on AGAINST THE GRAIN.
--
-- A join of `ratings` against `ratings`, weighted by the caller's own feed:
-- one statement, computed on request and stored nowhere.
--
-- **`public`, not `private`, and that is not the hazard it looks like.**
-- PostgREST serves only the schemas config.toml names and `private` is
-- deliberately not one of them, so a function there cannot be called by the
-- client that has to call it. Schema isolation therefore does none of the work
-- here: the exact key, the caller check and the revoke below are the whole of
-- it, which is the same shape `public.find_by_username` has.

-- `1 − r·s_u(i,t)` summed per tag over the pairs the two of you rated the same
-- way, top three, ties alphabetical.
--
-- `s_u(i,t)` is the caller's OWN reach-weighted tag score, read out of their
-- `user_recs.entries` — the feed they may already read, so nothing here
-- discloses a number that was not already theirs. A tag missing from `entries`
-- is a pair with no score at all (`W_u(i,t) < W_min`), and the join drops it:
-- there is no grain to go against, so there is nothing to measure. Both of you
-- liking the coffee where everyone around you likes the coffee contributes
-- exactly zero and is never a chip; a person with a great deal in common in the
-- ordinary way can therefore come back with nothing, which is the definition
-- working rather than a bug to paper over.
--
-- It answers for two kinds of person and returns an EMPTY ARRAY for everyone
-- else — not an error, which would separate "nothing in common" from "not
-- allowed to ask". Both are the other person's own explicit act (they sent the
-- ask, or they turned discoverability on and were suggested), which is what
-- stops this being aimed at a chosen target: an outgoing ask of your own yields
-- you nothing (DESIGN §5.1).
create function public.shared_attributes(p_other uuid) returns text[]
  language sql stable security definer set search_path = ''
as $$
  with allowed as (
    select 1
    where p_other is not null
      and p_other <> (select auth.uid())
      and (private.has_incoming_request_from(p_other)
           or private.is_suggested_to_me(p_other))
  ),
  -- The grain: one row per (item, attribute) the caller's own feed scores.
  grain as (
    select entry.value ->> 'itemId' as item_id,
           tag.key                  as tag,
           tag.value::double precision as score
      from public.user_recs recs
      cross join lateral jsonb_array_elements(recs.entries) as entry
      cross join lateral jsonb_each_text(entry.value -> 'tags') as tag
     where recs.user_id = (select auth.uid())
       and exists (select 1 from allowed)
  ),
  -- Every attribute of a thing the two of you answered the SAME way. The item
  -- itself is not one: `tag = ''` is the thing, and a chip names an attribute.
  agreed as (
    select mine.item_id, mine.tag, mine.value
      from public.ratings mine
      join public.ratings theirs
        on theirs.user_id = p_other
       and theirs.item_id = mine.item_id
       and theirs.tag = mine.tag
       and theirs.value = mine.value
     where mine.user_id = (select auth.uid())
       and mine.tag <> ''
       and exists (select 1 from allowed)
  )
  select coalesce(array_agg(tag order by deviation desc, tag), '{}'::text[])
    from (
      select agreed.tag,
             sum(1 - agreed.value * grain.score) as deviation
        from agreed
        join grain
          on grain.item_id = agreed.item_id
         and grain.tag = agreed.tag
       group by agreed.tag
        -- Agreement that goes WITH the network sums to zero and is not a chip.
        -- Without this an account whose every shared answer is the consensus
        -- one shows three of them, which is the opposite of what the rule says.
      having sum(1 - agreed.value * grain.score) > 0
       order by deviation desc, agreed.tag
       limit 3
    ) top;
$$;

revoke all on function public.shared_attributes(uuid) from public, anon, authenticated;
grant execute on function public.shared_attributes(uuid) to authenticated;
