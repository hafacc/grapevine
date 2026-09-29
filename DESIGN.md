# grapevine — design

Recommendations through the grapevine. You rate things (and attributes of things) with a
thumbs up or down; you get back a personal ranking of things built from your own ratings and
the ratings of your extended friend network, weighted by how much each person's taste has
turned out to predict yours. Nothing is absolute: every user sees their own view of the world,
and nobody is ever shown who rated what.

This file is the source of truth for *what* is built and *why*. `CLAUDE.md` says how to run it
and check it.

## 1. Product

### Objects

- **Item** ("thing"): anything with a name. A restaurant, a movie, a book, a hiking trail, a
  brand of olive oil. An item **is** its name, normalized: lower case, NFKC, whitespace runs
  collapsed to one space, trimmed. `"Café Bleu"`, `"café bleu"` and `"CAFÉ  Bleu"` are one
  item, and that item is `café bleu` — the accent and the space are part of the id, not folded
  out of it. Duplicates cannot be created, only found. Items are a shared catalog: anyone
  signed in can create one and anyone can see that it exists. Creation is not attributed in the
  UI.

  **There is no separate display name.** The id is the text, and the text is what every screen
  shows. What that gives up is the creator's capitalisation — whoever adds it typing
  `"Café Bleu"` gets `café bleu` back — and giving it up is the point: everything user-facing
  is lower case anyway (§1 "The one view"), so a stored capital would be a spelling no screen
  honours, plus a second field to keep in step with the key. §3.2 says what the folding refuses
  and what it costs.
- **Tag** (the UI calls it an **attribute**): an arbitrary string attached to an item by rating
  it. `restaurant`, `cheap`, `casual`, `action`, `late night`. There is one namespace: a
  "category" like `restaurant` and an "attribute" like `cheap` are the same kind of thing. That
  keeps the model and the UI to a single mechanism, and lets categories be as arbitrary as
  attributes. (A fixed, curated set of top-level kinds would be an additive change: a `kind`
  field on items, plus a fixed tag vocabulary that the UI suggests first.)

  A tag is an id under exactly the same rule, at the same cap, and nothing else: `late night`
  is the tag, with its space, and `"Late Night"` lands on it. There is no `tags` table and no
  tag display name, for the same reason an item has none.
- **Ratable**: the unit that receives a thumb. Either an item `i` ("is this good?") or an
  item–tag pair `(i, t)` ("does this item have this tag?"). Both take exactly one of
  `+1` / `-1` per user, changeable at any time, removable. A pair is **two fields**, never one
  joined string (§3.2).
- **Rating**: `(user, item, tag) -> +1 | -1`, with an empty `tag` meaning the thing itself.
  Private to the user who made it. Only the server-side feed recompute (§3.4) reads other
  people's ratings.
- **Friend edge**: mutual. Made by a **link** one person hands another off the platform —
  a message, a chat, in person — and the other opening it and saying yes (§1 item 6), and by
  nothing else. There are no handles and nobody is found by typing anything. Your friend list is visible only to you.
- **Display name**: what a person is called, and the only thing that says who they are. It
  defaults to the first name Google gives (`given_name`, else the first word of the full
  name), is editable at any time, and may be anything up to 50 characters except a control
  character or a bidirectional mark or override, which would reverse the line it is drawn in.
  Nobody is found by it, so it needs to be neither unique nor stable.

### The one view

**There are no tabs.** The app is one screen: a list of things, with a search field pinned to
the bottom where a thumb already is. Everything else is a layer over that list, and the two
things that are not the list — a thing, and the people — are reached by opening a row and by
the avatar in the corner. Everything user-facing is lower case.

1. **The list.** With the field empty it is the viewer's feed, ranked by what its bars draw ("The
   bar" below), plus everything the viewer has rated, which the feed may not carry — with no friends
   it carries none of it (a thing nothing in reach has scored sorts as zero). Typing filters the
   feed by an item's name **and** by its attributes, fuzzy-matched, so a misspelling finds the thing
   that already exists rather than offering to make a second one. Several words each read as the
   name or an attribute and rank by how well the thing has them all; `!` puts the low-rated first,
   `@` looks at names only and `#` at attributes only ("Search" below). A row carries the name, its
   attribute chips, and one bar. The bar belongs to **whatever matched**: an attribute match shows
   that attribute's score for this viewer, a name match the item's own. That is the whole answer
   to "why is this here", and it is an answer about the viewer's own model of a word, never about
   a person (§4).
2. **Adding is part of searching.** Above the field, quiet and dashed, sits *add "&lt;what you
   typed&gt;"* — available the whole time there is a query, not only when nothing matched,
   because identity is by folded name and an add that collides is a find. Tapping it opens the
   thing **provisionally**; nothing is written until the viewer rates it or gives it an
   attribute, so a name typed and abandoned never enters the shared catalog.

   **The tap looks the name up first.** The browser asks English Wikipedia and Photon,
   komoot's search of OpenStreetMap, directly, never while typing, with 1.5 s to answer.
   Wikipedia is asked twice at once, and the answers interleaved without repeats: its
   full-text search finds the typed words anywhere in a title, and its search box's completion
   forgives a typo and a half-typed last word and reports the redirect a page was reached by;
   either alone misses what the other finds. A match is kept only when every typed word is
   found in its name, its one-line description or, for Wikipedia, a redirect to it —
   forgiving a typo for Wikipedia, whole words only for places, whose search returns far-off
   look-alikes — with punctuation read both as a break and as nothing, so `moby dick` finds
   *moby-dick* and `joes` finds *joe's*.

   **Only a kind of thing somebody would say yes or no to is offered.** Wikipedia's search
   returns landforms, people, lists, events and ideas as readily as a film, and a pick is a
   link that outlives the tap. So, inside the same 1.5 s, Wikidata is asked what the (at most
   ten) kept Wikipedia matches are, and a match is offered only when its "instance of" is on
   an allow-list (`RATEABLE_INSTANCE` in `shared/src/references.ts`): a book, film, series,
   album, song, play, game, app, website or painting; a brand, company or chain; a restaurant,
   café, bar, shop, museum, park, hotel, venue or landmark; a band. A food, a drink or a
   product model is usually a class of its own on Wikidata — pizza is a subclass of food, not an
   instance of it — so for those "subclass of" counts too (`RATEABLE_CLASS`); not for a kind of
   place, whose subclasses are kinds and not places. A person is offered only as a performer
   (a singer, a musician, a comedian), whose own performing is what is rated; an author, a
   director or an actor is rated through their work. A match whose kind could not be read is
   not offered. Places get the same treatment from OpenStreetMap's own tags, with no second
   request: somewhere to eat, drink, shop, stay, see or play (`RATEABLE_PLACE`); a village, a
   street, a peak or a building with no use named is not. Adding the name as typed still
   works for everything the lists leave out.

   At most five, as one list under *is it one of these?* — up to three kept for Wikipedia and
   two for places before either fills the rest — then *none of these — add "…"*. While a place is among them, *© OpenStreetMap
   contributors*, linked to its copyright page, sits once under the rows: OSMF's [geocoding
   guideline](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Geocoding_-_Guideline)
   asks for attribution where the geocoder is used, and a result stored and shown later is an
   insubstantial extract that owes none, so nothing else carries it. Wikipedia's rows carry
   no credit line.
   Nothing good, lookups off, offline or too slow, and add works as above. A match's name is
   the index's title folded by the name rules (`™ ® ©` and a `#` at a word's start dropped; a
   title the rules refuse is not offered), and a place's carries where it is: *joe's pizza
   (university village, new york)*, then the street if another link holds that. Picking one
   whose link a thing already holds opens that thing; a free name opens provisionally and
   writes its link after the thing, on the first thumb; a name that is here without a link
   asks *is "…" this?* first, and a yes writes the link at once, since the thing exists and
   may already be rated; that is the only way a plain name gains a link. The link's id
   is stored, never its description or position (§3.2 `item_refs`). Two settings on the
   people screen, both on and remembered per device, each a one-line row that says what is so
   and swipes to change it: *lookups are on*, and *lookups use your location*, which sends
   Photon a position rounded to about a kilometre so the nearest branch comes first, the
   browser asking the first time. The second is gone while lookups are off, since it would
   change nothing.
3. **Rating is a swipe, and on mobile it is the only way to rate.** Right is yes, left is no.
   Swiping the way you already voted **clears** that rating, and the reveal behind the row says
   so — it turns grey with a minus rather than green or red. Swiping the other way flips
   straight over, with no clear in between. The row moves horizontally and does nothing else:
   no rotation, no vertical travel. This is a choice between two sides, not a card being
   thrown away, and the borrowed card-deck motion would say the opposite. **There are no thumb
   buttons anywhere on mobile.** A rated row keeps its bar and tints its background, green for
   yes and red for no.
4. **A thing.** Opening a row replaces the list with the thing's own screen, drawn the same
   way. Its title bar carries a back button, the name, the item's own bar and the avatar, and
   **is** the item's rating
   control: swiping the title bar rates the item, and only that bar takes the tint. Below it
   each attribute is a plain row — name, its own bar — rated on its own by the same swipe.
   Attributes are ordered **most uncertain first**, which on §2.6's `−1..1` scale is
   `|s_u(i,t)|` ascending: the answers worth most are the ones the viewer's network has least
   to say about. The screen's search field filters the attribute list and offers *add
   attribute* while typing, in the same place the list's add button sits. An eye beside the
   field hides the attributes the viewer has already answered; the icon itself changes — open
   eye, crossed-out eye — rather than only its colour, because a toggle whose only state is a
   tint is unreadable to anyone who cannot see the tint. The same toggle in the feed hides
   things the viewer has rated. At the end of the attribute list a row of dashed chips
   proposes attributes to apply (§2.11) under the heading *suggested*, which claims nothing
   about who: "people like you use this" is an attribution and §4 forbids it. Last, for a
   name the catalog or the feed holds, a quiet *report this name* line (§4 "Item names"),
   which asks first and then says *reported*. A thing with a link carries it in its title
   bar, an outward-arrow icon before the bar named *open on wikipedia* or *open on
   openstreetmap*, built from the id; no credit goes with it (item 2 says why). A wrong link
   is taken off by the owner, by hand (§4); nothing on the screen does it.

   The attribute list on a thing contains only attributes somebody has **rated**. A chip the
   viewer taps but never thumbs creates nothing — it is provisional on the client and never
   reaches the server, so it vanishes when they leave the screen. An attribute that exists
   because one person typed it and walked away is not a thing anyone else can ever see.
5. **People, behind the avatar.** One screen, under a title bar of its own — a back button and
   *you and your vine*, no avatar, since this is where the avatar leads — in this order.
   First the viewer's own row — photo, name, the theme control and sign out on one line. The
   name is a button: a tap opens a sheet, *your name*, with the field, *what your vine
   sees. anything you like.*, and *save*. Beneath the row:
   - **The link row.** *your link is off* or *your link is on*, and nothing else: the link
     itself is never drawn. It swipes like any row, with words behind it rather than thumbs,
     since neither side is a rating: off, right is *turn on*; on, left is *turn off* and right
     is *new link*. On, it carries *copy* and, where the device has a share sheet, *share*
     (item 6).

   Then the two lookup settings (item 2), for an admin *names people reported* (§4), and the
   install row where the browser offers one — each of those two a whole row that is its
   action, tapped or swiped right, with no button on it — then friends under *your vine*: a photo and a name, no
   level of agreement, and no person page.
   **A friend's row swipes one way only**: left, revealing the word *remove* rather than a
   thumb, because no is the only answer a friendship takes here. It asks first — *remove
   &lt;name&gt; from your vine?*, *you'll no longer shape each other's lists. to undo it, one of you
   has to send a link.* — and on *remove* removes both rows. On desktop the row keeps
   only its left button.
   Below every section, last on the screen and hidden while the field filters, a quiet line
   reads *delete your account*, tinted the red of a no-rated row. It opens a sheet saying what
   goes and what stays (§4), and its delete button stays disabled until the word *delete* is
   typed: the shared confirm confirms on Enter, and two taps in one place are one fumble.
6. **Making a friend is sending a link.** Each person has **at most one link** —
   `https://grapevine.hafa.cc/#/invite/<token>` — with no expiry and no limit on uses, managed
   from the link row (item 5). The link can be copied again at any time, from any device the
   owner signs in on. *new link*
   asks first — *make a new link?*, *the one you have stops working. people it added
   stay.* — and so does *turn off*. Neither unfriends anyone.

   A link is a **bearer secret** and works for anyone who holds it, as many times as it is
   opened, until its owner replaces it or turns it off. So one link can go to a group chat, and
   **a leaked link costs its owner exactly the friends it makes before it is replaced** — each
   one a direct friend, with everything §4 says a direct friend can learn, and either end can
   unfriend the other afterwards.

   Opening a link: the token lives in the fragment, which no browser sends to any server — not
   to the host's logs, not in a `Referer` — and which the OAuth return leaves alone, since GoTrue
   puts its `?code=` in the query. It is taken out of the address at once and kept in
   `sessionStorage` for the tab (it is not a screen; the address becomes the list), so it
   survives the trip to Google. Signed out, the welcome screen shows the owner's photo,
   *sign in to add &lt;name&gt; to your vine*, the door as *continue with google*, and under it
   the line *your vine is a collection of people you trust to recommend honestly.* — the link
   is the authority to see its owner's name and photo, and nothing else. Once in, every
   account — new, locked, or with a vine already — is asked on one full screen: the owner's
   photo, *add &lt;name&gt; to your vine?*, *not now* or *add*, and under them the same line.
   An account whose vine is empty also reads, above the buttons, *if you decline, your account
   stays locked until you accept someone's link.* Saying yes is the consent, and
   asking before writing is what lets someone who opened a forwarded link, or opened it signed
   in to the wrong account, see whose it is and say no. A dead link — turned off, replaced,
   mangled or never made, which are not told apart — shows **nothing about anybody**: no name,
   no photo, since `invite_owner` answers nothing for it. It says *this link is invalid or
   expired* on the welcome screen, before any trip to Google, and *that link is invalid or
   expired* to somebody already signed in; either way it is then forgotten. A malformed token is
   answered that way without asking the server. Your own link says so; an existing friend says
   *&lt;name&gt; is already in your vine*.

   The page's search field filters the names already shown and reaches nobody past them: there
   is no browsing for people and no searching for them either, and no request to send. A link
   is the only way two people become friends.

   **A link is also the only way in** (§3.6). Signed out with no link, the welcome screen says
   nothing about the vine, the door reads *sign in*, and the line under it *grapevine is
   invite-only. ask someone for the link to their vine.*; the door stays, because people who
   have joined sign in there. An account that trusts nobody is locked; the question above,
   when it holds a live link, is how it unlocks. Otherwise, or on *not now*, it sees *your
   account is locked* and *it unlocks when you add someone to your vine with their link. ask
   someone for theirs.*, with *sign out* and *delete your account*. Removing the last person
   asks first: *they're the last person in your vine. your account will be locked until
   someone sends you a link.*
7. **The first list, and nothing to show.** Everyone but an admin arrives through a link, so
   their first list is already their vine's ratings. Over it, once per viewer on a device, sits
   one line: *this list comes from your vine. swipe right for yes, left for no.* (at desktop
   width, only the first sentence: the thumbs on the buttons say the rest), with a close
   button. Closing it or rating anything puts it away for good. It waits for a list with rows
   in it, because a gesture taught before there is anything to use it on teaches nothing.
   A list that is really empty — an admin with no vine, or a vine that has rated nothing yet —
   reads *nothing here yet. search to add something, or add people to your vine.* with an
   *add to your vine* button. When the eye has hidden every row there is, the list says
   *you've rated everything here. the eye shows it again.* instead.
8. **Desktop keeps the mobile layout** and replaces the swipe with a button set into each
   side of a row — no on the left, yes on the right — tinted the same soft green and red that
   a rated row gets, with the coloured glyph on top. The side matching the viewer's current
   rating goes grey with a minus, because pressing it clears. Thumbs are for rating only: on
   the link row and a friend's row the buttons carry the word for what they do (*turn on*,
   *turn off*, *new link*, *remove*). Desktop is otherwise
   **unpolished and deliberately deferred**: the column is centred and the rest is the phone —
   the whole phone, bars included, so a back button or the avatar sits at the column's edge and
   not the screen's.

### The bar

The one thing that shows a score, everywhere one is shown. Four segments in a row, filled from
the left — a value part-fills the segment it lands in rather than rounding to it. Red at or
below the midpoint, green above; the unlit track is grey **with an outline**, so the level is
countable rather than guessed against the background. There is no word beside it, anywhere
(the accessible label keeps one, because a bar with no text is nothing to a screen reader).

No numbers, ever: every one of §4's promises holds — no counts, no raters, no averages, no
attribution.

**The fill is one cautious value: high only when the score is high and much stands behind it.**
The feed keeps two numbers per thing, the score `s ∈ (−1, 1)` and the evidence `W` (§2.6: how many
of the viewer's own thumbs the evidence amounts to, at most one per person the viewer trusts
directly). The bar draws, and the list ranks by,

    c  =  s · W / (1 + W),        fill  =  (c + 1)/2

which is the posterior mean of a Beta on "you would like it" that holds `W` thumbs at rate
`(1 + s)/2` beside the Jeffreys prior's one pseudo-thumb (`α = ½ + W(1 + s)/2`, `β = ½ + W(1 − s)/2`),
mapped back to `−1..1`. A thing trusted people agree on draws near an end; a thing little stands
behind, or one they split on, draws near the middle. There is no step to round to and no floor
below which a thing is hidden. A thing with `W = 0` — carried into the feed only by an attribute of
it, whose own score is only the prior — draws as nothing known and sorts as zero. An attribute's bar
draws its score as it is, because its entry carries a score and no `W` (§3.2).

**Why the mean.** Caution here is symmetric: little evidence may neither lift a thing high nor
drive it to the bottom, so only much evidence moves it far from the middle in either direction.
The mean does exactly that — `|c| = |s| · W/(1 + W)`, the score shrunk toward the middle by the
share of it that is evidence — so a thing rises only with both a high `s` and a large `W`, and falls
only with both a low `s` and a large `W`. A confidence bound does not: "ranked high only with
evidence" reads as the lower side of how much you would like a thing, and a lower quantile of the
same Beta sits near the bottom for a thing with little behind it, drawing every thing nobody knows
as strongly *disliked* (an upper quantile fails the same way on the other side). `s` and `W` stay
separate in storage, so a different reading needs no recompute.

`web/DESIGN-UI.md` "The bar" is the component.

### Search

Built in `shared/src/search.ts` and `searchFeed` in `web/utils/discover.ts`; migration `0008`
reserves `!`, `@` and `#`.

**What is typed is free text.** Split on whitespace. A word may start with `!`, then `@` or
`#`:

- `x` finds a name or an attribute, high-rated first;
- `!x` finds the same, low-rated first — `!` excludes nothing, it turns the order over;
- `@x` finds names only, `#x` attributes only; `!@x` and `!#x` put the low-rated first.

That is the whole syntax: no quotes, no OR, no parentheses. Which words belong together —
`late night` one attribute or two words — is not syntax. A word with an operator starts a new
piece, which may run on over the plain words after it and takes that word's operators:
`@dune messiah` is one name.

**Any piece, any reading, any split.** The query is cut into pieces of one or more consecutive
words, and each piece independently reads as the thing's **name** (all of it, or some of its
words, or the start of one) or as one of its **attributes**. `hip work coffee` can be the two
attributes `hip work` and `coffee`, the three `hip`, `work`, `coffee`, or a thing of that name;
`starbucks quiet` is a name piece and an attribute piece, and finds every starbucks ranked by
how good and how quiet each is. Every row takes whichever split scores it highest.

**What a piece contributes, in `[0, 1]`.**

- **An attribute: its presence**, `(1 + s_u(i,t)) / 2`, or the viewer's own thumb as 1 or 0.
  §2.6's score is a shrunk estimate of the mean thumb, and a thumb is `±1`, so `(1 + s) / 2` is
  the estimated chance a rater says yes. No evidence shrinks `s` to 0, which lands exactly on
  one half, so **unknown is 0.5 without being chosen**: above "said not", below any yes.
- **The name: the thing's own presence**, the same mapping of the value its bar draws, `c`
  ("The bar"), or the viewer's thumb on it. A name piece says *this* thing; how good it is, with
  the evidence behind that, is what it adds.
- **A word that no reading on the row answers: 0.5**, the same unknown. A thing that lacks a
  word is lower, not gone. A word may be left unread only when nothing on the row reads it, or
  the best split would simply skip every "not".
- **Match quality discounts toward unknown**: `0.5 + w·(presence − 0.5)`. A match that is only
  `w` likely to be what was meant is, the rest of the time, no information — this is the
  expectation of the two. `w` is characters, not a constant per kind of match: of the stretch
  the piece landed on (the words it touched, for a name; the whole attribute, since an attribute
  is one concept), the share the typing confirmed. A whole word is 1; `cof` is half of `coffee`;
  `night` is half of `late night`; a typo confirms what was typed less its edits; scattered
  letters in order (kept so `bbmint` still finds `blue bottle, mint st`, and only from four
  letters, since three letters in order are in most names) confirm their own share of the text.
  Typos are allowed by length: none up to three characters, one up to six, two past that.

**A row's strength is the geometric mean per typed word**:

    strength  =  exp( Σ_pieces  words(piece) · ln contribution(piece)  /  words typed )

The product is the chance the thing is everything asked for, reading the pieces as independent.
It has to be normalized, or a split into more, shorter pieces multiplies more factors below one
and loses to a split into fewer, longer ones for no reason but the count. Normalizing **per
word** rather than per piece makes each typed word count once however it is grouped: a
per-piece mean would let a weak match that swallows two unknown words (one factor instead of two
halves) climb past an honest reading. It also makes strengths of the same query comparable across
rows that split it differently, which ranking needs. The best split is a dynamic programme over
split points (at most six words to a piece), maximizing the same sum — `6n` readings per row,
not `2^(n−1)` splits. Ties go to `conf` (known to your network first), then alphabetical.

**A thing is on the list** when any piece of the query reads on it — its name or an attribute
it carries — or when learned nearness (below) says it probably has a word. Nothing about the
strength is drawn.

**`!` flips a piece, and removes nothing.** A `!` piece is read exactly as it would be without
the `!` — the same name or attribute, the same typo tolerance, the same learned nearness — and
contributes `1 − contribution` instead. Unknown stays 0.5, so "leans no" ranks above unknown
and unknown above "leans yes". `@` and `#` only narrow which readings a piece may take: `@`
the name, `#` the attributes and what learned nearness reaches from them.

**`!`, `@` and `#` are reserved in names.** No id may have a word that starts with one
(`isNormalizedId`, and `private.is_normalized_id` by migration `0008`), so no name is ever
unsearchable by being read as an operator. `yahoo!`, `c#` and `panic! at the disco` stay legal.
`0008` refuses to apply if an existing row breaks the rule, because Postgres does not re-check
old rows when a CHECK's function changes and an id cannot be renamed.

**Learned nearness, from the viewer's own feed.** When no spelled reading answers a piece, an
attribute that moves with (or against) one it spells can:

    ρ(a,b)  =  Σ_i W(i)·s(i,a)·s(i,b)  /  ( κ_s + sqrt(Σ_i W(i)·s(i,a)² · Σ_i W(i)·s(i,b)²) )

over the things in the viewer's feed, each weighted by its certainty's evidence `W_u(i)` (§2.6)
and shrunk by `κ_s = 1`, the one pseudo-thumb that certainty starts from, so one co-occurrence is
a hint rather than a law. A cosine rather than a centred correlation, because 0 on §2.6's scale
already means "no lean": an attribute missing from a thing is that 0. The piece then contributes
`0.5 + w·ρ·(presence(b) − 0.5)` — the regression of one standardized quantity on another,
discounted by how well the piece spelled `a` — so `quiet` on a thing the feed calls `loud` reads
below unknown. A relation can add a thing it implies has the word, and lower a thing already
found; it never removes one and never excludes. It is computed on the client from
`user_recs.entries`, which the viewer already holds, so nothing new leaves the server (§4), and
it is recomputed only when the feed changes. `TagRelation` is the seam: a later joint model
replaces `relationFrom` without search changing. What it cannot escape is §2.11's worry — people
in reach co-rating two attributes move `ρ` — bounded by `κ_s` and by the fact that the same
ratings already move the feed.

**When a word matches nothing** on the whole list, a note above the field says *nothing matches
"xyzzy"*, quoting the word as typed (*"!#hipp"*). It changes no row's order — every row carries its 0.5 — but
would otherwise look ignored.

**On screen.** No new component. Every attribute a query read gets the *match* chip tone and goes
first, which is how a viewer sees `late night` was read as one attribute. The bar belongs to the
spelled attribute that contributes least — the one that limits the fit — and to the thing's own
score when only the name was read. With an operator in the query the *add* button stays where it
is, **disabled** (the design language's disabled state: half opacity, no pointer), because an
operator is not part of a name; the catalog lookup is skipped for the same reason.

**What it does not reveal** (§4): everything it reads is the viewer's own feed and ratings,
already on the client. No count, no rater, no number; a note names only words the viewer typed.

**Cost on a phone.** Folding and splitting each name and attribute is cached across keystrokes,
the list recomputes on React's deferred value so typing stays ahead of it, and the relation is
built once per feed. On a synthetic 3 000-thing feed with twelve attributes each, under Bun on an
M-series Mac: about 13 ms for one word and 25–40 ms for four, against 10–12 ms for a matcher that
ranks by kind of match (below); the relation about 16 ms. A phone is several times slower, and a feed of 3 000
things is far past the usual.

**Rejected:**

- **Match every word or be dropped.** A thing missing one word of four is often what was wanted;
  ranking it lower says that, dropping it does not.
- **Ranking by the kind of match first** (exact, then prefix, then typo). A tier ladder ignores
  how good and how present; the product weighs both.
- **One split for the whole list.** It cannot read `late night coffee` as a name on one row and
  two attributes on another.
- **`-hip` as well as `!hip`.** One marker is one rule to reserve; `-` begins real words.
- **`!` as exclusion.** A wrong exclusion is a row that silently isn't there, and the exact,
  typo-free matching that made one safe was a second matcher. Turning the order over keeps
  every row and reads the word the way every other word is read.
- **`field:value`.** `@` and `#` say the same in one character, and the colon is ordinary
  punctuation in titles.
- **Quoted phrases.** The split finds `late night` on its own, and quotes are a second keyboard
  layer.
- **A fuzzy-search library.** `shared/` has no dependencies, and a library's score is opaque
  where this one is a probability.
- **Server-side search** (trigrams in Postgres). The feed already lives on the client; a server
  search over it would need the feed sent back. The catalog lookup stays a prefix range.
- **Refusing every `!`, `@` and `#` in an id.** It would outlaw `yahoo!` and `c#` for no gain;
  only a word's first character is ambiguous.

### Non-goals (v1)

- Comments, reviews, text, photos, star scales. Thumbs only.
- Merging two items that are the same thing under two names — `café bleu` and `cafe bleu`,
  `café bleu` and `café bleu sf`. Identity by normalized name removes the case where the
  difference is only case or spacing. The accent is part of the id (§3.2), so for the accent
  case the catalog's stored `search_id` — the id with its accents and punctuation stripped,
  written beside it and indexed — stands in: typing either spelling finds the one that exists,
  in the catalog and not merely in the feed the viewer already holds, so the second creator has
  to ignore it to make a duplicate. A merge tool is later, and it is the same tool the
  confusable case wants.
- Explaining recommendations. Deliberately not a feature: see §4.
- Live push updates. Recommendations are recomputed on open, behind a ten-minute staleness
  window (§3.4).
- **A person page**, and with it any *about* text a person writes about themselves. Deferred
  together, and in that order: there is nothing to put on a person page once the attributes
  you agree on are on the row itself, and an about line is the first thing that would bring
  it back. Whoever adds the about adds the page.
- **A polished desktop.** The phone layout is what is designed; the desktop is what it
  degrades to.
- **Friend suggestions.** Naming a stranger whose taste is like yours would put a stranger's name
  on screen, need a second Edge Function reading other people's ratings, and give a stranger a
  second way to reach you besides your link (§4).

## 2. Recommendation algorithm

> **Status: built**, in `rust/src/witness/`. `docs/witness-model.md` holds the proofs and the
> measurements every choice was made on, run on a prototype; `docs/algorithm-notes.md` holds the
> built core's own numbers, which are the ones quoted here unless a number says it is the
> prototype's. Two baselines appear in the comparisons: **the relay**, a random-walk model that
> spreads trust along friend edges with a fixed fade at every step, and the model before it. The
> prototype, both baselines and the harness that compared them with the built core are code the
> repository does not keep; their numbers stay as measured. Where a part is
> original to grapevine rather than taken from the literature it says so; **unproven** marks what
> rests on simulation or on nothing yet.

### In plain words

Your list is a guess at one thing: **how you would rate each thing, if you rated it.** Everyone
connected to you is treated as a witness to that, and the whole design is how much to believe each
witness.

- **A connection is trust.** You connect to people whose opinion you want in your list. For now it
  goes both ways.
- **How much someone predicts you is learned, never assumed.** Everyone starts where people like them
  usually start, and every thing you have both rated moves that up or down.
- **A match counts for as much as it was surprising.** Agreeing that a place everybody loves is good
  tells us almost nothing; agreeing about something people near you are split on tells us a lot.
- **A thumb given before yours counts in full; one given after counts for less**, by the chance that
  the person could have seen yours. Nothing about time is used but "before you" or "after you".
- **Someone who reliably disagrees with you is still useful**: their thumbs are read upside down.
- **Trust travels in chains.** You hear the people your trusted people trust, as strongly as the
  chain is trusted at every link. A long chain of people who each predict the next still reaches you;
  one link that predicts nothing cuts off everything beyond it. Someone who has predicted you
  themselves — rated things the way you later did — is heard for it too, but never more strongly than
  the person you trust directly at the head of their chain.
- **Taste can depend on the kind of thing.** A friend can be right about films and wrong about
  restaurants. How much someone predicts you is learned separately for each attribute a thing
  carries, and pulled back toward their overall record by exactly as much as the data says kinds
  don't matter.
- **A thing starts where the people near you put it.** Before anyone's particular taste is weighed, a
  thing most voices near you like starts a little above the middle, which is what gives someone with
  no thumbs of their own a useful list from the first day.
- **Everyone reached through one person you trust counts as one voice.** However many accounts sit
  behind them — real people or one person's fakes — together they are one more opinion, never more
  than that person's own. This is the one rule that is not a consequence of the rest; it is there
  because of bots.
- **Every rated thing shows, and the bar is cautious.** How likely you are to like it and how much
  stands behind that are kept apart; the bar and the order of the list combine them, so a thing
  sits near the top only when you would probably like it *and* many voices you trust say so. A
  guess, or a thing the people you trust are split on, sits near the middle.

### The computation, in order

One pass per viewer `u` over the loaded neighbourhood (at most `N_max = 2 000` people); nothing
iterates to a fixed point. Each step is argued in the section it names.

1. **Base rates** (§2.2). Per thing, up and total thumbs over the **circle**: `u` and the loaded
   people `u` trusts directly. A reading's chance of agreement is the Beta(1,1) posterior of that
   rate with the two people's own thumbs left out; in step 6 a thumb is judged against the circle's
   thumbs plus those of the rater's own region, the rater's own left out.
2. **Direct reliability** (§2.3) of each person `f` `u` trusts directly: the posterior mean of `λ`
   under a Beta prior on `(1 + λ)/2` with mean `a₀` and strength `κ`, over the things both rated. A
   thumb `f` gave after `u`'s is read with the reaction mixture at `e_f = 1/(number of people f
   trusts)`.
3. **Chains and regions** (§2.4). A max-product shortest path out from the direct connections along
   trust connections: popping the strongest `|chain|` first, each neighbour `v` of the popped `w`
   that is neither `u` nor a direct connection, and whose chain so far is weaker, gets
   `chain(w) · λ_{w→v}`. The link is the posterior mean at the same prior over the things `w` rated,
   **every** shared thumb read with the reaction mixture at `e = 1/(number of v's connections nearer
   u than v)`, because the order between two people who are not `u` is not known (it is not asked
   of the database, and measured it is worth nothing). A person's region is the direct connection
   their strongest chain starts from.
4. **Own history** (§2.4), for each reached person who is not a direct connection and shares things
   with `u`: two posteriors with the chain as prior mean, one over the thumbs given before `u`'s and
   one over all of them (later ones at `1/(number of people v trusts)`). Their reliability is the
   larger in magnitude of the first capped at the head's `|λ_f|` and the second capped at their own
   `|chain|`; with nothing shared, it is their chain.
5. **Per-attribute reliability** (§2.8). A thing carries an attribute when more of the circle tagged
   it up than down. Per attribute and region, `κ_a` is chosen from `{1, 2, 4, …, 1024}` by the
   marginal likelihood of the on-attribute readings of the circle and that region under a prior
   centred on each person's off-attribute reliability (ties to the larger); each person's
   reliability on the attribute is the posterior at that `κ_a`, under the same two caps. A thing is
   read at the mean over its attributes that have one, else at the overall reliability.
6. **Scores** (§2.2, §2.4, §2.6). Per thing and region, the reliability-weighted average of the
   raters' log-likelihood ratios, each clipped at `±L`. Per thing, the starting point `logit b`,
   `b = (1 + Σ_r s_r q_r)/(2 + Σ_r s_r)` over the regions `r` that rated it, `q_r` the region's
   reliability-weighted up-share and `s_r` its strongest rater's reliability; plus the regions'
   averages. The score is `tanh(Λ/2)`, clamped strictly inside `(−1, 1)`.
7. **Certainty** (§2.6). For each thumb the posterior chance `ρ` that it is `u`'s answer rather
   than a guess, given the score; averaged per region by reliability; summed over regions: `W`.
8. **Attributes as facts** (§2.8). One fact reliability for everyone, `λ_fact = √(2A − 1)` for `A`
   the rate at which two of the circle agree about one `(thing, attribute)`, each attribute's base
   rate the circle's, and the same per-region average with no starting point. Gaps — a
   `(thing, attribute)` nobody loaded tagged — are filled from attribute pairs: each co-tagging person's
   counts weighted by `|chain|` and averaged within their region, against chain-weighted base rates
   over everyone reached, a spike-and-slab posterior per pair with the linked share by empirical
   Bayes over all pairs, a pair used when more likely linked than not, at its slab mean, and the
   pairs pointing at one gap from the attributes tagged on the thing averaged as one voice. A filled
   gap gets a score and a certainty by step 7's formula over its sources.
9. **Boundary** (§3.4). Every unloaded person adjacent to a loaded one, with the strength a chain
   would reach them at, `max |chain(w)| · |2a₀ − 1|` over loaded neighbours `w` (`u` counting as a
   chain of one), for the loader's extra rounds.
10. **Tallies** (§2.9). Per hop-distance class (1, 2, 3+), the count, sum and sum of squares of
    each pair's rate `(1 + λ̂)/2` with `u`, and the sum of their weights, over every loaded person
    connected to `u` who shares at least ten things with them.

Posteriors are integrated on a 16-point midpoint grid (64 measured no different), except under a
prior too sharp for it, where the window is the prior's own scale (`docs/witness-model.md` §1.8).
Every sum runs in a fixed order, so a snapshot's result is bit-identical run to run.

### 2.1 Goals and the threats it must survive

Everything below is per viewer `u`. The output is, for every ratable `x` that anyone in reach has
rated, a score `s_u(x) ∈ (−1, 1)` and a certainty in `[0, 1)`.

Requirements, in priority order:

1. **Personal**: `s_u` is a function of `u`'s ratings and `u`'s trust network. No global score, and
   no global aggregate except the population priors of §2.9, which are moments of the population.
2. **Sybil-bounded**: the influence any set of accounts can have on one of `u`'s scores is bounded
   by the trust connections joining that set to `u`'s honest network, not by the number of accounts,
   and the bound rests on nothing the set can change (§2.5).
3. **Learned, not assumed**: how much a thumb counts is a posterior over what the viewer has seen,
   from a population prior (§2.3).
4. **Incentive-aligned, per state**: reporting your true thumb is at least as good for your own
   results as the opposite or as silence, in expectation (§2.7).
5. **Transitive, bounded**: people the viewer does not know directly are heard through chains of
   trust, as far as the chain still predicts, and never more strongly than the person they are heard
   through (§2.4).
6. **Discreet**: results never display who rated what (§4).

| Attack | What bounds it |
|---|---|
| Bot farm behind one trusted person `h` promotes item `P`. | One voice (§2.4): everything reached through `h` is pooled into `h`'s one voice, which is never stronger than `h`'s own. A thousand bots are the same voice as one. |
| Bots copy the viewer's thumbs to look reliable. | Copies come after the viewer's thumbs and count only by the chance they are not reactions (§2.3), except on a thing the viewer turned over and back or cleared and gave again, where they read as predictions (§2.3's hole); and a chain is never stronger than its first link, which the bots do not touch (§2.4). |
| Bots copy their gatekeeper's thumbs, to be trusted by them. | Their only connection is the gatekeeper, so the chance they saw what they copy is one, and a copy counts for nothing (§2.3). |
| Bots copy the crowd before anyone rates, to look reliable. | Agreeing with the crowd is what chance predicts, so it teaches little (§2.2); whatever they earn, they are inside one voice. |
| Bots tag thousands of items with obvious categories. | Facts are weighed per voice, not per account (§2.8), and which kind a thing is, the circle decides. |
| Bots swing how things are usually rated near the viewer, to make other people's thumbs look surprising or not. | Base rates are the circle's, and a region's thumbs are judged against the circle and that region only (§2.2). |
| A region pushes the same lean on every item. | **Not bounded across items** (§2.5): one voice per item, on every item. The residual risk, stated. |
| A dense clique inside the nearest `N_max`, to make the recompute expensive. | Every step is one pass over what was loaded (§2.10); `N_max` bounds it. |
| Inferring one person's rating from your feed. | No counts, no order, a staleness window, a bar with no number. With exactly one connection the feed *is* that person's ratings; §4 says so. |

### 2.2 The model: one story

The model is Dawid & Skene's "learning from crowds" (1979) turned around: the crowd is everyone the
viewer is connected to, and the truth is the viewer's own taste.

**The truth.** For each ratable `x` there is `t(x) ∈ {−1, +1}`: how `u` would rate it. `u`'s own
thumbs are `t` observed. Everything else is a guess at `t`.

**Witnesses.** Every other person `v` is a witness with a signed reliability `λ_v ∈ (−1, 1)`. On any
thing, with probability `|λ_v|` their thumb is `u`'s own answer (reversed when `λ_v < 0`); otherwise
it is a draw from how that thing is usually rated near `u`, its base rate `b_x`:

    P(v says +1 | t)  =  |λ_v| · [sign(λ_v)·t = +1]  +  (1 − |λ_v|) · b_x

This is the "knows or guesses" annotator: MACE (Hovy et al., NAACL 2013) without its per-annotator
guessing distribution, and Aickin's constant-predictive-probability model of agreement (*Biometrics*
46, 1990). It is a one-parameter slice of Dawid & Skene's two-coin model, and `λ` is Youden's J
(sensitivity + specificity − 1), which lets a reliable opposite be read reversed exactly as Raykar &
Yu flip an adversarial annotator (*JMLR* 13, 2012). The viewer's own thumbs anchor the sign, so the
label-switching problem of unsupervised Dawid–Skene does not arise (Ghosh, Kale & McAfee, EC 2011,
need one known-good agent; the viewer is it).

**What falls out of it, with no rule added:**

- **Chance weighting.** A thumb's evidence is its likelihood ratio. Agreeing with the grain on a thing
  everybody near `u` likes (`b_x` near 1) carries a ratio near `1/(1 − λ)` — weakly informative, never
  zero — and a thumb against the grain carries a large one. When `b_x = 1/2` the ratio is
  `(1 + λ)/(1 − λ)`, the Nitzan–Paroush log-odds weight (*Int. Econ. Rev.* 23, 1982). When `b_x` equals
  both people's overall rates, `λ` is Cohen's κ exactly.
- **Flipping.** `λ < 0` makes `v`'s up evidence for down: a reliable opposite is as useful as an ally.
- **Chains** (§2.4). If `v` knows `w`'s answer with probability `λ_{w→v}` and `w` knows `u`'s with
  probability `λ_w`, then `v` knows `u`'s with probability `λ_w · λ_{w→v}`: reliabilities multiply
  along a chain, signs included, and a chain is never more reliable than its weakest link — the
  data-processing inequality for this channel.

**The base rate** `b_x` is how `x` is rated near `u`, a Beta(1,1) posterior over the thumbs of the
viewer's **circle** — the viewer and the people they trust directly — with the two people a reading
compares left out. In a thumb's likelihood it says how surprising the thumb is. It is the circle and
not everyone reached because base rates feed every reliability: read over everyone, accounts behind
one person move other regions' evidence, the links of chains and the heads' own reliabilities, and
two hundred of them move one thing by 7.16 of log-odds behind one connection, past §2.5's bound of
4.69 (4.86 with each region counted as one voice, since the one voice still reaches everyone else's
base rates). Nobody in the circle can be such an account. The same holds for everything else read
off the population around the viewer: which attributes a thing carries, the fact reliability and the
attributes' base rates (§2.8; attribute pairs are the one exception, and §2.8 says why it is safe).
**Original to grapevine.**

When a thumb is weighed as evidence (§2.6) the guess it might be is drawn from how the thing is rated
around the guesser: the circle **and the guesser's own region**. A region reaches only its own
members' evidence that way, and a swarm agreeing with itself on a thing only it rated is no surprise
to itself; against the circle alone, a promoted thing nobody in it has rated sits at an even chance,
every bot's thumb on it is a surprise, and twenty bots behind a connection move it `+0.13` rather
than `+0.09`. Reliabilities are learned against the circle alone: regions are not known until the
chains are, and a head's reliability must not depend on who is behind them.

**The viewer's answer before any witness** is that base rate too, counted by voices: each region of
§2.4 contributes its up-share once, weighted by its strongest rater's reliability, so a region nobody
believable is in contributes nothing. This is Dawid & Skene's class prior made per thing — empirical
Bayes, since the same thumbs then also enter as witnesses — and it is what lets a thing most people
near the viewer like start above the middle before any particular person's taste is weighed. Measured
(`docs/witness-model.md`), it adds up to 0.05 of held-out AUC; a region can move it by at most `ln 2`
of log-odds (§2.5). A region's say is its *strongest* rater's reliability, not its raters' combined
reliability: combined, forty bots each barely reached add up to a whole voice, and a promoted thing
leans for 243 of 244 people two steps from where they were accepted on the realistic graph
(prototype).

### 2.3 How much a person predicts you

**Learned only where the answer is known.** `λ_v` is learned from the things `u` rated, because only
there is `t` observed. Dawid–Skene would also learn it from things nobody knows `u`'s answer to, by
checking `v` against the other witnesses; for taste that is the wrong question — two people agreeing
about something `u` never rated says they share *their* taste. Crowd-labelling on subjective
questions finds exactly this: people split into schools with different right answers (Tian & Zhu,
KDD 2012), and unlabelled data can make a misspecified generative model worse (Cozman & Cohen, 2002).
It is also where colluding accounts raise each other. So the viewer's unrated things never teach
reliability: feedback from them is **cut**, in the modular-Bayes sense (Plummer, *Stat. Comput.* 25,
2015; Jacob et al., 2017). The same holds for a link `w → v` of a chain: it is learned from the things
`w` rated.

**Before and after.** A thumb `v` gave before `u` rated the same thing is a prediction. One given
after may be a reaction to `u`'s: seen in `v`'s own feed, followed or resisted. The model says so
directly: a later thumb is, with probability `e_v`, a reaction whose direction tells nothing about
`v`'s taste either way, and otherwise an independent witness:

    later:   P(v's thumb | λ)  =  e_v · ½  +  (1 − e_v) · P_witness(v's thumb | λ)

So a later thumb carries about `1 − e_v` of the evidence an earlier one would, less when `v` was
likely to have seen `u`'s, and it counts the same whether it agrees or disagrees. There is no copier
type and no copy detection: measured herding is small and spread over everybody (Muchnik, Aral &
Taylor, *Science* 2013), and a per-person "copier" type could not be told apart from an honest friend
with the overlaps a viewer has. Resnick & Sami (RecSys 2007) keep only earlier thumbs, which is the
case `e_v = 1`.

**Before is measured against the viewer's current thumb, and that is a hole.** The order is `v`'s
`rated_at` against the viewer's `rated_at` on the same thing (0015, 0016), and the viewer's moves:
turning a thumb over restamps it, and clearing one and giving it again writes a new row. So when the
viewer turns a thumb over and back, or clears and re-gives it, every thumb given on that thing since
the viewer's first — a copy of the viewer's own included — reads as a prediction, and a copy that
matches raises its account toward the head of its chain as if it had predicted the viewer. The bound
of §2.5 still holds, since the head caps it; what the hole gives away is the gap between a copier's
own chain and its head. Closing it needs a permanent record of when the viewer *first* rated each
thing, kept through a clear, and that is deliberately not kept: it would reward rating everything
early, any way at all, just to be first, and would keep that influence after the rater changed
their mind. Resetting the order on a flip or a clear removes that incentive, at the cost above.

**Exposure** `e_v` is the chance `v` could have seen `u`'s thumb: `u`'s share of what `v`'s own feed
said about that thing. It comes from the trust graph, not from anything `v` did. `v`'s feed is one
voice per person `v` trusts (§2.4), and a voice in which `u` is the only one who rated the thing *is*
`u`'s thumb — the average does not dilute a lone rater — so `u`'s thumb can be one of `v`'s voices:
`e_v = 1/(number of people v trusts)`. An account whose only connection is `u` has `e = 1`, and its
later thumbs count for nothing. A product of shares along the path back to `u` is wrong for
exactly that reason: it leaves a lone bot behind a friend unexposed, and copying the viewer then
earns it the friend's whole voice (`+0.87` on a promoted thing, prototype).

For a **chain link** `w → v` the thumb that may have been seen is `w`'s, and it reaches `v` through
`v`'s connections that are nearer the viewer than `v` — for a person reached along the chain, that
is the way toward `w`; everyone else `v` trusts is `v`'s own circle, and in a swarm of accounts
behind one person they know `w` only through that person too. So a link's exposure is `1/(number of
v's connections nearer the viewer than v)`: a bot whose only connection toward the viewer is its
gatekeeper saw everything the gatekeeper said, however many other bots it is connected to. Counting
all of `v`'s connections instead lets a clique of bots that copy their own feed — which is their
gatekeeper's circle — earn a strong link to the gatekeeper by being connected to each other: `+0.17`
on the promoted thing against `+0.06` (prototype, `docs/witness-model.md` §2.6). Both exposures are
original to grapevine, structural estimates with no impression log behind them, and unproven; their
only defence is what they measured.

**With no history at all** — a new viewer, or one who has rated only things nobody near them has —
every person they trust starts at the prior (`λ = 2a₀ − 1 = 0.3`), every chain from them is learned
from *their* history with the people beyond, and every thing anyone reached rated has a score. Measured
on the built core over five worlds, a viewer with no thumbs ranks what they would like at 0.671 / 0.829
/ 0.696 / 0.520 / 0.554 AUC against the relay's 0.673 / 0.814 / 0.658 / 0.520 / 0.548, with a score on
every thing where the relay has one on 78–100% of them: level where friends are chosen almost regardless
of taste (mixed), ahead elsewhere. Counting the starting point by the voices' combined reliability, up
to the head, doubles what bots that only promote achieve (`+0.13` against `+0.07`, prototype), so it
stays each region's strongest rater.

**The prior** on a directly trusted person's agreement rate `(1 + λ)/2` is a Beta with mean `a₀`
and strength `κ`, estimated from the population (§2.9); pooling is the literature's answer to overlaps
of a handful of things (Paun et al., *TACL* 6, 2018; Venanzi et al., WWW 2014). Anyone further gets
their prior from the chain that reaches them (§2.4). **The estimate** is the posterior mean of `λ`, a
one-dimensional integral per person, because a weight is judged by squared error.

### 2.4 Trust chains, and the one axiom

**The chain.** Each person `f` the viewer trusts directly starts a chain at `λ_f`, learned as in
§2.3. From anyone `w` already reached, the chain continues to `v` along a **link**: a trust
connection between them, or demonstrated agreement — `v` reliably predicting `w`'s thumbs on things
`w` rated. A link's reliability `λ_{w→v}` is learned exactly as `λ_v` is, with `w` in the viewer's
place: from `v`'s thumbs on the things `w` rated, where now `e` is the chance `v` saw `w`'s thumb.
Every shared thumb of a link is read as possibly a reaction, at `1 − e`: the database gives the
order of a thumb against the viewer's only, and the order between two people who are not the viewer,
measured, is worth nothing (`docs/witness-model.md` §2.1). The chain's reliability at `v` is the
product along it (§2.2):

    λ_chain(v)  =  λ_f · λ_{f→w₁} · λ_{w₁→w₂} · ... · λ_{w_k→v}

Each person is reached by their **strongest** chain — the path maximizing `|λ_chain|`, a shortest-path
problem on `−log|λ|` — which is TidalTrust's rule of trusting the strongest paths (Golbeck, 2005). The
chain's value is `v`'s prior; `v`'s own history with the viewer, when there is any, updates it, and
the result is **never larger in magnitude than the reliability of the head of the chain** — the person
`f` the viewer trusts directly — so nobody reaches the viewer more strongly than the person they are
reached through; and only thumbs `v` gave before the viewer's can raise `v` past their own chain at all
(below). A chain fades only as trust falls; a link near zero cuts off everyone beyond it who has not
predicted the viewer themselves; a reliable opposite passes the chain on reversed.

**How far own history may raise someone.** Thumbs given *before* the viewer's — predictions — may raise
a person up to the head of their chain. Thumbs given after, discounted by exposure, may raise them only
up to their own chain. Both alternatives lose (prototype, `docs/witness-model.md` §2.1, §2.6):

- *Capping everything at the whole chain* throws away most people's own record: a chain of
  reliabilities near 0.3–0.6 is below 0.02 two or three links out for 11–53% of the people reached,
  and held-out AUC falls by up to 0.10 (0.728 against 0.826 on the mixed world).
- *Letting later thumbs raise anyone to the head* gains 0.013 AUC on average over five worlds and lets
  bots that copy the viewer, the crowd or their own feed after the fact reach their head's full
  strength: `+0.16` to `+0.19` on a promoted thing against `+0.05` to `+0.07`.

**Demonstrated-agreement links** — `v` reaching the viewer through `w`, inside `w`'s region, because
`v` reliably predicts `w`'s thumbs without a trust connection between them — **are not built**:
measured, they add 0.000 to 0.005 of AUC on five worlds at two to three times the cost of a recompute.
Their rule, if they ever come, stays: inside a region only (§2.5).

This is where "trust in who they trust" lives, and it is a gate on reach, not a head start: the
standing objection to such a thing — a correlation prior between reliabilities that nothing in the
literature measures — does not apply, because nothing here assumes that friends' reliabilities are
alike — the chain's value is what the witness model itself implies if `v` knows the viewer's taste
only through `w`, and it is tested wherever `v` shares history with the viewer. Propagated trust is
standard in trust-aware recommenders — multiplied along paths (Golbeck's TidalTrust; Guha et al.,
WWW 2004), decayed with distance (MoleTrust, Massa & Avesani, RecSys 2007), flowed with capacities
(Advogato, Levien) — and each finds error lowest at one step and coverage gained at two or three
(Massa & Avesani; Jamali & Ester, KDD 2009). Multiplying *learned reliabilities toward one person's
taste* is derived here from the channel and measured here in simulation — chains are worth 0.01 to
0.17 of held-out AUC (`docs/witness-model.md` §2.1) — and not shown to be the best composition.

**The one axiom.** Everything above assumes witnesses are independent given `t`. People reached
through one person are not: the viewer cannot tell ten real friends of `f` from ten accounts `f`
made.

> **Everyone reached through one person the viewer trusts counts, together with that person, as one
> voice.**

Concretely, every reached person belongs to exactly one **region**, the one whose chain reaches them,
and a region's evidence on `x` is the reliability-weighted average of its members' evidence on `x`:

    E_f(x)  =  Σ_{v in f's region, rated x} |λ_v| · clip(LLR_v(x), ±L)  /  Σ_{same} |λ_v|

with `λ_v` each member's reliability after the cap, and `LLR_v` computed at it. A region with one member who rated `x`
speaks at that member's strength; a region of a thousand who rated it speaks at their weighted
average. Nothing is halved at each step: depth costs nothing but the trust it takes.

**What it means as probability.** Clemen & Winkler (*Operations Research* 33, 1985) show that `k`
equally correlated sources are worth `k / (1 + (k − 1)ρ)` independent ones, and exactly one when
`ρ = 1`. Under `ρ = 1` the Bayesian answer is the logarithmic pool — log-likelihood ratios averaged
with weights summing to one — which is externally Bayesian (Genest & Zidek, *Stat. Sci.* 1, 1986). So
the axiom does not suspend Bayes: it chooses, for every region, the worst dependence it cannot rule
out, and the posterior is exact under that choice. What it gives up is calibration when a region really
is independent — a score then too close to the middle, never too far from it.

**The clip** at `±L` is Huber's least-favourable likelihood ratio (*Ann. Math. Stat.* 36, 1965): under
a chance `ε = 2/(1 + e^L)` that any thumb is unrelated to anything, no single thumb says more than `L`.

### 2.5 The bound

**Claim.** Let `S` be a set of accounts every trust path from `u` to which passes through `h`, and `f`
the person the viewer trusts directly at the head of `h`'s region. For every ratable `x`, everything
`S` says about `x` reaches the viewer inside that one region: its average, at most the log-likelihood
ratio of one thumb at reliability `|λ_f|` and never more than `L` either way, plus at most `ln 2` through
the starting point of §2.2 — so at most `2L + ln 2` of log-odds, whatever the number of accounts. The
proof is in `docs/witness-model.md` §1.4; in outline:

1. *The bots cannot raise `h`, or anyone else outside `S`.* `λ_chain(h)` is a product of links on a
   path from `u` to `h`. Each link is learned from the thumbs of the two people it joins, both outside
   `S`; the viewer's trust in a directly trusted `h` is learned from `h`'s own thumbs. Every base rate
   and every other statistic of the population they are read against is the circle's, and nobody in
   `S` is in the circle.
2. *The bots cannot leave `h`'s region.* A trust path from `u` to a member of `S` passes `h`; a strongest
   chain along trust connections therefore reaches `S` through `h`, inside the region `h` is in.
3. *The bots cannot outweigh the region's head.* Every member's reliability is capped at `|λ_f|`,
   whatever their own history. An average is at most its largest term.
4. *Copying does not help past that.* A bot's only connection toward the viewer is `h` or another bot,
   so a link to it is learned at exposure one and copying `h` — or the bots' own feed, which is `h`'s
   circle — earns nothing; copying the viewer is later, and later thumbs raise nobody past their own
   chain — except on a thing the viewer has since turned over and back or cleared and given again,
   where a copy reads as a prediction and can raise its account to `|λ_f|` (§2.3). The cap at the head
   is untouched, so the bound is too.
5. *One caveat.* Bots connected to `h` raise the number of people `h` trusts, which lowers `h`'s own
   exposure, so `h`'s later thumbs count differently — exactly as connections to accounts that rate
   nothing would make them, and not necessarily more: the posterior is not monotone in exposure once
   two later thumbs are discounted (`docs/witness-model.md` §1.4, step 3). They cannot make `h` say
   anything `h` did not.

Tested (`rust/tests/witness_sybil.rs`): every step above, on every plan below and tag spam, three
shapes, one to two hundred accounts, behind one to three accepted connections and behind someone two
steps out — 720 attacks, none past the bound. Simulated on the built core (`docs/algorithm-notes.md`
§6). Twenty bots in a clique behind each of one, two or three of the viewer's connections, the
promoted thing's average score for that viewer, this model against the relay:

| the bots first | behind 1 | behind 2 | behind 3 |
|---|---|---|---|
| do nothing | +0.09 / +0.06 | +0.17 / +0.11 | +0.27 / +0.16 |
| copy the viewer | +0.09 / +0.37 | +0.17 / +0.55 | +0.27 / +0.66 |
| copy the viewer, and tag the promoted thing with the viewer's commonest attribute | +0.09 / +0.37 | +0.18 / +0.55 | +0.26 / +0.66 |
| copy the crowd | +0.09 / +0.19 | +0.17 / +0.30 | +0.27 / +0.39 |
| make popular things look contested, then agree | +0.09 / +0.17 | +0.17 / +0.29 | +0.27 / +0.37 |
| copy their own feed | +0.09 / +0.13 | +0.17 / +0.23 | +0.27 / +0.31 |

Whatever the bots do first, they read at their chain, so every plan scores the same. Worst single
viewer: `+0.40` against the relay's `+0.69`. Reading the population statistics over everyone reached
rather than the circle scores `+0.05` to `+0.07` behind one (prototype), and lets the same bots move
other things past the bound (§2.2). The paid promotion (three accepted connections, forty bots each,
everyone by distance from whoever accepted), under every plan: the thing's score passes `+0.1` for
51 of 96 people one step out at `+0.13`, 27 of 423 two steps out and 1 of 192 further, at `+0.12`;
on the realistic graph 37 of 46 at `+0.14` and 2 of 244. **Where it is worse than the relay**: bots
that only promote lean the thing slightly for far more people one and two steps out (the relay: 1
and none) — a lone rater speaks for its region where the relay diluted it by a share of attention;
bots that copy their feed first reach fewer people one step out than under the relay (51 against
69–93) but more two steps out (27 against 1–4). Every one of those leans is small, and inside the
bound.

**What it is, and what it is not.**

- **Pre-attack.** The bound rests on quantities the attack cannot change — Ruderman's objection to
  Advogato's proof, where a bound on post-attack capacities let the gain grow as the square of the
  cost, and Hopcroft & Sheldon's standard (WAW 2007).
- **Per accepted connection.** Several people who each accept a bot each let in, at most, their own
  region's voice; each account sits in one region, so `k` accepted connections are at most `k` voices.
- **Demonstrated-agreement links would weaken it, unless confined.** If `v` could join a region by
  predicting its head's thumbs, a bot swarm reached through several accepted connections could spread
  into every region whose people it can predict. Confined to people already inside the same region,
  the bound above holds exactly. They are not built (§2.4), and that is their rule if they ever are.
- **Residual risk: per item, not per feed.** A region can lean *every* item by up to its voice — worst
  case, a directly trusted friend with `λ = 0.6` who accepts bots gives every item the bots promote,
  and nobody else in the friend's circle rated, a lean of `tanh(½ ln(1.6/0.4)) ≈ 0.6`. SumUp says the
  same of itself ("up to `e_A` bogus votes on every object"). Bounding the total across items needs a
  reputation the region spends when it is wrong (Resnick & Sami's influence limiter; Seuken & Parkes'
  used-up trust, AAMAS 2014), which costs every honest source about `log n` of its influence to start
  (Resnick & Sami, RecSys 2008). Not built, by decision; the remedy is the viewer's: drop the connection.
- **It wastes information, by design.** A trusted person with fifty independent, well-informed friends
  is still one voice. Clemen & Winkler's right cap would be `1/ρ` if the region's dependence `ρ` were
  known; it cannot be estimated honestly, because the region controls the data it would come from.
- **No zero.** Strong transitive trust, anonymity and misreport-proofness together imply some sybil
  attack pays (Seuken & Parkes, AAMAS 2014). Bounded, not prevented.

**If trust were one-directional.** Nothing in §2.2–§2.5 needs trust to be mutual. Chains would follow
the direction trust was given, from `u` outward; `S`'s paths are paths along trust, and the bound is
unchanged — cleaner, since an attack edge is exactly an honest person choosing to trust an account.
Exposure would follow the other direction: `v` sees `u` only if `v` trusts `u`. What changes is outside
the model: §4's symmetry breaks — someone who trusts you would see your thumbs as their feed without
your trusting them back, so a one-way connection would need the trusted person's consent, or the
one-connection leak of §4 becomes a way to read a stranger. The literature favours trust on quality:
ratings agree with explicitly trusted people far more than with friends (average correlation
0.32–0.45 on Epinions and Ciao against 0.06–0.18 on friendship graphs; Guo, Zhang & Yorke-Smith, AAAI
2015).

### 2.6 Scoring every rated thing

**The score** is the posterior predictive `P(t(x) = +1 | everything)` mapped to `(−1, 1)`:

    Λ_x  =  Σ_{regions f} E_f(x),        s_u(x)  =  tanh(Λ_x / 2)

**The certainty.** A yes-or-no truth cannot tell "nothing is known" from "people you trust are split":
both are a posterior of one half. The model does know the difference — how much evidence there is —
and keeps it beside the score. Each thumb is, under §2.2, either the viewer's answer or a guess, and the
posterior gives the chance `ρ_{v,x}` that it is the answer; a region's share is the same average as
its evidence, so the thumbs amount to

    W_x  =  Σ_{regions f} (the weighted average of ρ_{v,x} over f's raters of x)

of the viewer's own thumbs, at most one per region; the feed stores it as `conf`. The certainty is
`W/(1 + W)`: the share of a Beta posterior on the viewer's leaning that is evidence, with the Jeffreys
prior Beta(½, ½) as the one pseudo-thumb it starts from. This is subjective logic's split of an
opinion into evidence and uncertainty (Jøsang, 2001) and evidence counting through a trust network
(Škorić, de Hoogh & Zannone, 2015); in this combination it is original to grapevine.

**What is shown combines the two.** The score and `W` are stored apart; the bar draws, and the list
ranks by, the posterior mean of that Beta on the `−1..1` scale, `c = s · W/(1 + W)` (§1 "The bar",
which says why the mean and not a quantile). A thing people you trust agree on sits near an end; a
thing nobody believable rated, and a thing they split on, sit near the middle. What tells those last
two apart is kept in `W` and not drawn.

**Is more certainty more often right? Measured, yes where anything can be learned.** The share of
held-out things whose side of the middle is the viewer's, from the lowest populated fifth of
`W/(1 + W)` to the highest: 71% → 93% (mixed), 64% → 78% (spread), 60% → 83% (sparse), 53% → 66% (realistic);
in the high-rank world, where nothing near the viewer predicts them, 50% → 53%. As a probability the
score is off by 1–11 points on average (expected calibration error 0.014 sparse, 0.021 spread, 0.090
mixed, 0.098 high-rank, 0.105 realistic): too timid in the mixed world, too bold in the realistic and
high-rank ones.

**There is no floor.** Every ratable anyone in reach rated has an entry; certainty moves a thing
toward the middle, never off the list. The score is conditional on the axiom's pessimism, so it is
checked, not assumed: a reliability curve of shown score against the viewer's own later thumbs, and
a recalibrating map if it is off, rather than loosening the axiom.

### 2.7 Incentive compatibility, stated carefully

Your reports enter your results through your displayed thumbs (trivially honest-best) and through
what they teach about each witness's reliability. The honest report is the one under which those
agreements are a correct sample of your true agreement; an inverted report samples its opposite.
Resnick & Sami's scoring of sources on thumbs given later makes honest reporting the best a source
can do, because the score is a proper scoring rule (their Lemma 1); here later thumbs count too,
discounted, which keeps the direction of that argument but not its exactness. It holds on average and
against fixed states, not per item or against an adaptive adversary: Personalized PageRank fails
strong incentive compatibility for any damping (Altman & Tennenholtz, IJCAI 2007), and their
impossibility result is the reason not to chase it.

### 2.8 Kinds of thing, facts, and attributes that go together

**Taste depends on the kind of thing.** A friend can be right about films and wrong about
restaurants; the literature measures it (only about a third of a trust network is trusted on any one
topic: Tang, Gao & Liu, WSDM 2012) with thousands of ratings per topic, which a viewer's overlaps
never have. So a person's reliability on things carrying attribute `a` is learned from the viewer's
things carrying `a`, **shrunk toward that person's reliability on everything else** by a strength
`κ_a` — a hierarchical prior, the standard answer to small groups (Paun et al.; Gelman & Hill).
`κ_a` is not chosen: it is the value that best explains the history with the viewer on `a` (type-II
maximum likelihood over a grid, per attribute, per recompute) of the circle and of the region being
read — the same people a region's thumbs are judged against (§2.2), so a region of copiers can pick
its own `κ_a` and nobody else's. Chosen over the circle alone it is too few people: per-attribute
reliability then costs accuracy on every world measured (−0.005 to −0.007). If kinds don't matter
for `a`, the data picks a large `κ_a` and the attribute changes nothing; if they do, a small one. A
thing carries an attribute when more of the circle tagged it up than down. A thing carrying several
attributes is read at the average of their reliabilities; a thing carrying none, at the overall one.

**No declared kinds.** Whether `movie` is a kind and `quiet` a quality is not declared anywhere: every
attribute is a candidate, and the shrinkage decides. On a simulated world where each person's taste
is drawn separately per category (the same as their home group's with probability 1, 0.6 or 0.3),
with three category attributes and three quality attributes that carry no taste:

| taste shared across categories | relay | this model, one reliability | this model, per attribute |
|---|---|---|---|
| always | 0.826 | **0.846** | 0.843 |
| with probability 0.6 | 0.766 | 0.807 | **0.809** |
| with probability 0.3 | 0.725 | 0.781 | **0.783** |

The strength it picks for quality attributes is about 39–45 things; for categories 20–30. So it
tells the two apart from the data, gently. **It gains next to nothing** (−0.003 to +0.002). Most of
the prototype's gain of 0.014 to 0.039 (0.858 / 0.844 / 0.822) comes from letting people beyond a
direct connection rise to the head on thumbs given after the viewer's, the variant §2.4 rejects
(`docs/algorithm-notes.md` §4). It stays because it is where a friend right about films and wrong
about restaurants is read correctly, and it costs almost nothing where kinds don't matter.

**Does it help a copier?** A copier could aim at one attribute, where there are fewer things to match.
It gains nothing past the overall rule: a person's reliability on an attribute is centred on their
reliability off it, worked out by the same capped rule, and capped the same way — predictions up to
the head, later thumbs up to their own chain — and someone whose every shared thing carries the
attribute reads at their overall reliability. The copier's own tags decide nothing, since the circle
says what kind a thing is. Capped only at the head, a copier of the viewer reaches the head through
any attribute (`+0.24` on a promoted thing, worst `+0.58`); under both caps the attack scores what
copying the viewer does (§2.5).

**Attribute thumbs are facts.** A thumb on `(thing, quiet)` asks a question of fact, where reliability
has nothing to do with taste. Every witness has one reliability for facts, shared by everyone —
estimated from how often two people of the circle agree about the same thing's attribute — and facts are
averaged per region as items are. Here, unlike taste, that is the right question: a fact has one
answer, so classic unsupervised Dawid–Skene is well specified and the cut of §2.3 is not needed.
Per-person fact reliability, shrunk toward the shared one, is the extension once the data can carry
it. Attribute thumbs therefore never teach anyone's taste reliability; they only say which kind a
thing is.

**Attributes that go together.** When people in reach tag things `quiet` up and `loud` down together,
a thing called loud reads *not quiet*. **Every pair is learned**, over the viewer's trusted network
only: each reached person's co-tagging, weighted by the strength of the chain that reaches them, is
averaged within their region so that a region counts as one voice (a thousand bots co-tagging are one
person co-tagging). Each pair's link is the same witness channel as §2.2 — one attribute's thumbs as
evidence about another's, chance-corrected by both attributes' base rates. Those base rates, alone
among the model's population statistics, are not the circle's but the chain-weighted up-shares over
everyone reached: a pair's reading only ever fills a gap, which is that gap's whole score, so
whatever reaches it through them stays inside one gap's `±L`. A fill draws only on attributes
somebody tagged on the thing, never on another gap filled on it.

**Only pairs that are probably real are used.** Each pair is either unlinked (`λ = 0`) or linked with a
reliability drawn from a flat prior, and the share of linked pairs is estimated from all the viewer's
pairs at once — a spike-and-slab prior with its mixing weight by empirical Bayes, which is Efron's local
false discovery rate (Efron, *JASA* 96, 2001). A pair is used to fill a gap when it is **more likely
linked than not** — the Bayes decision with equal costs, not a threshold on its size — at its
reliability given that it is linked. Several attributes pointing at one gap are not independent of
each other, so by the same axiom they count together as one voice. The prediction is the prior on the
gap's `t`, which direct thumbs, when there are any, outweigh.

Simulated (12 attributes along 3 hidden properties, 80 people, three seeds; and the same world with
every attribute independent, where every fill is noise; the two alternative rules are the
prototype's):

| rule | linked world: gaps filled, right | independent world: gaps filled, right | pairs used per viewer |
|---|---|---|---|
| relay | 660, 78.0% | 770, 51.4% | — |
| every pair at its posterior | 702, 86.0% | 814, 54.9% | 66 |
| posterior size above 0.3 | 696, 86.6% | 452, 52.4% | 25 / 5 |
| **more likely linked than not** | **372, 86.3%** | **0** | **7.3 / 0** |

It fills fewer gaps, more of them right, and none at all where nothing is linked. **One new thumb**
changes which pairs are used 0.030 times on average in the linked world and never in the independent
one; and the change it can make is bounded (`docs/witness-model.md` §1.6): a co-tag from someone who
already co-tagged the pair multiplies the odds that it is linked by at most `1/c`, `c` the chance that
two such thumbs agree anyway — at most doubling near an even split — and someone co-tagging it for the
first time can at most pull their region's reading toward a single co-tag.

**Things with things are not linked.** On the same data a model linking things through their
correlations and one weighting people are the same linear model (the push-through identity), so item
correlations add nothing the reliabilities do not already carry; a joint Gaussian over every
ratable measures exactly that (−0.025 to +0.010 AUC, `docs/algorithm-notes.md` §11) and opens an
attack. A low-rank structure fitted over
everyone would add information, but it is a global aggregate over everybody's ratings, which §2.1 and
§4 rule out.

### 2.9 Parameters, and the priors from the population

| kind | name | value | why |
|---|---|---|---|
| prior | `κ`, `a₀` | 8; 0.65 | the Beta prior on a direct trust connection's agreement; estimated from the population (method of moments over pairs, pooled by 0005), the table is the fallback. The same prior serves every link of a chain. |
| learned | `κ_a` | per attribute and region, per recompute | how far reliability on things carrying `a` may leave the overall one (§2.8) |
| learned | share of linked pairs | per recompute | the spike-and-slab mixing weight (§2.8) |
| learned | fact reliability | per recompute | how often people in the circle agree about attributes |
| cap | `L` | 2 | the most one thumb can say, as log-odds: Huber's clip at `ε = 0.24` |
| unit | Jeffreys prior | Beta(½, ½) | the one pseudo-thumb certainty starts from |
| budget | `N_max` | 2 000 | people a recompute loads: memory, CPU and egress |

**What is pooled is on the prior's scale.** `a₀` is the mean of `(1 + λ)/2`, not of the share of
matching thumbs: under the channel a pair matches with chance `c̄ + λ(1 − c̄)`, `c̄` the mean chance
of a match on the things they share (each the circle's base rate of `u`'s thumb, both left out, as in
§2.2), so on a catalogue with things nearly everyone likes the plain share reads strangers as close.
Each pair reports `λ̂`, the channel inverted (`(A − c̄)/(1 − c̄)` at or above chance, `A/c̄ − 1`
below), as the rate `(1 + λ̂)/2`, and in place of its overlap a **weight**: the number of fair coins
whose share is as noisy as that rate, by the delta method at `λ̂` — the same as the overlap at
`c = ½`, two for ten matches on things nine in ten like. That is what makes 0005's sampling term
`m(1 − m)/n̄`, written for a plain rate, right for this one, so 0005 is unchanged and pools the same
four sums into `a0_d1` and `kappa`, which the core merges. On a simulated population with no
consensus things `a₀(1)` reads 0.599 against a true 0.590 (the plain share: 0.632) and `κ` 9.3
against 9.0 (9.7); with thirty things everyone likes, 0.615 against 0.593 (0.816) and `κ` 17 against
12.7 (36) (`tests/priors.rs`). Pooled from recomputes the chances are a small circle's, which is how
the core reads the same pair, and on the second world that leaves `a₀(1)` at 0.70.

Exposure, the chains, the regions, the base rates and the chance of each thumb carry no constants of
their own. There is no prior by hop distance: a chain is the prior for anyone past a direct
connection. The pooling (§3.7) still writes `a0_d2` and `a0_d3plus`, and the core reads only `kappa`
and `a0_d1`.

### 2.10 Where it comes from, what it rejects, what it costs

**Standard, and where from.**

| part | source |
|---|---|
| the viewer's taste as the truth, others as annotators | Dawid & Skene 1979 |
| knows-or-guesses channel with a base rate; chance weighting | MACE (Hovy et al. 2013); Aickin 1990 |
| signed reliability, flipping | Raykar & Yu 2012; Karger, Oh & Shah 2011 |
| log-odds weights | Nitzan & Paroush 1982 |
| pooled prior on a connection's agreement; per-topic shrinkage | Paun et al. 2018; Venanzi et al. 2014; Tang, Gao & Liu 2012 |
| thumbs before the viewer's as predictions | Resnick & Sami 2007 |
| no learning from the viewer's unrated things | cut models (Plummer 2015; Jacob et al. 2017); Tian & Zhu 2012 |
| trust multiplied along the strongest paths | TidalTrust (Golbeck 2005); Guha et al. 2004; MoleTrust (Massa & Avesani 2007) |
| a region as one voice, as a logarithmic pool | Clemen & Winkler 1985; Genest & Zidek 1986 |
| clip per thumb | Huber 1965 |
| significance of a pair | spike-and-slab with an empirical-Bayes mixing weight; Efron 2001 |

**Proven** (`docs/witness-model.md`): chance weighting and flipping, as consequences of the channel; a
chain is never more reliable than its weakest link, for this channel; the region average is the exact
posterior under fully dependent sources; the bound of §2.5; a viewer with no history gets a score for
everything anyone reached rated; one thumb's bounded effect on whether a pair is used.

**Measured in simulation, not proven** (`docs/witness-model.md`, `docs/algorithm-notes.md`). Held-out
AUC on the mixed / spread / sparse / high-rank / realistic worlds:

| model | mixed | spread | sparse | high-rank | realistic |
|---|---|---|---|---|---|
| before the relay | 0.701 | 0.848 | 0.569 | 0.533 | 0.517 |
| relay | 0.781 | 0.826 | 0.677 | 0.526 | 0.568 |
| this model, prototype | 0.826 | 0.830 | 0.692 | 0.529 | 0.578 |
| … no chains | 0.659 | 0.729 | 0.583 | 0.515 | 0.518 |
| … later thumbs up to the head (unsafe, §2.4) | 0.847 | 0.843 | 0.700 | 0.536 | 0.591 |
| **this model, built** | **0.836** | 0.819 | **0.721** | 0.528 | **0.580** |

The prototype rows are the prototype's, on which every choice was made; it read the population
statistics over everyone reached and capped per-attribute reliability at the head only,
which the bound rules out (§2.2, §2.8). The built row is `docs/algorithm-notes.md` §3's, on a
slightly different sample of viewers (the "before the relay" row is 0.710 / 0.827 / 0.585 / 0.528 /
0.518 there). Chains are worth 0.01–0.17 of it and the starting point up to 0.05; the defences
against copying cost 0.013 on average, and buy the attack table of §2.5. Where taste splits by kind,
per-attribute reliability adds −0.003 to +0.002 (§2.8). The pair rule, cold start and certainty as
above.

**What one recompute costs**, measured on the built core over a whole 2 000-person neighbourhood
(base rates, attributes, chains, scores and certainty), per viewer, median: 18–43 ms natively and
23–51 ms in WebAssembly under Node at 8–13 friends a person, against the relay's 24–50 and 35–71;
109 ms and 134 ms (worst 138) at 50 friends a person, against the relay's 52 and 75. Four such calls
fit well inside the CPU ceiling of §3.4. The cost is the chain links, one posterior per trust
connection explored; a 16-point grid measured no different from 64 and halves it.

**Original to grapevine, and unproven:** that multiplying learned reliabilities along chains is the
right composition (it measures well; it is not shown optimal); the two caps on own history; both
exposures, and a later thumb's discount from them; combining a trust-graph structure with a
probabilistic aggregation at all (no paper found does); the certainty `W/(1 + W)` (measured to track
correctness, not shown to be the right quantity), and the cautious value the bar draws from it (§1
"The bar"); one shared fact reliability; attribute pairs as witnesses under the same axiom.

**Rejected, and why**, beyond the alternatives measured in §2.2–§2.8:

- **A copier type** — an exposure-weighted mixture of "independent" and "copies nearly everything",
  with late disagreements held against the person — cannot be identified from a viewer's overlaps and
  punishes friends. A per-thumb reaction chance equal to exposure, symmetric in agreeing and
  disagreeing, carries what it was for (§2.3). There is no copy detection.
- **A Markov random field on reliabilities** has no data behind its coupling and lets bots raise
  their gatekeeper. Chains run outward only and are capped at the head (§2.4).
- **EM over the viewer's unrated things** is misspecified for taste and a collusion channel (§2.3).
  Facts, which have one answer, are where it belongs (§2.8).
- **A per-thumb cap alone** bounds one thumb, not a region. The region's average bounds a region
  (§2.4, §2.5).
- **Per-topic reliability on attribute thumbs**, shrunk toward a person's taste, reads a contrarian's
  "quiet" as "loud". Attribute thumbs are facts with their own reliability; kinds condition taste
  reliability only through the things that carry them (§2.8).
- **Low-rank correlations between all ratables** are unidentifiable per viewer and duplicate the
  people weighting (§2.8).
- **A fixed fade at every step**, as the relay has, fades every chain with its length whatever the
  trust along it. Chains here fade only with trust, and pooling per region bounds a region without
  any fade (§2.4).

**Measured on the built core** (`docs/algorithm-notes.md` §5–§7). *Incentives*: honest reporting has
the best held-out AUC on average (0.828, against 0.799 withholding half, 0.776 randomizing half, 0.772
inverting a quarter), but some misreport beat the truth for 14 of 60 targets, against the relay's 9.
*The accepted copier* — one account a victim accepted, copying all the victim's thumbs and promoting
one thing — scores it `+0.41` for the victim (relay `+0.51`) and past `+0.1` for 181 of the
victim's 322 friends (relay 4): a lone rater two steps out speaks for its region, slightly and inside
the bound. *A filled gap's certainty* barely separates right fills from wrong ones (0.336
against 0.308).

### 2.11 Attribute similarity: proposing attributes to apply

**What it is for.** The entity screen ends in a row of dashed chips headed *suggested* — the
attributes this viewer might want to apply to this thing. The problem it solves is that an
attribute nobody has ever put on a thing does not exist for it: §2.6 scores the tag ratables
that exist, and a viewer who would happily answer "is it *quiet*?" is never asked unless someone
in reach already asked it. The suggestion is the ask. It is not a recommendation and it is not a
score: a chip proposes a question, and the answer is the viewer's own thumb. It is computed by
`shared/src/suggest-attributes.ts`.

**It reads the viewer's own ratings and nothing else.** Not the neighbourhood, not the feed, not
any aggregate over anybody. This is stricter than the reach bound the rest of §2
works under, and the reason is an attack rather than a privacy rule: **if candidates came from
the network, somebody could poison your suggestions by rating the things you rate.** Drawing
only on your own vocabulary makes that impossible by construction. It also means the
computation runs **on the client**, since a viewer already holds their own ratings — no budget,
no server round trip, nothing taken from the recompute, and the row re-ranks the instant you give a
thumb.

**The consequence: it can only ever propose a word you have already used.** That is the feature
and not the limitation — you can type any attribute you like, so your own vocabulary grows on
its own, and the row is a convenience over words you have already chosen rather than a channel
through which new words arrive.

**The estimator: maximum coverage over your own history, chosen greedily.**

Let the viewer's history be the things they have rated, each carrying the attributes they rated
on it — **a thumbs-down counts**, because a chip asks a question and engaging with the question
is what makes the word yours, not the answer. For a candidate attribute `t`, let `U(t)` be the
things in that history carrying `t`.

For a thing the viewer has rated no attributes on, choose the suggestion set `S` to maximize

    V(S)  =  Σ_{i in history}  f( |{ t in S : i carries t }| ),    f concave, f(0) = 0

with `f = sqrt`. Add one attribute at a time, each time taking the one that raises `V` the
most: most-used attribute first, then whichever covers the most things the first one missed.
Because `V` is monotone and submodular, adding greedily is within `1 − 1/e` of the best set of
that size. The estimator is therefore derived, with a bound, rather than chosen.

**The concavity is what makes a special case unnecessary.** Once every rated thing carries one
of the suggestions, the useful next step is the things carrying only one, then two; a concave
`f` produces exactly that cascade at every depth on its own — covering something already covered
still helps, just less. With `f` linear the objective is just total usage and the suggestions are
near-duplicates; with `f` a step function it is plain coverage and it stalls once everything is
covered.

**Once the viewer has rated attributes on this thing, the history narrows.** Let `A` be the
attributes **the viewer themselves** has rated here — not every attribute shown on the screen,
which would let other people's ratings steer the row. Weight each thing `i` in the history by

    w(i)  =  |attrs(i) ∩ A| / |A|

and maximize the same `V` against those weights: a thing carrying two of the three counts two
thirds. Not `|attrs(i) ∩ A|` unnormalized, which lets a thing with many attributes dominate, and
never a filter — requiring a thing to carry *all* of `A` collapses to nothing after two
attributes. **The row holds at most five chips**, which is what fits two lines at the chip sizes
`web/DESIGN-UI.md` gives. Rating one more attribute re-ranks the whole row, which is free here
because the computation is local.

**No floor, and no quiet mode.** A viewer who has rated five attributes gets those five
proposed. The row is a convenience, not a claim, and the most-used-of-five is still a better
guess than an empty row. A viewer who has rated no attributes at all gets the heading over an
empty rail, never filler.

**What it must satisfy:**

- **No attribution, ever.** A chip says *suggested* and nothing more. Not "people like you", not
  "3 of your friends", not a source (§4).
- **No number is shown.** No bar, no count, no rank that reads as a score. Rank order within the
  row is allowed; it is what a list is.
- **It changes no score.** A suggested attribute the viewer ignores leaves the feed exactly as it
  was. Only a thumb moves anything.
- **Incentive-compatible by construction**, because it proposes questions rather than answers,
  and because nothing anybody else does can reach it at all.

The rule that a chip tapped but never thumbed creates nothing is §1's (item 4 of "The one view").

## 3. System design

### 3.1 Stack

Next.js static export on GitHub Pages, React, Tailwind, Biome, Bun for scripts and tests. The
backend is **Supabase**: Postgres with row-level security, PostgREST in front of it, GoTrue for
auth, Realtime for the two channels that have to feel live, and one Deno Edge Function for the
per-viewer work. **Nothing runs on a schedule outside the database** (§3.7). Repo layout:

    web/            Next.js app (static export). The only thing a user touches
    shared/         pure TypeScript used by web/ and the Edge Function: id
                    normalization, the search fold, search, attribute suggestions,
                    feed folding, the staleness rule, the neighbourhood cache's codec
    rust/           the one Rust crate, no I/O: the algorithm of §2, the simulator,
                    property tests; built to WebAssembly by wasm-pack
    supabase/       config.toml (auth providers and redirect URLs, in the repo),
                    migrations/ (schema, grants, policies, server-only functions, cron),
                    functions/, tests/ (pgTAP), seed.sql
    .github/workflows/  ci.yml, web.yml (deploy)

**Why a row store.** Everything in §2 is local: nothing needs global state, and every recompute
needs the viewer's neighbourhood. A document store bills that neighbourhood per document —
on Firestore, two reads per loaded node, up to `N_max` — so the cost of one recompute scales
with reach and the free tier is gone at about a hundred users. Postgres returns the same
neighbourhood as one query, and the cost becomes bytes moved rather than documents read. That
matters beyond the price: bytes compress and can be cut by reading fewer ratings (§3.8), where
documents per node is a floor nothing gets under. Holding the whole world resident in a
long-lived function, so that a recompute reads nothing, is the rejected alternative: it fights a
platform whose functions are short-lived, replaces a per-viewer cost with a per-instance one,
and scales with the size of the population rather than the size of a neighbourhood.

`rust/` is the only place the algorithm lives. It takes a snapshot in, returns results out, and
does no I/O, so `cargo test` runs the simulator and the property suites in seconds against
nothing. `scripts/build-wasm.sh` builds it for two targets: `web` for the Edge Function, which
Deno initializes from bytes it reads itself, and `nodejs` for `rust/examples/smoke.mjs`,
the one thing that runs the boundary outside Deno; CI builds both. Neither build is committed.
Rust rather than TypeScript because the per-viewer compute (§3.4) is on the request path under
a CPU ceiling, and the simulator runs thousands of synthetic worlds.

### 3.2 Postgres schema

Column names are `snake_case`; the client sees them through PostgREST under the same names.

```sql
profiles          (id uuid pk -> auth.users, display_name text, photo_url text,
                   created_at timestamptz)
friendships       (user_id, friend_id) pk, since timestamptz          -- both directions stored
invite_links      (owner_id uuid pk, token text unique, created_at)
                  -- at most one link per person; the token is readable by its owner only
items             (id text pk, search_id text not null, created_at, created_by uuid)
                  -- id IS the name; search_id is it with accents/punctuation stripped,
                  -- client-written from `searchFold`, its own text_pattern_ops index,
                  -- checked by a script rather than by a trigger (below)
ratings           (user_id, item_id, tag) pk, value smallint, rated_at timestamptz
                  -- rated_at leaves the database only as one bit per shared rating:
                  -- given after the reader's own thumb on it or not (§2.3, §3.4)
reports           (user_id, item_id) pk, created_at      -- insert only; nobody reads one
item_refs         (item_id pk -> items on delete cascade, source, ref, created_at,
                   created_by uuid), unique (source, ref)
                  -- insert only; a thing's link to Wikipedia (Wikidata's Q-id) or
                  -- OpenStreetMap (n/w/r and the id); no URL, description or position
user_recs         (user_id pk, computed_at, entries jsonb, feed_hash text)
user_model        (user_id pk, computed_at, checked_at, nodes_touched,
                   rating_count, recomputed, priors_at,
                   pair_n_d1, pair_n_d2, pair_n_d3,
                   pair_sum_d1, pair_sum_d2, pair_sum_d3,
                   pair_sumsq_d1, pair_sumsq_d2, pair_sumsq_d3,
                   pair_overlap_d1, pair_overlap_d2, pair_overlap_d3)  -- §2.9's tallies
private.params        (one row: computed_at, kappa, a0_d1, a0_d2, a0_d3plus, samples)
private.debug_events  (id, user_id, kind, detail, at, expires)
private.ratings_changed (user_id pk, changed_at, friends_changed_at)  -- trigger-written
private.ratings_cleared (user_id, item_id, tag) pk, cleared_at        -- trigger-written, §3.4a
private.snapshot_cache  (user_id pk, version, since, members uuid[],
                         reloads_in, blob text)                       -- §3.4a, service role reads
private.snapshot_epoch  (one row: epoch)                              -- bumped by every purge
private.write_budget  (user_id, day) pk, writes                       -- trigger-written
private.deleted_identities (fingerprint pk, day, writes)             -- §4, swept daily
private.removed_names (id pk, removed_at, purged_at)                  -- the owner's, §4
private.ref_sources   (source pk, pattern)                            -- one row per index
private.removed_refs  (source, ref) pk, removed_at                    -- links taken off, §4
private.admins        (user_id pk, added_at)                          -- written by hand, §4
```

- **`friendships` is the adjacency**, a join is the read, and a deferred constraint trigger
  makes a one-sided friendship impossible at commit. The core's own reciprocity check stays as
  defence in depth against a later schema change; it is free and nearly always vacuous.
- **One link per person, keyed by its owner.** `set_invite_link()` mints 32 random bytes as 43
  characters of base64url and writes them over the owner's row, so the old token stops working
  in the same statement; deleting the row turns the link off. The token is stored as itself,
  not hashed, because the owner has to be able to copy it again at any time: the select policy
  admits the owner's own row only, so a filter on `token` finds nothing that is not already the
  caller's, and `owner_id` is in no select grant. What that gives up against a hash is that a
  copy of the database is a copy of everyone's links — and whoever holds the database holds the
  friendships a link would make anyway. `invite_owner(text)` and `redeem_invite(text)` take the
  exact token and touch at most one row. There is no insert and no update grant: a token is made
  on the server.
- **A name is stored once.** No friend edge carries a copy of anybody's name or photo: a friend
  reads your profile under RLS (§3.3), so a rename is a change to the only copy.
- **An item's id is its display text, and there is no `tags` table.** `items` holds `id`,
  `search_id`, `created_at` and `created_by`; the grants are `insert (id, search_id)` and
  `select (id, search_id)`, so the client writes both, from the one `searchFold` in `shared/`,
  and `created_at` and `created_by` are the server's. A tag has no row anywhere: it exists
  because somebody rated it. `"Late Night"` normalizes to `late night`, which is what a person
  would write and what every screen shows.

  What that costs is the creator's capitalisation, everywhere: `"Café Bleu"` is stored and
  shown as `café bleu`. §1 "The one view" puts the whole interface in lower case, so a stored
  capital would be a spelling nothing renders, and dropping it removes a second field per name,
  the rule that would keep it immutable, a client cache in front of it and the branch where a
  name is missing. An entry in the feed carries its id and that is its name, so there is
  nothing to look up. An item with no `items` row can appear in a feed — a ratings row can name
  an id nobody created — and that is harmless, because the id has been through the same folding
  and the same `CHECK`s the catalog holds and renders as the same plain text. `items` is the
  catalog: what creation spends a write budget unit on, and what the prefix search over things
  nobody in reach has rated reads.
- **A link is `(source, ref)`, never a URL.** `private.ref_sources` holds each index's id
  pattern — the same text `SOURCES` in `shared/src/references.ts` compiles, which its tests
  check — and a trigger refuses an id that does not match it, so no stored id can hold `/`,
  `?`, `#` or `:` and the client builds the link by putting the id into a fixed address. A new
  index is a row there and an adapter, not a schema change. One link per thing, one thing per
  link; insert only, one write spent, `created_by` unreadable as on `items`, and gone with the
  name through the cascade. **No coordinates are ever stored**: OSMF's Geocoding Guideline
  counts names and ids without them as no substantial extract, so no share-alike offer is
  owed, and a result shown later owes no attribution either (§1 item 2). A stored position
  would change that.
- **Who created an item is never readable**: `created_by` has no `SELECT` privilege. It is also
  the one reference to a person that does **not** cascade from `auth.users`: `on delete set
  null`, because a thing's name is shared, permanent and pointed at by everyone's ratings, so the
  row has to outlive its creator. Null there means "added by an account that is gone"; any other
  `on delete` action would make an account that ever added a thing impossible to delete.
- **The feed is one row.** `entries` is one jsonb column, written in one statement, TOASTed out
  of line. `feed_hash`, the rounded feed signature, is what stops a recompute that landed on the
  same answer from moving `computed_at` (§3.4).
- **An entry is a score and a certainty.** Each item's entry is `{ itemId, score, conf, tags }`:
  `score` is `s_u`, `conf` is `W` (§2.6: how many of the viewer's own thumbs the evidence amounts
  to), and `tags` maps each attribute to its score alone. Every rated thing in reach has one (§2.6:
  no floor); a thing carried only by an attribute of it has `score` and `conf` zero. The client
  draws and ranks by one value made of the two (§1 "The bar") and never renders either as a
  number. The row grows with the number of distinct things rated within reach, which
  at `N_max` can reach hundreds of kilobytes (§3.8).
- **`user_model` is the recompute's own scratch row, with no client verb of any kind.** It holds
  the two stamps of §3.4; `nodes_touched` (the people the core reached with a non-zero chain),
  `rating_count`, `recomputed` and `priors_at`; and §2.9's twelve `pair_*` tallies. Nothing about
  any other person is kept in it between calls (§3.4, §4): every reliability is recomputed from
  the snapshot.

Three things the schema says directly:

- **There is no column for an email address or a phone number**, so there is no key to park one
  under. A contact detail exists in exactly one place, the auth account, in a schema the API does
  not serve and no policy exposes — which is a narrower claim than "it is not in the database",
  and is the one worth making.
- **A rating's value is validated, and its key is columns.** One row per thumb means
  `check (value in (1, -1))`, and the thumb is keyed by `(user_id, item_id, tag)` — `tag` **not
  null**, with the empty string meaning the thing itself rather than one of its attributes. Each
  field carries the id `CHECK` on its own, and `tag` carries it or is empty. The sanitizers on
  both sides of the wasm boundary stay — they are what protects a recompute from a schema change —
  and they check the two fields separately.

  **Inside the core one map key per rated thing is still wanted**, and the two fields join
  there with a **NUL** (`\0`): `café bleu` for the thing, `café bleu\0coffee` for one of its
  attributes. Postgres text cannot contain a NUL at all — the server refuses the byte on input
  — so no name anybody can type can forge the join or smuggle a second separator into a half,
  which matters because an id is any script's letters and punctuation and no pattern could
  enumerate what a half may contain. The join is the core's and the wasm boundary's; it is never stored, never queried
  and never shown.
- **A thumb carries its own clock.** `rated_at` is 8 bytes on a row the neighbourhood query does
  not select. It is written from the first day because history cannot be backfilled, it is the
  time the thumb was *given* — turning one over moves it — and nothing reads it. It is not the
  staleness probe: a flip lowers no maximum and a clear leaves no row, so "have this viewer's
  thumbs changed?" is `private.ratings_changed`, one row per viewer that a trigger on `ratings`
  moves on every insert, delete and real change of value, and a trigger on `friendships` moves
  for each end of an edge that comes or goes. **Nothing in the UI surfaces either**, and §4 is
  written so that it does not have to: reconstructing a rating order from the column takes full
  database access, and anyone holding that already holds every rating. Surfacing it is a change
  with its own decision, and whoever makes it revisits the privacy page.

**Normalization.** One folding, in `shared/` and nowhere else, applied to an item id and to a
tag alike:

    lowercase  →  NFKC  →  collapse every whitespace run to one space  →  trim

and that is the whole of it. The NFKC comes **after** the lowercasing because lowercasing a
normalized string is not guaranteed to leave it normalized, and the last step has to be the one
whose output the column `CHECK` is about to test. `"Café  BLEU "` is `café bleu`, and a script
with no Latin in it survives intact — `日本` is `日本`.

**What is refused**, by the folding, by every caller and by the column `CHECK` as the second
copy:

- **Empty.** After trimming, an id of zero length. Every caller refuses it rather than writing
  it.
- **Anything off the allow-list** (migration `0008`). An id is ordinary letters, numbers and
  punctuation, following Unicode's own guidance for identifiers (UTS #39 and #31):
  - *Characters*: UTS #39's `Identifier_Status=Allowed` — the letters, combining marks and
    digits of the scripts in everyday use, with the historic, liturgical and specialist ones
    left out — plus the space, `! " # $ % & ( ) * + , / ; ? @`, `¡ ¿ « » – — ‘ “ ” „`, the CJK
    comma, full stop and brackets, the Arabic comma, semicolon and question mark, the Indic
    dandas, and `€ £ ¥` beside `$`. Nothing else: no emoji or pictograph, no other symbol,
    nothing invisible or default-ignorable (zero-width space, soft hyphen, variation selectors,
    tag characters), no control, format, private-use or unassigned code point. The
    bidirectional overrides are among what this refuses: one of those in a name reverses the
    rest of the row it is drawn in. And no NUL, which the core's own join depends on never
    seeing.
  - *Combining marks* sit on a letter or a digit, at most four on one (Burmese, the deepest
    ordinary case, puts four on a consonant), and never the same mark twice in a row: stacked
    marks draw over the rows above and below, and a doubled one looks like a single one.
  - *ZWJ and ZWNJ* (`U+200D`, `U+200C`) only where RFC 5892 allows them: after a virama, and
    ZWNJ also between two letters that would otherwise join. That is where Persian and the
    Indic scripts need them to spell ordinary words; anywhere else they are invisible.
  - *One script per word*, UTS #39's "moderately restrictive" level applied to each
    space-separated word: a word is one script (with the digits, punctuation and marks every
    script shares), or Latin plus one other script that is not Cyrillic or Greek, or Latin
    with Han and the kana, Han and Bopomofo, or Han and Hangul. `café кафе` and `tokyo 東京` are
    names; `cаfé` with a Cyrillic `а` is not, because Cyrillic and Greek are where Latin's
    look-alikes are.

  The list is generated from pinned Unicode data (15.1, the version Postgres 17's
  normalization knows) by `scripts/generate-name-rules.ts`, which writes the tables the client
  reads and the migration the database runs, and `shared/src/name-rules.ts` turns the same
  tables into the same regular expressions for both engines. Neither uses Unicode property
  classes: the client's follow its engine's Unicode version, and Postgres has none. Changing the
  list is a new migration that, like `0008`, refuses to apply over an existing id it
  would refuse, since Postgres does not re-check old rows and an id cannot be renamed.
- **A word that starts with `!`, `#` or `@`** (also `0008`). Search reads each as an operator
  (§1 "Search"), so a name with a word like that could not be found by typing it. Anywhere else
  in a word they are punctuation: `yahoo!`, `c#`.
- **Anything that is not NFKC-normal.** `id is nfkc normalized` is a Postgres predicate, so the
  `CHECK` states this directly rather than approximating it with a pattern. It is what makes
  the id canonical: there is one byte sequence per name.
- **Over 128 characters**, counted in code points. The folding **refuses** rather than
  truncating — a cut at 128 can land inside a grapheme cluster or denormalize what it just
  normalized, and a silently shortened name is a different thing from the one somebody typed.
- **Leading or trailing whitespace, and any doubled space**, which the folding cannot emit and
  the `CHECK` therefore refuses.

Two lowercasings exist and they are two implementations of the same Unicode table: the
client's (`toLowerCase`) and the database's (`lower`, under a collation that is not `C`). They
can disagree on a handful of characters, and where they do the database is the authority,
because its `CHECK` is what decides whether the row exists.

**The catalog carries a second copy of every id with the accents and punctuation stripped off,
and that is what search matches against.** `search_id` — `cafe bleu` beside `café bleu` — has its
own `text_pattern_ops` index, so typing `cafe` finds `café bleu` in the catalog and not merely in
the feed the viewer already holds. Two alternatives are rejected:

- *Stripping only at query time* leaves the catalog's prefix search literal, so a viewer who
  types the unaccented name finds nothing, adds the thing again, and **splits the catalog** — a
  duplicate nothing in v1 merges (§1 non-goals) and that every later rating is then divided
  between.
- *A trigger computing the column* would put the stripping rule in SQL as well as in
  `searchFold`, where the two can disagree and a disagreement makes a row unfindable by its own
  name. (It could not be a generated column either: accent-stripping in Postgres reads a
  dictionary and is not `IMMUTABLE`.) So **the client writes `search_id`**. What a client gains
  by lying is a thing that turns up when somebody searches for a name it does not have; that is
  already available by naming the thing misleadingly, and a search result renders the real id,
  so the lie is visible the moment it is read.

What holds the two columns together is therefore a **check, not a constraint**: a script reads
`items` and asserts `search_id = searchFold(id)` for every row, using the one implementation.
It catches the app breaking its own rule, which is the real failure. `items` has no `UPDATE`
grant for anyone, so neither column moves after insert.

`search_id` is not a second identity. The id remains the key, the thing rendered, and the only
value any rating points at; `search_id` is an index into the catalog and is shown nowhere. Two
different things may share one, which is a search result with two rows in it and not a collision.
The primary key's own `text_pattern_ops` index serves the literal prefix and is not optional —
the collation is not `C`. Inside the feed, which is where most searching happens, the match is
done in memory and needs neither.

**Unicode admits strings that look identical and are not.** Latin `a` (`U+0061`) and Cyrillic
`а` (`U+0430`) survive NFKC as different characters, so `café bleu` and `cаfé bleu` would be two
items that no reader can tell apart. NFKC removes the compatibility cases (`ﬁ` is `fi`,
full-width is half-width); the confusable cases it leaves. One script per word refuses the
mixed spelling outright, but a word written wholly in Cyrillic can still imitate a Latin one
(`рор` is three Cyrillic letters). The mitigation for what is left is a **confusable
skeleton** (Unicode TR39: map each character to its representative, then compare) used for
lookup and duplicate detection — the search that finds a near-match compares skeletons too, so
someone who types the ordinary spelling sees the look-alike among the results and the person
adding a second one is shown the first. In §2.1's terms, this is bounded and not prevented:
nothing stops a determined account creating a homograph of an existing thing, and if nobody
searches for it nothing will surface it. What it buys is that the accident — two honest people,
two keyboards — is caught, and the attack costs a write budget unit per name and gains a
duplicate catalog row rather than anybody's ratings. The remedy if it is ever used in anger is
the one §4 plans for a misleading name: report and hide, per viewer and then operator.

### 3.3 Row-level security

Five conventions:

- **Schema isolation.** Anything no client may touch lives in schema `private`, which is not in
  PostgREST's exposed list — not a policy that can be got wrong, an address that does not exist.
  The params row, the diagnostics table, every policy helper, the neighbourhood loader and the
  neighbourhood cache live there.
- **Column privileges.** `GRANT INSERT (id, search_id)` on `items`: a column the client cannot
  write takes its default, and a column it cannot select is in no response. This is what makes
  `created_at`, `created_by`, `since`, `rated_at`, `at` and `expires` unforgeable.
- **Table privileges.** "No update verb and no delete verb, for anyone" is a `REVOKE`.
- **A daily write budget, in the database.** Every rating insert or update, every item created,
  every link turned on, replaced or redeemed, every report and every diagnostics event draws on one allowance per account per
  UTC day, a number written once, in `private.daily_write_limit()`; deletes draw nothing. A
  `security definer` BEFORE trigger counts against `auth.uid()` in `private.write_budget` and
  refuses the write past the allowance with SQLSTATE `PT429`, which PostgREST serves as HTTP 429
  and the client says in a sentence with no number in it. The client cannot be what holds itself
  to this, since a crafted client is the case a budget exists for. A
  connection with no request identity — the Edge Function, which writes none of those tables —
  is not counted, and a scheduled statement deletes past days.
- **No policy reads another table directly.** Every cross-table predicate goes through a
  `security definer stable` helper in `private` — today only `is_friend` — so RLS never nests
  and never recurses. Policies say `(select auth.uid())`, never bare
  `auth.uid()`, so the planner evaluates it once per statement instead of once per row.

The policies themselves are short. A profile is readable by its owner and by a friend, and by
nobody else: a link's holder sees the owner's name and photo through `invite_owner`, not through
the table. An invite link is readable and deletable by its owner alone (§3.2). Friendships and
ratings are readable by the people they are about; a rating is writable by its owner, and a
friendship is deletable from either end and insertable by no client at all — `redeem_invite`
writes both halves. `user_recs` is readable by its owner and writable by nobody, since the Edge
Function writes as `service_role`, which bypasses RLS. `user_model` is readable by nobody at
all, so agreement never leaves the server. Items are readable by every signed-in user and
creatable by them, with no update and no delete for anyone but the owner's `remove_name`. A
report is insertable by its author and readable by no client; an admin sees how many each name
has, through `reported_names()` (§4).

**The whole of what a client may call**, and it is short, because a stored procedure here is a
transaction rather than a server: `set_invite_link()` (after `has_credential()`; mints a token
over the caller's one link and returns it), `invite_owner(text)` (the name and photo behind one
exact token, or nothing; the one call `anon` may make, since the link is the authority to see
them), `redeem_invite(text)` (after `has_credential()`; spends one write
whether or not the token matches, then writes both friendship rows — `security definer`,
because it writes the owner's half of the edge, which the owner authorized by handing the link
over, and the caller by saying yes), `record_debug_event(text, text)`, which is the only write
verb on a table in `private` and supplies none of the three columns it stamps, an INSERT of
one name into `reports` (§4), `account_locked()` (§3.6; whether the caller has no connection),
`account_is_admin()`, `reported_names()`, `remove_reported_name(text)` and `dismiss_reports(text)`
(§4; each answers only an admin), `my_feed()` (the caller's own `user_recs` row, less any name
removed since it was computed, §4),
and `delete_account()` (§4), which takes no argument and deletes the caller's own `auth.users` row.

Two triggers complete the schema and neither is callable: `handle_new_user()` on `auth.users`
creates the profile row in the same transaction as the account, so "the profile is missing"
cannot happen for a signed-in user; and `assert_symmetric()`, deferred to commit, is what makes
a one-sided friendship impossible. The policy helper is the rest of schema `private`, alongside
the loaders (`neighbourhood`, `neighbourhood_cut`, `load_nodes`) and the cache's functions
(`snapshot_delta`, `save_snapshot_cache`, `drop_snapshot_caches`), which only the service role may
execute.

**Two hazards are permanent.**

*Enumeration is the default.* A clause that authorizes reading a row authorizes reading every
row it matches, so any clause on `profiles` that does not name a live relationship — a public
flag, a "has a link" — would authorize `select * from profiles` for everybody it matches, a
global aggregate this app does not otherwise have and which §4 says it will not have. So no such
clause is in the policy. The one read of somebody with no edge to the caller lives inside a
`security definer` function in `public` that takes an exact key and returns at most one answer:
`invite_owner(text)`, keyed on a 244-bit token and answering with a name and a photo only. A
pattern, a prefix or an unbounded limit in its body is the enumeration it exists to prevent, and
the same care is owed anywhere a policy clause looks tempting.

*Postgres grants `EXECUTE` on a new function to `PUBLIC` by default.* `private.neighbourhood`
returns the raw ratings of up to `N_max` people, and `load_nodes` and `snapshot_delta` the same
kind of rows, so a `grant execute` on any of them, or moving it to a schema PostgREST serves, hands
every viewer the ratings of everyone in reach and breaks
§4's "nothing about another user is ever computed on a client". Schema isolation is the
mitigation; every migration is read with this in mind.

**One check is kept although it is currently vacuous.** `has_credential()` — an account that is
not anonymous and carries a confirmed email, a confirmed phone or a Google identity — gates
two things, making a link and redeeming one, because a link makes friendships in its owner's
name and a redeemed one is a friendship nobody should hold from an account nobody can sign back
into. With Google as the only door every session passes it by construction. It stays because
the thing it guards against is a dashboard toggle rather than a code path: enabling anonymous
sessions or a second provider is a two-click change that ships no diff and passes no review, and
it would silently let accounts nobody can prove ownership of mint and answer links. Every
other check in this design guards against a client; this one guards against us.

### 3.4 Computation: per viewer, on open

**The neighbourhood is one function call.** `private.neighbourhood(viewer, max_nodes, max_depth)`
is a `WITH RECURSIVE` breadth-first walk carried in two arrays — the seen set and the current
frontier, one row per level — joined to `friendships` and `ratings`, one row per loaded person
(`id`, `friend_ids`, `ratings`), which the Edge Function assembles into the `{ users, friendIds,
loaded, ratings }` shape the wasm boundary takes. Since a rating is
keyed by columns (§3.2), a node's `ratings` come back **nested**, item to tag to value, with `""`
for the thing itself: `{"café bleu": {"": 1, "coffee": -1}}`, one inner `jsonb_object_agg`
grouped by item under the outer one grouped by node. Nested rather than an array of
`[item, tag, value]` triples because it writes each item id once, and egress is the scarce
resource (§3.8); not NUL-joined because Postgres text cannot hold a NUL, so the join happens in
the boundary wrapper on the way into wasm, which is the only place that wants a single key. The
set-at-a-time form is not a flourish: a node-per-row recursion cannot express a global row cap,
because `limit` on the outer select relies on demand-driven evaluation to stop the recursion,
which is an implementation detail and not a contract. Arrays of at most `N_max` uuids are tens
of kilobytes and `user_id = any(frontier)` is a bitmap index scan.

The node cap is the real bound and it is hard: the recursion stops the moment the seen set
reaches `N_max`, and the slice that cuts the crossing level is deterministic because each
level's ids arrive sorted. The depth bound is a backstop against a pathological low-degree
component spending unbounded recursion steps to reach `N_max`; at degree 15 the node cap binds
at depth 3, and the depth bound must never be small enough to become the thing that fires,
because a chain costs nothing for its length but the trust it takes (§2.4).

**Each rating carries one bit about time.** A rating comes back as `±1`, or as `±2` when it
was given after the viewer's own thumb on the same thing (0015): the order relative to the viewer
and nothing else — never `rated_at` itself — which is all §2.3 reads and costs almost no egress.
`load_nodes` takes the viewer for the same reason. A tag rating arrives the same way, so the
attributes a thing carries (§2.8) come with the ratings and need no read of their own.

The boundary set falls out for free: everyone named by a loaded node who is not themselves loaded is
a boundary node, with no adjacency and no ratings, and the core reports each one's **strength** —
the strongest chain a loaded neighbour could pass on to them, `|chain(w)|·|2a₀ − 1|`, the viewer
counting as a chain of one. Up to three extra rounds read the strongest 200 of them against an
explicit id list (`private.load_nodes`), one call a round, while `N_max` has room and some boundary
node has a strength above zero; a person no chain can reach is never worth a read. `N_max` counts
every node a recompute loads, rounds included. It does not bound reads so much as memory, CPU and
egress, and egress is the scarce resource (§3.8); it stays where it is for the CPU ceiling.

**The recompute is one Edge Function**, `refresh-recs`, called by the client on open and on
demand:

    verify the caller's JWT with GoTrue        -> uid, and from nowhere else
    read now(), user_model (computed_at, checked_at), user_recs.feed_hash,
         private.ratings_changed, the cache's purge epoch
    staleness rule (keyed on checked_at, set or not)
                    -> if the answer still stands, return it without computing
    read private.params
    load the neighbourhood (§3.4a)             -> the cached one patched by
                                                  private.snapshot_delta, or in full by
                                                  private.neighbourhood: at most N_max people
    computeUser(snapshot, uid, params)         -> §2's scores and certainties
    up to 3 x private.load_nodes(uid, ...)     200 boundary nodes a round, strongest first,
                                                  then computeUser again
    fold to one entry per item, hash the feed
    unchanged hash -> stamp checked_at only;   otherwise write user_recs and user_model
    either way, in the same transaction, write the neighbourhood cache
    return { computedAt, recomputed, entries }

**`computeUser` is one pass over what was loaded** (§2.10): base rates, chains, reliabilities,
scores and certainty, and nothing iterates to a fixed point. **Every recompute produces a feed**:
there is no accuracy test for it to fail, so the only way not to have one is an error — a
non-finite score or certainty, which the core refuses and the function refuses again before the
write — and that is a `500` with the stored row left as it was. **Nothing the core computes about
anybody is kept between calls** (§4): every step reads ratings, so every reliability is recomputed
from the snapshot and nothing derived can go stale. What is kept is the snapshot itself, the core's
input (§3.4a).

**Two stamps, not one.** `checked_at` is stamped by every recompute, including one that found
nothing new, and is what the ten-minute staleness window keys on, so an idle viewer pays one
recompute per window rather than one per open. `computed_at` moves only when a reader would see
something different, which is what the feed hash decides. A viewer whose thumbs changed since
the last *check* always recomputes — compared against `checked_at`, not `computed_at`, or a thumb
that did not change the feed would force a recompute on every later open — and that is one primary-key
read of `private.ratings_changed`. Every stamp the recompute writes is the database's `now()`,
read before the neighbourhood is: the function's own clock afterwards would date a thumb
given mid-recompute as already read.

**The neighbourhood is read in full only when it has to be** (§3.4a): the loaded snapshot is
cached per viewer and patched with what changed since, which is exact because it is data. Applying
deltas to the model's *numbers* — `entries` or any reliability — is deliberately not built: almost
nothing in the model updates exactly from a delta, and an approximation drifts with no bound.

**Every query runs as `service_role`, and says so.** The connection logs in as `postgres`, and a
`role` startup parameter does not survive Supavisor, which forwards only `search_path`. So each
transaction opens with `set local role service_role` and checks `current_user` before doing
anything, which is what makes the grants in §3.3 the rights the function actually has. The
gateway's JWT check is off (`verify_jwt = false`); the GoTrue call above is the only thing that
refuses an unauthenticated request, and it refuses before any query.

**The feed is returned inline and also stored.** Inline because the function has the entries in
hand and returning them saves a second round trip; stored because a cold start and an offline
open need a row to read. Nothing else writes that row, so the one Realtime subscription on it covers exactly one case —
another tab or device of the viewer's own having called the function — and its payload *is* the
change.

**The CPU ceiling is the real constraint.** A free Edge Function is metered on the order of two
seconds, and one recompute may call the core up to four times — the first pass and three boundary
rounds. A whole `computeUser` over a full `N_max` measures 18–43 ms natively and 23–51 ms in
WebAssembly at 8–13 friends a person, and 109 and 134 ms at 50 (§2.10); at degree 15 and 100
ratings a person, crossing ~23 000 rating entries into wasm is a cost of the same order.
Headroom is real but not generous and it shrinks linearly in ratings per user. `N_max` stays where
it is although Postgres would happily return ten thousand nodes: the CPU ceiling is why we do not
ask. If it binds, the knobs, in order: take fewer boundary rounds; lower `N_max`; and only then
reopen the boundary, by handing the core a JSON string to parse inside wasm instead of a JS object.
The last is a change to the core's signature and is deliberately not taken.

**There is no background sweep of feeds.** A viewer's feed is recomputed when that viewer opens
the app and at no other time: a sweep would spend CPU and egress on viewers who may never open it,
and a recompute is cheap enough that amortizing it buys nothing. If a warm feed turns out to be worth
having, it comes back as a queue drained in slices, which is the right shape for a small
per-viewer cost.

### 3.4a Incremental recompute

> **Status: built** (migration `0016`, `shared/src/snapshot-cache.ts`, `refresh-recs`). It keeps a
> private copy of each viewer's neighbourhood, which §4 states. Measured on the prototype of §2;
> the numbers below are the prototype's unless they say they are the build's.

**The question.** Without a cache a refresh reads the viewer's whole neighbourhood every time: up to
`N_max = 2 000` people's friend lists and ratings, which is the dominant cost on the free tier,
because every byte the Edge Function reads through the pooler is egress. Can a refresh keep state and
read only what changed? The computation itself is small (18–24 ms natively over 2 000 people on the
realistic world, §2.10), so the goal is reading less, not computing less.

**Answer: yes for the model's input, no for its numbers.** Caching the *loaded snapshot* and patching
it with what changed is exact, because it is data: the patched snapshot is the snapshot a fresh load
would return, and the unchanged core runs on it. Caching the model's *sufficient statistics* and
updating them from deltas is not worth building: almost nothing in the model is local.

#### What the model computes, and what one event invalidates

| quantity | depends on | updates exactly from a delta? |
|---|---|---|
| reached set, hop distances, exposures `1/deg`, upstream degrees | the friend graph only | yes, but any friendship change in reach can move the `N_max` cut |
| base rate counts `(up, total)` per ratable | every reached person's thumbs | **yes**: integers, `±1` per insert, flip or clear |
| a reading (agreed, chance, exposure) | the two thumbs, the order bit, the base rate of that thing **with both left out**, a degree | yes as integers — but it changes whenever *anyone* rates that thing |
| direct reliability `λ_f` | the readings on everything viewer and `f` both rated | no: a posterior over a grid, re-integrated whenever any reading moves |
| chain link `λ_{w→v}` | readings on things `w` rated | same, and a link moves whenever anyone rates something `w` and `v` share |
| chain, region | every link on the strongest path; a max over paths | no: a max-product path; one link can move the strongest path of everyone behind it |
| own-history reliability | the chain (as prior mean) and the viewer's readings | no: follows every chain above it |
| region evidence `E_f(x)`, starting point, certainty | every rater of `x`'s reliability and `b_x` | no: `LLR` is nonlinear in `λ`; the starting point takes a max per region |

So a single thumb on `x` by anyone in reach moves `b_x`; that moves a reading in every posterior where
two people both rated `x`; a moved `λ_f` scales every chain in `f`'s region; and every chain is the prior
of that region's own-history reliabilities, which weigh every thing those people rated. Measured on the
realistic 2 000-person world (two seeds, 20 viewers, 8 single events each):

- one other person's thumb moves some reliability 54–58% of the time, and more than half of all
  reliabilities 4% of the time; it changes someone's region 1–6% of the time;
- an exact update would have to read 6–7% of the neighbourhood's rating rows for **each** event (the
  ratings of everyone whose reliability moved, and every rater of the thing), and all of them 2% of the
  time; a refresh sees hundreds of events (below), which together cover nearly all of it;
- the cheap approximation — freeze every reliability at the last full recompute and rescore only the
  things rated since — reads 1–3% / 16% / 38% of the rows after 10 / 100 / 500 events, but its largest
  score error is 0.002–0.004 for the median viewer and up to 0.31 after 10 events, **0.22** for the
  median viewer after 100 and 0.33–0.36 after 500 (a score is in `(−1, 1)`): a stale bar, with no bound.

Every event type, then:

| event | what it invalidates |
|---|---|
| the viewer's thumb given, flipped or cleared | the order bit of every other thumb on that thing; `b_x`; every direct and own-history reliability that shares `x`, so every chain and every score |
| a thumb in reach | `b_x`; every reading on `x` (the viewer's history with each rater of `x`, and every explored link whose ends both rated it), so usually some reliability, and then every score its region touches |
| a new or removed connection in reach | degrees and exposures of both ends, possibly which people are loaded (the cut), every strongest path through either end, regions |
| an account deleted | its thumbs (as clears), its connections (as removals), and the loaded set |

The snapshot cache handles all four the same way: it applies the change to the input and reruns
everything, which is what makes it exact.

#### What is built: cache the loaded snapshot, read what changed

**What is kept, where.** Edge Functions have no persistent disk, so the cache is a table in `private`,
one row per viewer. The service role may read it and nothing else; it is written only by
`private.save_snapshot_cache` and deleted only by the purges and the sweep, all `security definer`:

    private.snapshot_cache (
      user_id     uuid primary key references public.profiles (id) on delete cascade,
      version     int  not null,         -- the codec and the rules below; a mismatch reloads
      since       timestamptz not null,  -- the watermark the blob is exact as of, and last use
      members     uuid[] not null,       -- who is loaded, for the delta and the purges
      reloads_in  int  not null,         -- refreshes until the next full check
      blob        text not null          -- the snapshot, compact, gzipped, seven bits a character
    )

The blob is a dictionary of the people named (16 bytes each) and the thing and attribute keys, then
each loaded person's friend list and thumbs (each with the one order bit, as the neighbourhood
returns it) as varint indices into it, gzipped by the function with `CompressionStream`. Its codec and
the patch are pure TypeScript in `shared/src/snapshot-cache.ts` with their own tests, so there is one
implementation, used by the function. It caches what `private.neighbourhood` returns and not the
boundary rounds (§3.4), which depend on the core's answer and are read every time; they add people
only when the depth backstop fired below `N_max`, which ordinary graphs never do.

**Two additions to the database**, because a patch needs to see every change and without them it
cannot see two:

- **A tombstone per cleared thumb**, `private.ratings_cleared (user_id, item_id, tag, cleared_at)`,
  written by a delete trigger beside the one that stamps `private.ratings_changed`, and guarded the
  same way on the profile existing, so a deleted account's keys leave none. A deleted row cannot say
  when it went (§3.2), and "thumbs written since" misses exactly those. Swept after 8 days by a cron
  job; the delta refuses a cache older than 7, which reloads in full.
- **A friendship clock**, `private.ratings_changed.friends_changed_at`, stamped only by the friendship
  trigger, so a delta reads a friend list only when it moved. Re-reading the friend list of everyone
  whose ratings moved costs four times as much at 500 events (below).

**The load step of §3.4**, in full; the staleness window, the two stamps and the feed hash are as
§3.4 says:

    read now() as the new watermark, and the purge epoch, before any data
    one call, private.snapshot_delta(viewer, version, N_max, depth), in one snapshot:
        no rows if there is no cache of this version younger than 7 days
        the blob and reloads_in
        the membership diff: the breadth-first cut (private.neighbourhood_cut, which
          private.neighbourhood also uses) rerun over the current graph against members,
          with the full rows of whoever it adds
        kept members whose ratings_changed moved since - margin, and for them
          thumbs with rated_at > since - margin (a flip moves rated_at), or with a newer
            tombstone (cleared and given again), with the order bit
          tombstones with cleared_at > since - margin and no row now
          the friend list, if friends_changed_at > since - margin
        the names removed since - margin (§4)
        and nowhere a thumb on a name awaiting its purge
    no rows, a blob that does not decode, or a delta naming someone the blob lacks
        -> private.neighbourhood (a full load)
    patch: drop tombstoned thumbs, upsert written ones, replace changed friend lists, drop and add
        members, drop every thumb naming a removed name; on every thing whose viewer thumb was written or cleared since, set the order bit
        of every thumb not rewritten since to "before" (it was given before `since`, so before
        the viewer's new thumb)
    reloads_in = 0 -> also load in full, compare (below), and use the full load
    computeUser on the result: the full core, unchanged
    write user_recs, user_model and, through private.save_snapshot_cache, the cache
        (blob, members, since = the new watermark) in one transaction

The cut stays in SQL: the function never reimplements it, it receives the diff. The delta never
refuses a cut that moved: whoever it adds comes whole, so there is no move too large to patch, only
one whose cost approaches a full load's.

**When a full load is still required**, and what it checks:

- no cache, a new `version` (bumped by any migration that writes `ratings` or `friendships` without the
  triggers, and by any change to the codec or the patch rules), or a cache older than the tombstone
  sweep;
- **every hundredth refresh** (`RELOAD_EVERY`), as a safety check: load in full, compare the canonical
  patched snapshot against the fresh one, log a `debug_events` row (counts only) on a difference, and
  use the fresh one. A difference is a bug or a missed stamp, never drift: there is no arithmetic to
  drift. Why a hundred and not a clock: at §3.8's activity an active viewer refreshes about three
  times a day, so "once a day per viewer" would be a full load every third refresh, about 1.4 MB a
  refresh on average, where one in a hundred is 41 KB. What the check is for is finding a bug, and a
  bug in the stamps or the patch is systematic, so it is found across viewers rather than per viewer:
  at a thousand users the checks run about six times a day, and the first mismatch is the alarm. The
  price is that one viewer's patched feed can sit on a bug for up to a hundred of their refreshes —
  about a month for the most active — and a cache unused for a week reloads in full anyway;
- account deletion drops caches (below). A removed name does not: the delta names it (§4).

**Exactness.** A patched snapshot equals a fresh load when every change after the watermark is seen.
Measured: 160 patches (two seeds, 20 viewers each over a 5 000-person world cut at 2 000, 10 to 2 000
events of every kind — new thumbs, flips, clears, the viewer's own, connections made and removed —
between refreshes), each compared field by field with a fresh load: **0 differ**, both with whole rows
re-read and with thumbs and tombstones only; feeds from both agree to 1e-9 (the prototype sums through
hash maps; the built core sums in a fixed order and is bit-identical on one snapshot, §2). What can
break it, and the guard:

- *A write that commits after the watermark but was stamped before it* (`now()` is the transaction's
  start). The delta reads from `since − margin` — a re-read change is applied as its current value, so
  overlap is harmless — with a margin of a minute; PostgREST writes are single short statements. The
  exact alternative is stamping `pg_current_xact_id()` and keeping `pg_snapshot_xmin` as the
  watermark, if a margin ever proves too small.
- *A write that bypasses the triggers* (a restore under `session_replication_role = replica`, a
  migration rewriting rows): bump `version`.
- *A decoder or patch bug*: the periodic check, which reports it and heals it. The tests
  (`shared/tests/snapshot-cache.test.ts`) repeat the same check against a model of the
  database — thumbs, flips, clears, clears given again, the viewer's own, connections made and
  removed, account deletions — patching the decoded blob each time and comparing it with a fresh
  load, and `supabase/tests/29_snapshot_cache` checks the SQL delta returns what the model assumes.
- *A refresh that read before a purge and writes after it*: an account deletion
  deletes caches, but a refresh already holding the old data would write it back. Every purge bumps
  `private.snapshot_epoch` under an exclusive advisory lock; the save takes the lock shared and
  writes only when the epoch is the one the refresh read before any data. A purge waits for saves in
  flight and then sees their rows; a save after it refuses.

**What it saves**, measured (realistic world of 5 000 people, a viewer's
load cut at 2 000; median over 20 viewers, two seeds; events drawn in proportion to how much people
rate, one in fifty by the viewer, 70% new thumbs, 15% flips, 10% clears, 5% connections made or
removed):

| per refresh | read |
|---|---|
| no cache: the whole neighbourhood, in its text wire shape | **4.1 MB**, about 82 000 rating rows |
| no cache, the same rows as integer arrays over one dictionary | 1.15 MB |
| cached blob, read every refresh (prototype codec) | **294 KB** (the text shape is 9.8 times the uncompressed blob) |
| + delta after 10 / 100 / 500 / 2 000 events, thumbs and tombstones, friend lists only where changed | 0–1 / 7–11 / 48–56 / 281–334 KB |
| … the same, re-reading whole rows of everyone whose clock moved | 16–20 / 153–165 / 721–730 / ~2 000 KB |

Rows read inside Postgres fall from ~82 000 to a few hundred. The cost at 500 events has a tail (up to
1.25 MB) when a new connection brings people into the cut, whose rows are read whole. How many events
fall between one viewer's refreshes: at §3.8's activity (a fifth of people active a day, three
recomputes each) and, say, five thumbs per active person, 2 000 people in reach produce about 2 000
events a day, so a few hundred between refreshes. **So about 350 KB against 4.1 MB, twelve times less,
and most of the saving is the compact, compressed blob; the reading-only-what-changed part is what lets
the blob be read at all.**

Against the free tier (5 GB egress, 500 MB storage a month), with a viewer's load growing as
`min(U, 2 000)` people for `U` users, 2 KB a person in the text shape and 150 bytes in the blob, and
§3.8's 18 recomputes per user a month: egress breaks at **about 370 users** with no cache — a
two-hop reach of 226 people would put it in the thousands, but the cut fills to `N_max` — at about
700 with the integer-array shape and no cache, and at about 1 300 with the prototype's cache (the
build's is below). The cache's own
storage is `150 B × U × min(U, 2 000)`: 150 MB at a thousand users, **500 MB at about 1 800** — so
storage becomes the next line, just after egress.

**What the build measures.** The built codec (`shared/src/snapshot-cache.ts`), run on the same
neighbourhoods (the 40 of them — two seeds, 20 viewers, each 2 000 loaded,
about 4 900 ids named, 82 400 thumbs, 38 000 friend-list entries — as the rows `private.neighbourhood`
returns), gzips them to **235 KB**, 231–238, where a codec in the prototype's shape with the real
16-byte ids and attributes gives **328 KB** (the prototype's 294 had 12-byte ids and no attributes).
What it does: ids once, 16 bytes each (79 KB,
random, a third of the blob whatever is done); thumb keys once, most rated first; each column on its
own (counts, friend lists, keys, values), because gzip does better on like next to like; friend lists
and keys sorted and written as gaps; a friendship between two loaded people once rather than from
both ends, which reciprocity makes exact (a one-sided edge falls back to whole lists); values two bits
each.

Then the wire. postgres.js 3.4.7 asks for every result in the text format (its `Bind` sends no
result-format codes), so a `bytea` comes back as hex, twice its size, and `encode(…, 'base64')` a third
over. The binary format would take a second driver for one query (node-postgres has a `binary`
option); PostgREST can return raw bytes, but only from a schema it serves, which this table must never
be in; the Postgres protocol and Supavisor carry no compression. So the blob is stored as **text, seven
bits a character** (0 as U+0080, since text cannot hold a NUL): an eighth over, **269 KB** a refresh
(265–272).

So a refresh reads the blob, 269 KB; the delta, about 10 KB after a hundred events and 50 after five
hundred (above), say 30; and one full load in a hundred, 41 KB on average: **about 340 KB against
4.1 MB, twelve times less**. Egress breaks at **about 1 250 users** and the cache's storage, about
150 bytes per loaded person per viewer, at **about 1 800** (§3.8).

**CPU** is unchanged: the full core runs every time (§3.4); decoding and patching add a few
milliseconds of work over data already in memory.

#### Costs, plainly

- **Storage**: about 135 bytes of blob and 16 of `members` per loaded person per viewer, 300 KB for a
  viewer with a full 2 000; the
  largest thing stored per viewer, more than the feed. Plus tombstones for 8 days.
- **Complexity**: a table, a tombstone table and trigger, a clock column, the cut as its own
  function, one SQL delta function, a save and an epoch, a codec and a patch in `shared/` with
  tests, a check path, two cron sweeps, drops on account deletion, and a rule
  every future migration must respect (a write to `ratings` or `friendships` with the triggers off
  ends with `delete from private.snapshot_cache`). The core does not change.
- **Privacy — the real cost.** Without the cache the recompute would hold other people's thumbs for
  the length of one call and no longer. With it, a copy of up to 2 000 people's thumbs, each with the
  bit of whether it came before this viewer's, sits at rest per viewer. It is not a new *kind* of
  data — it is what `ratings` already holds, which is why it is kept rather than sufficient
  statistics, whose
  per-person agreement tallies (who agrees with whom) are exactly the trust map §4 promises is never
  kept — but it is a second copy, and it outlives the call:
  - in `private`, readable by `service_role` only, never returned to a client;
  - **deleting an account deletes every cache whose `members` contains the account or any of its
    friends** (a `before delete` trigger on `profiles`, a scan of one row per viewer): the first holds
    its thumbs, the second its id in a friend list, so neither survives in any copy. A removed name
    stays in a cache until that viewer's next refresh patches it out, or the 7-day sweep;
  - someone who leaves a viewer's reach stays in that cache until the viewer's next refresh; a cron
    statement deletes caches not refreshed for 7 days, which bounds it;
  - once backups exist (see `CLAUDE.md`), the caches are in them, encrypted, for their 30 days;
  - `/privacy/` says that a private copy of nearby ratings is kept to refresh each list and deleted
    after a week unused; §4 says the same.
- **Failure modes**: a missed stamp gives a stale feed until the next check (at most a hundred
  refreshes), not a wrong-but-plausible one forever; a codec bug is caught by the same check; two
  tabs refreshing at once both patch from the same row and each writes an exact snapshot with its
  own watermark, so the last write wins and is still exact; a cache that cannot be read or decoded
  is treated as missing.

**Decision.** The snapshot cache, with thumbs-and-tombstones deltas and the friendship clock;
sufficient statistics are not cached. The alternative without a second copy — the integer-array wire
shape alone, no cache — buys a factor of 3.5 in egress rather than twelve (about 700 users where no
cache breaks at 370), and is still the next step for the full loads that remain.

### 3.5 Client

- The list calls `refresh-recs` on open and on demand, keeps the returned feed in memory and in
  local storage (its own feed, which it may see anyway) for first paint and offline, and does
  all searching, fuzzy matching and filtering locally over it. It also loads the viewer's own
  ratings, to overlay them on rows and to honour the hide-rated eye. There is no "as of" line
  on screen; `computed_at` is what the Realtime subscription watches.
- Typing does two searches at once and shows one list: the loaded feed, matched fuzzily and
  accent-insensitively on an item's name **and** on its attributes, plus the catalog itself —
  `items` by prefix over both the normalized query against the primary key and the folded query
  against `search_id` — for things the viewer's reach has nothing to say about. Over the feed
  the fold happens in memory on both sides; over the catalog it matches the stored folded copy,
  so typing a name without its accents finds a thing the viewer has never heard of rather than
  offering to create it a second time (§3.2). The catalog query is what makes the *add* button
  honest: it is offered the whole time there is a query, and the client inserts `items` with
  `on conflict do nothing`, which settles a race between two people typing the same name by
  letting the loser read the winner's row instead of collecting a permission error. The insert
  happens on the first rating or attribute, not on the tap — a provisionally opened thing that
  the viewer backs out of writes nothing.
- The attributes on a row and on a thing's own screen are the tag ratables in the viewer's own
  feed entry for it, plus any the viewer rated themselves, ordered by `|s|` ascending on the
  thing's screen and left in feed order on a row. A chip renders the tag itself — there is
  nothing to look up and no cache in front of it.
- Ratings are written directly by the client into its own rows: an upsert for a thumb, a delete
  for clearing one. The feed updates on the next call.
- **Two Realtime channels over two published tables**: one for the viewer's own feed row, and
  one for the insert of the viewer's own half of a new `friendships` pair — "you are now
  friends" is the one event that matters to somebody who is not the actor, which is what a
  link's owner is when somebody opens it. The publication is `insert, update` only, because a
  policy can bound a row but cannot bound a delete of anything (`0006_realtime.sql` gives the
  reason at length). No table is in the publication without a subscriber. There is no
  notification anywhere in the product. Profiles and the viewer's link change by the viewer's
  own action, which the client already knows about; they are fetched on mount and on focus. RLS
  applies to Realtime, so nobody receives another viewer's row.

### 3.6 Auth: one door

Supabase Auth with **Google as the only provider**. No email link, no password, no anonymous
session, no phone, and therefore no mail sender of any kind. The provider list, the redirect
URLs and the flags that keep the other doors shut live in `supabase/config.toml`, in the repo
and in the diff, rather than on a console page someone has to remember to visit.

Three things follow:

- **A profile arrives named.** A trigger on the auth user creates the profile row in the same
  transaction, taking `display_name` and `photo_url` from Google's identity
  metadata. So "the profile is missing" cannot happen for a signed-in user, and a Google account
  that carries no name at all is called *unknown* until its owner renames it.
- **The OAuth flow must not eat the fragment.** Every screen has its URL in the fragment, and
  Supabase's implicit flow returns the session as `#access_token=…`. The two cannot both be
  right: the router would be handed a fragment it cannot parse and an access token would sit in
  browser history. PKCE returns `?code=…` in the query string, which the client consumes and
  strips, leaving the fragment to the router. This is a correctness requirement, not a
  preference, and its failure looks like a routing bug.
- **The cost.** A person without a Google account, or unwilling to hand Google a record of which
  apps they use, cannot sign in at all — and the premise of grapevine is that you bring your
  actual friends, so a friend who will not use Google is a friend who cannot be invited. There is
  also no second door when Google's OAuth is down or misconfigured. Email link and anonymous
  sessions are additive, and what they need is mail sent from an owned domain with mail
  authentication on it, because a fresh consumer address sending sign-in links is filed as spam
  whatever the authentication — tolerable for a notification, fatal for a front door that *is* an
  email. Nothing sends mail from `grapevine.hafa.cc` — support mail is forwarded in, never sent
  out — so Google is the only door.

Google-only makes a fresh identity cost a Google account rather than a click, and **nothing in
§2.1's threat table changes**, because no row of it rests on the cost of an account. Requirement 2
is bounded by the friend *edges* connecting a sybil set to the honest network, not by the number of
accounts, and §2.5's bound — one voice per accepted connection, "whatever the number of accounts" —
says the same thing from the other side. What an attacker still has to buy is a friendship with a
real person. A fresh-identity cost is not a sybil defence and must never be written up as one.

**A link does not come with an anonymous account, deliberately.** The obvious way to let
somebody holding a friend's link try grapevine before handing Google anything is an anonymous
session (`signInAnonymously`) converted later by linking a Google identity to it
(`linkIdentity`, which needs `enable_manual_linking`). Supabase supports both, and they are not
built, for four reasons that none of them is about sybils:

- **The write budget and the shared catalog lean on an account costing something to make.** The
  budget is per account per day; an anonymous account is a click, so one person could multiply
  it into as many catalog items as they have the patience to mint accounts for. Supabase's own
  answer is a CAPTCHA on anonymous sign-in, which is a third-party script on the welcome screen,
  and `/privacy/` says the site loads none.
- **The conversion fails for exactly the person who opens a link on a new device.** `linkIdentity`
  refuses a Google identity that already belongs to a grapevine account, so someone who already
  has one and opens a friend's link on a phone that is signed out would be left with an orphan
  anonymous account holding the new friendship, and nothing merges two accounts.
- **An account nobody converts is a friend nobody can sign back into.** It stays on the link
  owner's list for good, and nothing deletes it.
- **It reopens what one door keeps shut**: an account with no confirmed anything that can call
  `updateUser({ email })`, and a `has_credential()` that is no longer vacuous and has to be right
  on every path it guards.

So a link asks for Google first and survives the trip (§1 item 6). If an anonymous door is ever
added, it needs all four answered: a budget that does not multiply by accounts, a merge, a
sweep, and `has_credential()` on everything a link can do.

**Invite-only: an account that trusts nobody is locked** (migration `0010`). The soundest place
to refuse a sign-up with no link would be before the account exists, and that place cannot see
the link. Supabase's *before user created* auth hook is called with the user record GoTrue is
about to write and the request's metadata; the OAuth round trip carries nothing of ours through
Google into either, and the token lives in the browser's `sessionStorage`, where GoTrue never
looks. So every Google sign-in creates an account, and the gate is on what the account can do:

- **Locked means no connection.** Nothing stores the lock: `private.is_unlocked()` reads
  `friendships`, so an account that never joined and one that removed its last connection, or
  whose last connection deleted their account, are locked by one rule. `private.count_write`,
  the trigger every counted write already goes through — a rating, an item, a report, a link, a
  diagnostic — refuses a locked caller before it spends anything, and a second trigger
  refuses the two client writes it does not see, a name update and clearing a thumb, with the
  same error rather than by matching no row.
  `refresh-recs` answers a locked caller `403` before it reads a neighbourhood. Reads are not
  stopped: a locked account's reach is its own rows and the catalog.
- **Unlocked by a link.** `redeem_invite` writes the friendship, and the friendship is the
  unlock — the same call, the same consent, the same budget spend as before.
- **No link while locked.** Losing the last connection deletes the account's link (a trigger on
  `friendships`), and a locked account cannot make one (the link's insert goes through the
  trigger), so a link's owner is never locked.
- **Nothing is deleted.** A locked account keeps its ratings, and can sign out, delete itself
  and answer a link. Every account with no connection when `0010` applies is locked like any
  other.
- **Admins are never locked** (migration `0014`, §4), with or without a connection. That is the
  bootstrap: the first account is made an admin by hand and makes the first link.
- **A Google account with no name is called *unknown***, rather than asked: there is no name
  screen, and the name is changed on the people screen like any other.

What this does not change: an account is still a Google sign-in away, and it can still spend a
write guessing a token. What it removes is an account that can rate, name things or make a link
without anyone having vouched for it.

### 3.7 Nothing runs on a schedule except six statements in the database

Six `pg_cron` statements, three in migration `0005`, one in `0012` and two in `0016`, are the
only scheduled work in the project:

- **`κ` and `a₀` pooling** (§2.9). A recompute compares the viewer with every loaded person
  connected to them at a hop distance it already knows, so it reports its partial sums — count,
  sum, sum of squares and total overlap per distance class — into the twelve `pair_*` columns of
  its own `user_model` row, and a daily statement pools the rows checked in the last seven days
  into `private.params` under the `N_min = 200` guard, per distance class. The core reads `κ` and
  the first class's `a₀`. Nothing reads the whole graph to estimate them.
- **The diagnostics sweep**, which deletes expired `debug_events`.
- **The write-budget sweep**, which deletes past days from `private.write_budget`.
- **The fingerprint sweep**, which deletes past days from `private.deleted_identities` (§4).
- **The cache sweeps** (§3.4a), which delete neighbourhood caches unused for seven days and
  tombstones older than eight.

The sweeps are load-bearing twice over: besides their own jobs, they are what keeps a free
project from pausing after seven days without database activity, so deleting the last of them
would do something nobody would guess.

There is no scheduler outside the database. A scheduled GitHub Actions workflow is disabled
automatically after sixty days of repository inactivity, and nothing goes red when it is; a job
run that way would also need a long-lived credential that bypasses RLS in a repository secret.

**One server, and the exception is stated.** The rule is that every user-facing action is a
direct PostgREST write under row-level security, because nothing about another user may be
computed on a client (§4). The feed is the one thing that cannot be, so `refresh-recs` is the one
Edge Function.

### 3.8 Cost, and where the free tier breaks

Assumptions, so they can be argued with: a recompute loads `min(U, 2 000)` people for `U` users —
the whole `N_max`, not a two-hop reach, since the cut fills to the cap in any connected world larger
than it; about 2 KB a loaded person in the neighbourhood's text shape, and 135 bytes in the cache's
blob as it crosses the wire (§3.4a, measured on the realistic world); a fifth of users active daily at four opens, three of
which pass the staleness window, so 18 recomputes a user a month.

**Egress** is what the Edge Function reads through the pooler. Reading the whole neighbourhood every
time, with no cache, is 4.1 MB a recompute at a full `N_max`, and 5 GB a month breaks at **about 370
users**. With the cache (§3.4a: the blob, the delta, and a full load every hundredth refresh) a
recompute averages about 340 KB, and egress breaks at **about 1 250 users**. Invocations never
bind.

**Storage** gains the cache: about 135 bytes of blob and 16 of `members` per loaded person per viewer,
so `150 B × U × min(U, 2 000)`: 150 MB at a thousand users, and 500 MB at **about 1 800** — the line
after egress, and close behind it. The rest is about 48 KB a user at `R = 100` and 117 KB at
`R = 500`, which alone would last to several thousand. Both are against about a hundred users for a
store billed per document (§3.1).

**The feed holds every rated thing in reach** (§2.6), so `user_recs.entries` and the response
that carries it grow with the number of distinct things rated in reach: at degree 15 and
`R = 100`, up to a few thousand entries of about seventy bytes each — a few hundred kilobytes
before compression, per feed row and per recompute that writes one. That is storage and egress on
top of the lines above, and is what the next paragraph's first change removes.

What to change first, in order: stop shipping the whole feed on every open (send the top of it
plus a hash and let the client ask for the rest); stop fetching ratings for people whose chain
is too weak to matter, which needs the core to distinguish "has adjacency" from "has ratings" and
the loader to read in order of chain strength — a smaller saving than it looks, because every
link of a chain is learned from both people's ratings (§2.4), so the graph alone does not say
who matters; and then pay, because
$25 a month buys 8 GB and 250 GB of egress and two thousand users is where a project has users
worth paying for.

The normalized ratings table is the one place this design spends storage for structure: a row is
about 110 bytes against 30 for a map entry, bought for the constraints of §3.2. If storage ever
binds before egress does, the fallback is one jsonb map per user and it changes no application
code, because the neighbourhood query already hands the core the aggregated shape.

An id is arbitrary UTF-8, so a name in a non-Latin script costs two or three bytes a character
instead of one — a few percent on both numbers, and nothing that changes where the line falls.
The neighbourhood's nested shape writes each item id once however many of its attributes a
person rated, which matters more, because the neighbourhood is egress and `items` is storage.
`search_id` is usually the smaller of an item's two columns, since folding strips characters and
never adds any.

## 4. Privacy and social safety

The stance: nobody's individual ratings are ever shown, and inferring them should take
deliberate, repeated effort rather than a glance. We do not try to make inference impossible;
that would cost recommendation quality for a guarantee nobody expects from a friends app.

- No screen ever shows counts, raters, averages, "N friends liked this", or who created an
  item. Scores are shown as a personal meter — four segments, filled to one cautious value of the
  score and the evidence behind it (§1 "The bar") — never as a number and never with a word beside
  it.
- Ratings are readable only by their owner, and by the Edge Function, which reads the
  neighbourhood of whoever is calling and writes back only that caller's own scores. No process
  reads everybody's ratings at once.
- **Every rated thing in reach shows, and here is what a viewer can infer from that.**
  - *That somebody within reach rated a thing.* Every thing anyone connected to you rated has an
    entry, so its presence in your list says someone within your nearest two thousand people
    rated it. Names are already public (the catalog is searchable by everyone signed in); what
    the list adds is "someone near me".
  - *With exactly one friend, your feed is that friend's ratings*, and with a few friends it
    still says that *someone* close to you liked a thing. The evidence behind a bar counts at most
    one thumb's worth for each friend's side of your network (§2.6), so a bar near an end says
    several of them weighed in and agreed.
  - *A stranger's thumb*: someone reached only through a chain that predicts nothing weighs
    nothing, and their thing sits at the middle — its existence is all that shows. Anyone
    else is heard as strongly as the chain to them predicts you, never more strongly than the
    friend at its head, and inside that friend's one voice (§2.4). With few friends, a thing that
    leans can point at a person.
  - *Order*: whether someone tends to rate things before or after you moves how much their
    thumbs count in your feed (§2.3). The database hands the recompute one bit per shared rating
    — before or after the viewer's own — never a time, and the feed shows no times; what leaks
    is a slow, coarse function of that bit, behind the staleness window.
  - *Bots' items* appear in every feed within reach of a bot that rated them, near the middle
    unless the chain to the bot predicts the viewer, and never more than one voice per accepted friend
    (§2.5).
  The friction is: no counts, no recency ordering, a meter instead of a number, and a
  staleness window. The privacy page says the one-friend case and the friction plainly.
- An account's feed reveals the trust-weighted opinions of its reach. That is what any
  account, including a bot that a friend accepted, can learn about you: aggregate taste,
  never individual ratings.
- Friend lists are private: each connection is visible to the two people at its ends and
  nobody else. Either end can unfriend, which removes both rows in one statement, and with them
  the profile read and the reach that being friends gave; an end left with no connection is
  locked (§3.6). Nothing is public to signed-out
  visitors except the app shell and, to whoever holds your link, your name and photo.
- Nobody can be found by typing anything: there are no handles and no search for people. A
  stranger reaches you in exactly one way, and it is your own act: **your link**, which anyone
  holding it can use to see your name and photo and to become your friend, until you make a new
  one or turn it off; either stops new friends and keeps the ones it made (§1 item 6). A link
  that leaks costs you the friends it makes before you replace it, and each of them can be
  unfriended.
- Item names and tags are the one channel of user-written text that everyone in reach can
  see, and a name can never change — it *is* the id (§3.2), so there is no verb that could
  change it and nothing that could be changed under it. A name like "blue bottle (rated by 9
  friends)" or a real person's name is therefore possible and permanent. v1 accepts this with
  three limits: names are rendered as plain text, never as links or markup; the folding
  refuses control characters, so a bidirectional override cannot reverse the row a name is
  drawn in; and a misleading name occupies only itself — anyone else can still create and
  find the name they meant, since identity is exact. **A name can be reported**, from the
  quiet *report this name* line at the end of the thing's screen (§1 item 4): a `reports` row the
  client may insert and nobody may read through the API, one per person per name, no reason
  asked, one write spent. An **admin** — a row in `private.admins`, written by hand, which no
  client reads — reviews them in a queue on the people screen: every reported name with how many
  reported it, never who. `reported_names()`, `remove_reported_name(text)` and
  `dismiss_reports(text)` check `private.is_admin()` before anything else and answer anybody
  else nothing or a refusal. Dismissing deletes a name's reports and keeps the name. Removing
  calls `private.remove_name(text)`, which no client can call directly: it adds the name to
  `private.removed_names`, which restrictive insert policies on `items`, `ratings` and `reports`
  check so it cannot be typed back or reported again, and deletes its catalog row and its reports.
  That is all it does, in about a millisecond; rewriting every stored feed that held the name took
  4–5 s at 5 000 people, against the 8 s a signed-in request is allowed. From that moment every
  reader leaves the name out, on the server: a recompute's loads skip every thumb naming it, as a
  thing or as an attribute, so a new feed never holds it; a patched neighbourhood cache drops it,
  because the delta names every removal since the cache was written; a signed-in read of
  `ratings` hides the viewer's own thumbs on it (a restrictive `SELECT` policy); and the app reads
  a stored feed through `my_feed()`, which strips names removed since that feed was computed. The
  thumbs themselves are deleted by a cron job, a batch of 5 000 a minute, without stamping anyone
  or leaving tombstones, since nothing anybody was served changes when they go; the name counts as
  purged once a run finds none left, ten minutes or more after the removal. What lags: a stored
  `user_recs` row keeps the name until its viewer's next recompute, where only that viewer can read
  the table directly, and a page already open keeps it until its next refresh. Removal rather than
  a hidden flag the client filters: a flag would still ship the name in every feed that carries
  it, readable to anyone with DevTools, and leave thumbs pointing at it; a report is about text
  that should not be served at all. The same path is the remedy for a homograph of an existing name, which §3.2
  says is bounded rather than prevented.
- **Adding a thing is the one time the browser sends typed text to someone else**: the name
  about to be added, to Wikipedia and to Photon, straight from the browser with no cookie, so
  each sees that text and the IP address and never the account; Photon also gets a position
  rounded to about a kilometre while that setting is on, and Wikidata, from the same browser,
  the ids of Wikipedia's matches (§1 item 2). Only on a tap of add, never while
  typing, and the first setting turns it off. A link is chosen by a client, so it is as
  trustworthy as a name: the remedy for a wrong one is the report line and the owner's
  `private.remove_reference(text)`, run by hand, which deletes only the link and adds it to
  `private.removed_refs`, which a restrictive insert policy checks, so a wrong link on a
  well-rated name is fixed without removing the name. `public.remove_reference(text)` is the
  same for an admin's client, and nothing in the app calls it yet.
- Agreements are never shown, so there is no way to learn "the app thinks you and X
  disagree". The recompute keeps no per-friend trust map between calls — no reliability, agreement
  or tally about anybody — and `user_model` is readable by nobody, not even its owner (§3.3).
  Nothing about agreement leaves the server.
- The operator of the project (whoever holds the Supabase project) can read the database to
  keep it working or when the law requires it; the privacy page says so. "Only you and the
  recompute" is a statement about grapevine's users and the app, not about the operator.
- An account whose only friend is you sees your thumbs as its feed, exactly as you would see
  theirs: the one-friend leak reads the same from either end of the edge.
- The recompute reads the friend lists and ratings of everyone in the viewer's reach — at most
  the nearest `N_max = 2 000` of them, and what lies beyond them does not reach the viewer's feed
  at all (§3.4). That read is a database function in a schema the API does not serve, executed
  only by the server's own role: a client cannot call it, and no client ever receives another
  person's ratings, pseudonymized or otherwise.
- **And it keeps a copy of what it read** (§3.4a): per viewer, the friend lists and thumbs of the
  people it loaded — each thumb with the one bit of whether it came before the viewer's own — so the
  next refresh reads only what changed. It is not a new kind of data, only a second copy of what
  `ratings` and `friendships` hold; it is in `private`, readable by the server's own role and
  written only through one function, and never returned to a client. It is rewritten on each of the
  viewer's refreshes and deleted after a week unused; a removed name leaves it at the viewer's next
  refresh.
  Someone who leaves a viewer's reach stays in that copy until the viewer's next refresh.
- Nothing about another user is ever computed on a client. Whatever a client is served it can
  read — with DevTools, a modified bundle or a plain HTTP call — so serving another person's
  ratings is disclosure, not inference. And no transformed version escapes that: a score is built
  from each person's thumbs with weights the viewer can steer (befriend only `v`, and the feed is
  `v`'s ratings), so a per-person digest, a pseudonymized bundle, or a client that computes
  reliabilities while the server scores all hand that person's ratings to the client in some
  encoding. The only per-viewer artefact that survives is the one the server already writes: the
  viewer's own feed.
- **An account can be deleted by its owner, from the app, and by nobody else.**
  `delete_account()` is `security definer` with no argument, so the only account it can reach is
  `auth.uid()`; it deletes that `auth.users` row and the rest is the schema's own cascade:
  profile, ratings, both halves of every friendship, the link, the feed, the model row, the
  ratings clock, the write budget, and GoTrue's identity and sessions. A trigger on the profile
  deletes every neighbourhood copy (§3.4a) that loaded the person or any of their friends, so
  neither their thumbs nor their id remain in anyone's. By hand it also drops the
  person's diagnostics, which carry no foreign key. Items they named stay, with `created_by`
  null (§3.2). It is a function rather than a second Edge Function because it is one
  statement under the caller's own identity. Friends see the person gone on their next read
  (Realtime publishes no deletes), and the friendship trigger stamps each friend's ratings
  clock, so their next open recomputes. Signing in again with the same Google account makes a
  new, empty account with a new uuid — **but not a fresh write budget.** Deleting keeps, until
  the end of that UTC day, a one-way fingerprint of each identity the account signed in with
  beside the day's spent budget, and an account created from the same identity that day starts
  from it, so deleting cannot be used to reset the limit. The fingerprint is HMAC-SHA256 of
  `provider:provider_id` (Google's stable subject id) under a random key kept in Supabase Vault:
  keyed, so knowing somebody's subject id is not enough to confirm they deleted an account; in
  Vault, so the key is encrypted at rest and absent from any dump of `public`, `private` and
  `auth`. No email, name or uuid is kept, and a scheduled statement deletes it after its day. One
  day is enough because the budget is the only per-account allowance and it resets at midnight;
  a limit with a longer window would need the fingerprint kept as long. A second Google account
  still buys a fresh budget, which no fingerprint can stop.
- Diagnostic records carry an `expires` field and nobody reads one back. What deletes them
  is a scheduled statement in a migration, in the repo and applied by the deploy, rather
  than a console setting somebody has to remember to make and whose absence is silent.
