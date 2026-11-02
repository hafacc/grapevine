# grapevine — design

grapevine learns your taste. You rate things, and tags on things, with a thumbs up or down, and
you follow accounts whose opinion you want in your list: people who gave you their link, and
prefilled accounts that hold a critic's or a source's published picks. You get back a personal
ranking built from your own thumbs and theirs: what the accounts you follow say of each thing,
moved by how your own thumbs depart from theirs. Nothing is absolute: there is no global score, and two
people looking at the same thing see different bars.

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
  shows. What that gives up is the creator's capitalization — whoever adds it typing
  `"Café Bleu"` gets `café bleu` back — and giving it up is the point: everything user-facing
  is lower case anyway (§1 "The one view"), so a stored capital would be a spelling no screen
  honors, plus a second field to keep in step with the key. §3.2 says what the folding refuses
  and what it costs.
- **Tag** (the UI calls it an **attribute**): an arbitrary string attached to an item by rating
  it. `restaurant`, `cheap`, `casual`, `action`, `late night`. **Rating a tag on a thing says
  the tag applies, whichever way the thumb points; the thumb says how good an example of it
  the thing is.** A thumb down on `fantasy` is a bad fantasy, not a thing that is not one. So
  there is one word per idea, and no `good fantasy` beside `fantasy`. **The only way to say a
  tag does not apply is to leave it off.** There is one namespace: a "category" like
  `restaurant` and a quality like `cheap` are the same kind of thing, and nothing declares
  which is which.

  **For the viewer's own thumbs the two halves stay apart; for everybody else's the model
  returns one number** (§2.4): how far the viewer would call the thing a good example of the
  tag, read from the thumbs of the accounts the viewer follows. A thing is shown as having a
  tag the viewer did not rate when that number is above zero.

  A tag is an id under exactly the same rule as an item, at the same cap, and nothing else:
  `late night` is the tag, with its space, and `"Late Night"` lands on it. There is no `tags`
  table and no tag display name, for the same reason an item has none.
- **Ratable**: the unit that receives a thumb. Either an item `i` or an item–tag pair `(i, t)`.
  Both take exactly one of `+1` / `-1` per user, changeable at any time, removable. A thumb on
  the thing itself is the question *good?*, and is stored as the empty tag; a thumb on a pair
  is *a good example of it?*, and its existing is what says the tag is there. A pair is **two
  fields**, never one joined string (§3.2).
- **Rating**: `(user, item, tag) -> +1 | -1`, with an empty `tag` meaning the thing itself.
  Readable by its owner and by every account that follows the owner (§4), and by nobody else.
- **Follow**: one-way, and the only relation between two accounts. The follower's list draws on
  the followed account's thumbs; the followed account learns that it has a follower and nothing
  about them but their name and photo. On screen the accounts a viewer follows are **their
  vine**. A person is followed in two ways and no others: by opening their link and saying yes
  (§1 item 6), or by following back somebody who already follows you. Either end can end it.
- **Prefilled account**: an account the owner of the project makes by hand to hold the taste of
  a notable critic or source — the first is Barack Obama's 2024 books, films and songs. It has a
  **handle** (`obama`) and no sign-in, anyone signed in can find it and follow it with no link,
  and it follows nobody. It carries the attributes its own thumbs use (`book`, `film`, `song`),
  so it is found by what it rates the way a thing is found by what it is. It is not a person: following one does not unlock an account (§3.6).
- **Display name**: what an account is called. A person's defaults to the first name Google
  gives (`given_name`, else the first word of the full name), is editable at any time, and may
  be anything up to 50 characters that is not blank and holds no control character, no
  bidirectional mark or override (one reverses the line it is drawn in), no line or paragraph
  separator, and none of the characters that draw as nothing (soft hyphen, zero-width space,
  word joiner, byte-order mark), with which two names that look the same are different
  strings. No person is found by it, so it needs
  to be neither unique nor stable; a person has no handle.

### The one view

**There are no tabs.** The app is one screen: a list of things, with a search field pinned to
the bottom where a thumb already is. Everything else is a layer over that list, and the two
things that are not the list — a thing, and the people — are reached by opening a row and by
the avatar in the corner. Everything user-facing is lower case.

1. **The list.** With the field empty it is everything the viewer's own thumbs and their vine's
   have a score for, ranked by what its bars draw ("The bar" below), plus everything the viewer
   has rated, which the scores may not carry — with nobody followed and no tags there is no
   score for any of it (a thing with no score sorts as zero). Typing filters the list by an
   item's name **and** by its attributes, fuzzy-matched, so a misspelling finds the thing that
   already exists rather than offering to make a second one. Several words each read as the
   name or an attribute and rank by how well the thing has them all; a query of attributes
   alone, `fantasy book`, ranks by how well they apply *and* how much the viewer would like the
   thing; `!` puts the low-rated first and `#` looks at attributes only ("Search" below). It
   finds things and nothing else: accounts are found on the people screen (item 5). A row carries the name, its attribute chips, and one bar. The bar belongs
   to **whatever matched**: an attribute match shows that attribute's score for this viewer, a
   name match the item's own. That is the whole answer to "why is this here", and it is an
   answer about the viewer's own model of a word; no screen says which account a bar came from
   (§4).
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
   Photon a position rounded to about a kilometer so the nearest branch comes first, the
   browser asking the first time. The second is gone while lookups are off, since it would
   change nothing.
3. **Rating is a swipe, and on mobile it is the only way to rate.** Right is yes, left is no.
   Swiping the way you already voted **clears** that rating, and the reveal behind the row says
   so — it turns gray with a minus rather than green or red. Swiping the other way flips
   straight over, with no clear in between. The row moves horizontally and does nothing else:
   no rotation, no vertical travel. This is a choice between two sides, not a card being
   thrown away, and the borrowed card-deck motion would say the opposite. **There are no thumb
   buttons anywhere on mobile.** A rated row keeps its bar and tints its background, green for
   yes and red for no.
4. **A thing.** Opening a row replaces the list with the thing's own screen, drawn the same
   way. Its title bar carries a back button, the name, the item's own bar and the avatar, and
   **is** the item's rating
   control: swiping the title bar rates the item, and only that bar takes the tint. Below it
   each attribute the thing **carries** is a plain row — name, its own bar — rated on its own by
   the same swipe: yes is a good example of it, no a bad one, and either says it applies. A
   thing carries an attribute when the viewer rated it there, or an account they follow did and
   its score there is above zero (§2.4). Attributes are ordered **nearest the middle first**,
   `|s|` ascending on the value their bars draw, with the ones nothing is known about in front:
   the answers worth most are the ones the viewer's vine has least to say about. The screen's search field filters the attribute list and offers *add
   attribute* while typing, in the same place the list's add button sits. An eye beside the
   field hides the attributes the viewer has already answered; the icon itself changes — open
   eye, crossed-out eye — rather than only its color, because a toggle whose only state is a
   tint is unreadable to anyone who cannot see the tint. The same toggle on the list hides
   things the viewer has rated. At the end of the attribute list a row of dashed chips
   proposes attributes to apply under the heading *suggested*: the viewer's own words (§2.11).
   The model proposes none (§2.7). The
   heading claims nothing about who: "people like you use this" is an attribution and §4 forbids it. Last, for a
   name the catalog or the list holds, a quiet *report this name* line (§4),
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

   Then the two lookup settings (item 2), *import ratings from another app* (item 9; gone
   while lookups are off, since an import matches through them), *save your ratings to a
   file* (item 9), for an admin *names people reported* (§4), and the install row where the
   browser offers one — each of those a whole row that is its action, tapped or swiped right,
   with no button on it; the first and the third open screens of their own, `#/import` and
   `#/reports` (§4). Then three sections of **account rows**, each shown only when it has a row:
   - ***your vine***: every account the viewer follows, people and prefilled accounts alike. A
     row is a photo and a name, with `@handle` under a prefilled account's name, and no level
     of agreement. It swipes one way only: left, revealing the word *remove* rather than a
     thumb. It asks first — *remove &lt;name&gt; from your vine?*, *their ratings will no
     longer shape your list.*, and for a person who does not follow the viewer back, *to add
     them again, you'll need their link.* — and on *remove* deletes the follow.
   - ***following you***: every person who follows the viewer. Right is *add*, which follows
     them back with no link and no question, and is not offered for somebody already in the
     viewer's vine, whose row is tinted instead; left is *remove*, which asks *stop
     &lt;name&gt; following you?*, *your ratings will no longer shape their list.*
   - ***critics***: every prefilled account, by name, so they can be browsed. Each row carries the account's attributes as a thing's row does, the first
     three, those on the most of its things first. A row in the viewer's vine is tinted and swipes left to *remove*, asking
     as under *your vine*; any other swipes right to *add*, which follows it at once. All of
     them are already on the device ("Search"), so the section asks the server nothing.

   An account is a row and nothing more: there is no account page, and nowhere lists what an
   account rated. Below the sections, last on the screen, a
   quiet line reads *delete your account*, tinted the red of a no-rated row. It opens a sheet
   saying what goes and what stays (§4), and its delete button stays disabled until the word
   *delete* is typed: the shared confirm confirms on Enter, and two taps in one place are one
   fumble.

   **The screen's field, *find people and critics*, is the search for accounts.** Typing
   replaces everything under the title bar with one list of account rows, by name: every word must start the
   handle, a word of the name, or a word of any of a prefilled account's attributes — all of
   them, not only the three a row shows — so *pizza* finds the critics who rate pizza. A
   matched attribute is a *match* chip and goes first, whatever its place on the account. It
   searches only the accounts the sections hold — the vine, the people following the viewer,
   every prefilled account — so it asks the server nothing and reaches nobody new. A person has
   no attributes and is found by name alone. A row does what it does in its section: in the
   vine, left is *remove*; otherwise right is *add*, and left, for somebody following the
   viewer, stops them. Finding nobody it says *nobody here by that name. to add someone, ask
   for their link.*
6. **Following a person is opening their link.** Each person has **at most one link** —
   `https://grapevine.hafa.cc/#/invite/<token>` — with no expiry and no limit on uses, managed
   from the link row (item 5). The link can be copied again at any time, from any device the
   owner signs in on. *new link* asks first — *make a new link?*, *the one you have stops
   working. people it added stay.* — and so does *turn off*. Neither removes a follower. The other way round it does: removing a
   follower replaces the link (§4), so the row then offers a link nobody else holds yet.

   **A link is handed out to be followed by.** Whoever opens it and says yes follows the
   owner; the owner does not follow them, and sees them under *following you*, where following
   back is one swipe. That asymmetry is the consent on both sides: the opener chose to hear
   the owner, and the owner, by handing the link over, chose to be read by the opener.

   A link is a **bearer secret** and works for anyone who holds it, as many times as it is
   opened, until its owner replaces it or turns it off. So one link can go to a group chat, and
   **a leaked link costs its owner exactly the followers it makes before it is replaced** —
   each of whom can read every thumb the owner has given (§4), and each of whom the owner can
   remove.

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
   A locked account also reads, above the buttons, *if you decline, your account stays locked
   until you accept someone's link.* Saying yes is the consent, and asking before writing is
   what lets someone who opened a forwarded link, or opened it signed in to the wrong account,
   see whose it is and say no. A dead link — turned off, replaced, mangled or never made, which
   are not told apart — shows **nothing about anybody**: no name, no photo, since
   `invite_owner` answers nothing for it. It says *this link is invalid or expired* on the
   welcome screen, before any trip to Google, and *that link is invalid or expired* to somebody
   already signed in; either way it is then forgotten. A malformed token is answered that way
   without asking the server. Your own link says so; an account already followed says
   *&lt;name&gt; is already in your vine*.

   **Nobody finds a person by typing.** The people screen's search (item 5) reaches only the
   accounts the viewer may already see: the ones they follow, the people following them, and
   the prefilled accounts. A prefilled account is followed from it, or from *critics*, at once;
   a person who is none of these is on no screen.

   **A link is also the only way in** (§3.6). Signed out with no link, the welcome screen says
   nothing about the vine, the door reads *sign in*, and the line under it *grapevine is
   invite-only. ask someone for the link to their vine.*; the door stays, because people who
   have joined sign in there. An account that follows no other person is locked — a prefilled
   account does not count — and the question above, when it holds a live link, is how it
   unlocks. Otherwise, or on *not now*, it sees *your account is locked* and *it unlocks when
   you add someone to your vine with their link. ask someone for theirs.*, with *sign out* and
   *delete your account*. Removing the last person asks first: *they're the last person in
   your vine. your account will be locked until someone sends you a link.*
7. **The first list, and nothing to show.** Everyone but an admin arrives through a link, so
   their first list is already their vine's ratings. Before it, once, an account that has just
   accepted a link is offered the critics, on one full screen drawn as the link's question is:
   *add some critics?*, *their picks shape your list too. swipe one right to add it.* (at desktop
   width, only the first sentence), every prefilled account as its row under *critics* is,
   then *not now*, which reads *done* once one has been added, and *they're on the people
   screen whenever you want them.* It comes after the link because a locked account cannot
   follow one and following one does not unlock (§3.6), and before the import offer (item 9)
   because an import is a screen of its own that can run for hours, which a question still
   waiting would stand in front of. With no prefilled account, or none read, it is not asked;
   the device remembers that it was answered, and forgets on sign-out. Over it, once per viewer on a device, sits
   one line: *this list comes from your vine. swipe right for yes, left for no.* (at desktop
   width, only the first sentence: the thumbs on the buttons say the rest), with a close
   button. Closing it or rating anything puts it away for good. It waits for a list with rows
   in it, because a gesture taught before there is anything to use it on teaches nothing.
   A list that is really empty — an admin with no vine, or a vine that has rated nothing yet —
   reads *nothing here yet. search to add something, or add people to your vine.* with an
   *add to your vine* button and, while lookups are on, a second, *import ratings* (item 9).
   When the eye has hidden every row there is, the list says
   *you've rated everything here. the eye shows it again.* instead.
8. **Desktop keeps the mobile layout** and replaces the swipe with a button set into each
   side of a row — no on the left, yes on the right — tinted the same soft green and red that
   a rated row gets, with the colored glyph on top. The side matching the viewer's current
   rating goes gray with a minus, because pressing it clears. Thumbs are for rating only: on
   the link row and an account's row the buttons carry the word for what they do (*turn on*,
   *turn off*, *new link*, *add*, *remove*). Desktop is otherwise
   **unpolished and deliberately deferred**: the column is centered and the rest is the phone —
   the whole phone, bars included, so a back button or the avatar sits at the column's edge and
   not the screen's.
9. **Importing.** A person's ratings on IMDb, Letterboxd, Trakt, Netflix, Goodreads,
   StoryGraph, Google Maps or Spotify come across from the file that service lets them
   download, on a screen of its own, `#/import`. The file is read in the browser and never
   uploaded; no account is connected and nothing syncs back.
   - **Ways in**: the people screen's row; the empty list's second button; and once, on one
     full screen drawn as the link's question is, for an account that has just accepted a link
     and has rated nothing, after the critics (item 7) — *rated things somewhere else?*, *not
     now*, *import*.
   - **Choose**: eight rows, each a source and what comes across; a tap opens a sheet saying
     where that service keeps its file, and *choose file*. The file is recognized by what is in
     it, never by its name or by the row tapped, so the rows are there for the instructions. A
     zip is read as it is. A file that is the right service's wrong file — a watchlist, a
     Takeout with no reviews — is told apart from one that is nothing known.
   - **Their scale to a thumb**, by fixed cuts with the middle left out: IMDb 7–10 is a yes and
     1–4 a no; Letterboxd 4–5 a yes and ½–2 a no, and a heart is a yes on a film with no rating
     or a middle one; Goodreads and Google 4–5 a yes and 1–2 a no. Trakt is cut as IMDb is,
     StoryGraph's quarter stars as Goodreads' are (3.75 is neither). Spotify has no scale: a
     liked song, a saved album and a followed artist are a yes, a hidden song and an artist not
     to be played a no. Netflix's thumbs are thumbs (two thumbs up is a yes), and its old five
     stars are cut as Goodreads' are; a title it holds a yes and a no on is left out. Single
     episodes and seasons are left out, since a series is what is rated; a shelf, a watchlist,
     a draft and a saved place are not ratings and are not read. No attribute thumbs are made.
   - **Matching**: each rated thing is matched to the English Wikipedia page (through Wikidata)
     or the OpenStreetMap place (through Photon) the add button would have offered, and **named
     as a hand-add of that match would be**, so an imported thing and a typed one are one
     thing. IMDb's own id is the match (Trakt's file carries it too), and so is Spotify's,
     through the Spotify ids Wikidata holds; a Netflix title, which comes with no year, is the
     one film or series of that name, or of several the one Wikidata gives a Netflix id; a film
     is matched by title and year, a book by title and author, a place by name within 200 m of
     the review's pin. The other service's id is used to match and is not stored: what is
     stored is the link (§3.2 `item_refs`). **Only a clean match is saved.** A thing with no
     page, one whose title cannot be a name, and one with more than one thing it could be are
     all left out, silently: an import never guesses, and asks nothing but whose a Netflix
     file's profiles are (below). Every rating in the file is taken, up to the import's 10 000:
     there is no smaller cap for any source.
   - **Netflix's profiles, the one question.** Netflix's file holds every profile on the
     account in one list. A file with more than one profile shows each by name, all on, each to
     be turned off, then *import*; only the thumbs of those left on are imported. A file with
     one profile skips it. The names are kept for the run and nowhere else.
   - **Not imported**: Yelp, whose file's contents are documented nowhere; and Trakt through a
     sign-in, since Trakt's own export is a file and needs none.
   - **No review and no confirmation.** Choosing the file is the whole of it, but for Netflix's
     profiles: it is read, matched and saved as one stretch of work, under the title bar's rule
     filling in the accent and a line saying how many of the file's ratings have been dealt
     with. **It saves as it goes**: films and books five hundred at a time, places twenty at a
     time, since a place takes seconds (Photon is asked no more than once every 1.1 seconds,
     and a refusal is waited out and slows the pace rather than ending the run). So leaving
     part-way loses nothing that was matched. So the sheet that says where the file is also
     says, before the file is chosen, that the ratings save as soon as they are matched and
     that the source can be imported once every 30 days.
   - **Saving** writes names, links and thumbs through one function (§3.3). A thumb is
     stamped when it is imported, never with the file's date; **a rating already given here
     is never changed**; nothing records that a thumb came from an import.
   - **Done** says how many were saved, and in one line that the rest could not be matched,
     were rated in between or are already rated here. **That count and the one while it works are the only numbers an
     ordinary account sees** (§4): it is of the person's own import and discloses nothing
     about anybody else. No list of what was left out is shown.
   - **Once every 30 days for each source, up to 10 000 thumbs.** An import stays open for a
     day after its first thumb, so one that was left or lost its connection can be finished
     by choosing the same file again: it takes up where it stopped, and what is already
     rated is skipped. For that the device keeps the source, how many ratings the file held
     and how many were dealt with, and no rating or name. A source that is closed says on
     its row how many days until it opens.
   - **The file out.** A tap on *save your ratings to a file*, on the people screen,
     downloads `grapevine-ratings.csv`, built in the browser from the viewer's own ratings
     and the links of the things in them, with no screen of its own; the row then reads
     *saved to your downloads*. Columns `name, attribute, rating, source, id, link`:
     attribute thumbs are included, since the file is the person's own data; `rating` is
     `yes` or `no`; a plain name's last three are empty. No dates, since nothing on a screen
     shows when a thumb was given. A cell that would run as a formula in a spreadsheet is
     prefixed so it cannot.

### The bar

The one thing that shows a score, everywhere one is shown. Four segments in a row, filled from
the left — a value part-fills the segment it lands in rather than rounding to it. Red at or
below the midpoint, green above; the unlit track is gray **with an outline**, so the level is
countable rather than guessed against the background. There is no word beside it, anywhere
(the accessible label keeps one, because a bar with no text is nothing to a screen reader).

No numbers, ever: every one of §4's promises holds — no counts, no raters, no averages, no
attribution.

**The fill is the score as it is.** The core returns, per thing and per attribute on a thing, a
score `s ∈ (−1, 1)` (§2.6) and a count of the followed accounts behind it. The bar draws, and
the list ranks by, the score alone (`barValue` in `web/src/lib/utils/bar.ts`):

    fill  =  (s + 1)/2

A thing the viewer's accounts agree on draws near an end; a thing one account rated, or one they
split on, draws near the middle. There is no step to round to and no floor below which a thing
is hidden. A thing with no score draws as nothing known and sorts as zero. **An attribute's bar
draws the same**, of how good an example the thing is; an attribute only the viewer rated draws
as nothing known.

**Why nothing pulls it toward the middle.** The caution is already in the score: what the
followed accounts say of a thing is the mean of their thumbs from a start of "as likely up as
down" (§2.3), so one thumb up is a third of the way from the middle to the end and ten are five
sixths. Shrinking that again by how few thumbs there are would count the same doubt twice. The
count stays apart in what the core returns, breaks ties in the order, and is drawn nowhere.

`web/DESIGN-UI.md` "The bar" is the component.

### Search

The list's field finds things, by name and by what they are, and nothing else; accounts are
the people screen's own search (§1 item 5). Built in `shared/src/search.ts` and `searchFeed` in
`web/src/lib/utils/discover.ts`; migration `0002` reserves `!`, `@` and `#`.

**What is typed is free text.** Split on whitespace. A word may start with `!`, then `#`:

- `x` finds a name or an attribute, high-rated first;
- `!x` finds the same, low-rated first — `!` excludes nothing, it turns the order over;
- `#x` finds attributes only, and `!#x` puts the things that lack it first.

A word's leading `@` is dropped, so `@pizza` is `pizza`. It is still reserved: no name has
such a word, so the query is no name to add.

That is the whole syntax: no quotes, no OR, no parentheses. Which words belong together —
`late night` one attribute or two words — is not syntax. A word with an operator starts a new
piece, which may run on over the plain words after it and takes that word's operators:
`#late night` is one attribute.

**Any piece, any reading, any split.** The query is cut into pieces of one or more consecutive
words, and each piece independently reads as the thing's **name** (all of it, or some of its
words, or the start of one) or as one of its **attributes**. `hip work coffee` can be the two
attributes `hip work` and `coffee`, the three `hip`, `work`, `coffee`, or a thing of that name;
`starbucks quiet` is a name piece and an attribute piece, and finds every starbucks ranked by
how good and how quiet each is. Every row takes whichever split scores it highest.

**What a piece contributes, in `[0, 1]`.**

- **An attribute: its presence** (§2.4's `applies`, which is its score on `(0, 1)`), and 1
  where the viewer rated it, whichever way: a bad fantasy is a fantasy. An attribute nothing is
  known about on the thing is **0.5, unknown**: above an attribute the viewer's accounts
  thumbed down there, below any yes.
- **The name: the thing's own presence**, the same mapping of the value its bar draws, `s`
  ("The bar"), or the viewer's thumb on it. A name piece says *this* thing; how good it is is
  what it adds.
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
rows that split it differently, which ranking needs. The best split is a dynamic program over
split points (at most six words to a piece), maximizing the same sum — `6n` readings per row,
not `2^(n−1)` splits. Ties go to `conf` (more followed accounts behind it first), then
alphabetical.

**Asked for by what it is, a thing is wanted in proportion to how good an example it is.** When
no piece reads as the thing's name — `fantasy book`, `quiet late night` — there is one more
factor, and the mean is over one more than the words typed:

    strength  =  exp( ( Σ_pieces words(piece) · ln contribution(piece)  +  ln example )
                      /  (words typed + 1) )

`example` is the geometric mean, over the spelled attributes the query read, of how good an
example of each the thing is: the viewer's own thumb as 1 or 0, else `(1 + s)/2` of the value
that attribute's bar draws, and **where nobody has said, how good the thing itself is**. So
`fantasy` is the good fantasies, best first, which a book the viewer would not otherwise like
can be; and `fantasy book` on things nobody has thumbed as either is the ones the viewer would
like. A piece read as the name has already counted how good the thing is, which is why the
factor is added only when none did.

**A thing is on the list** when any piece of the query reads on it — its name or an attribute
it carries — or when learned nearness (below) says it probably has a word. Nothing about the
strength is drawn.

**`!` flips a piece, and removes nothing.** A `!` piece is read exactly as it would be without
the `!` — the same name or attribute, the same typo tolerance, the same learned nearness — and
contributes `1 − contribution` instead. Unknown stays 0.5, so "leans no" ranks above unknown
and unknown above "leans yes". `#` only narrows which readings a piece may take: the
attributes, and what learned nearness reaches from them.

**`!`, `@` and `#` are reserved in names.** No id may have a word that starts with one
(`isNormalizedId`, and `private.is_normalized_id` by migration `0002`), so no name is ever
unsearchable by being read as an operator. `@` steers nothing now and stays
reserved: a loosened name rule admits names a later tightening could not take back. `yahoo!`, `c#` and `panic! at the disco` stay legal.

**Learned nearness, from the viewer's own list.** When no spelled reading answers a piece, an
attribute that goes with one it spells can:

    ρ(a,b)  =  Σ_i W(i)·p(i,a)·p(i,b)  /  ( κ_s + sqrt(Σ_i W(i)·p(i,a)² · Σ_i W(i)·p(i,b)²) )

over the things in the viewer's list, `p(i,a)` being `applies` (§2.4) of `a` on `i` for the
attributes somebody put there, each thing weighted by `W(i)`, how many followed accounts rated
the thing itself (§2.6), and shrunk by `κ_s = 1`, one account's worth, so one co-occurrence is
a hint rather than a law. The
piece then contributes `0.5 + w·ρ·(presence(b) − 0.5)`, discounted by how well the piece
spelled `a`. A relation can add a thing it implies has the word, and lower a thing already
found; it never removes one and never excludes. It is computed from the list the browser has
just computed, and recomputed only when that changes. It is the only reading of which
attributes go together that reaches a screen (§2.7); `TagRelation` is the seam where search
could take the fit's own attribute rows instead. A followed account that puts two attributes on the same things
moves `ρ`, bounded by `κ_s` and by the fact that the same ratings already move the list.

**When the query leaves the list empty**, the list says *nothing matches "xyzzy"* in its middle,
under the mark, the way an empty list says it has nothing yet (§1 item 7), quoting each word
nothing matched as typed (*"!#hipp"*); the add button stays where it is. A word that matches
nothing while the others find rows is not called out: it changes no row's order — every row
carries its 0.5 — and the rows are the answer.

**On screen.** Every attribute a query read gets the *match* chip tone and goes first, which is how a viewer
sees `late night` was read as one attribute. The bar belongs to the spelled attribute that
contributes least — the one that limits the fit — drawing how good an example of it the thing
is, and to the thing's own score when only the name was read. A row's chips are the attributes
the thing carries. With an operator in the query the *add* button stays where it is, **disabled**
(the design language's disabled state: half opacity, no pointer), because an operator is not
part of a name; the catalog lookup is skipped for the same reason.

**What it does not reveal** (§4): nothing is counted and nothing on a row says which account
it came from; a note names only words the viewer typed.

**Cost on a phone.** Folding and splitting each name and attribute is cached across keystrokes,
the list recomputes a step behind the field so typing stays ahead of it, and the relation is
built once per list. None of it is timed on the code as it stands.

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
- **Accounts in the list's field**, with `@` or above the things. A list of things with
  people mixed in is two searches in one field, and an operator to learn to tell them apart;
  finding someone to follow belongs with the vine.
- **`field:value`.** `#` says the same in one character, and the colon is ordinary
  punctuation in titles.
- **Quoted phrases.** The split finds `late night` on its own, and quotes are a second keyboard
  layer.
- **A fuzzy-search library.** `shared/` has no dependencies, and a library's score is opaque
  where this one is a probability.
- **Server-side search** (trigrams in Postgres). The list is computed in the browser and the
  server never holds it. The catalog lookup stays a prefix range.
- **Refusing every `!`, `@` and `#` in an id.** It would outlaw `yahoo!` and `c#` for no gain;
  only a word's first character is ambiguous.

### Non-goals (v1)

- Comments, reviews, text, photos, star scales. Thumbs only.
- Merging two items that are the same thing under two names — `café bleu` and `cafe bleu`,
  `café bleu` and `café bleu sf`. Identity by normalized name removes the case where the
  difference is only case or spacing. The accent is part of the id (§3.2), so for the accent
  case the catalog's stored `search_id` — the id with its accents and punctuation stripped,
  written beside it and indexed — stands in: typing either spelling finds the one that exists,
  in the catalog and not merely in the list the viewer already holds, so the second creator has
  to ignore it to make a duplicate. A merge tool is later, and it is the same tool the
  confusable case wants.
- Explaining recommendations. No screen says which account a bar came from, or how well any
  account predicts the viewer (§4).
- Live push of ratings. The list is computed when the app opens, when the tab comes back and
  when the vine changes (§3.4); a followed account's new thumb shows then.
- **An account page**, and with it any *about* text, and any page listing what an account
  rated, a prefilled one included. An account is a row.
- **A polished desktop.** The phone layout is what is designed; the desktop is what it
  degrades to.
- **Finding people.** No handle for a person, no search over people, no suggestions of people
  with taste like yours: each would put a stranger's name on a screen and give a stranger a
  second way to reach a person besides that person's own link (§4).
- **Defending against an account the viewer follows** (§2.1).

## 2. The model

> **Status: built**, in `rust/src/tensor.rs`, and it is what the app computes its list with.
> **Unproven** marks what rests on one measurement or on nothing yet.

### In plain words

Your list is a guess at one thing: **how you would rate each thing, if you rated it.**

- **A thing starts where the accounts you follow put it.** Their thumbs on it are averaged, each
  counted once, from a start of "as likely up as down": one thumb up is a lean, ten are close to
  a yes.
- **Then it is moved by how you differ from them.** Everybody's thumbs, yours included, are
  compared with that average. The ways people depart from it together are summed up in a few
  patterns (three, unless you change it on the map), and your own thumbs say how much of each
  pattern is yours. A thing you have not
  rated is moved up or down by that much.
- **With nothing of your own, you get the average.** A viewer who has rated nothing departs
  from nothing, and their list is what the accounts they follow say between them.
- **Liking a thing and each attribute of it are the same kind of statement.** *Good?* is one
  more question beside *a good fantasy?* and *a good book?*, and the patterns run across all of
  them at once.
- **Rating a tag says it applies; the thumb says how good an example.** A thumb down on
  `fantasy` is a bad fantasy. Not applying is said by leaving the tag off.
- **Only what somebody said gets a bar.** A thing or an attribute no followed account rated has
  no entry: nothing proposes an attribute nobody put on a thing.
- **Nobody you don't follow is heard.** Not the accounts your accounts follow, not the people
  following you.

### The computation, in order

One call per viewer `u`, `compute_user_tensor(snapshot, u)`, over `u`'s thumbs and the thumbs of
the accounts `u` follows. Nothing is kept between calls.

1. **The statements** (§2.2). *Who*: `u`, then each account `u` follows. *Things*: every thing
   any of them gave a thumb on, itself or an attribute of it. *Attributes*: liking the thing
   itself, which is attribute zero, then every tag any of them used. A thumb up is `+1`, a thumb
   down `−1`.
2. **What the followed accounts say** (§2.3) of each `(thing, attribute)` one of them rated:
   `m = (ups − downs) / (n + 2)` over the `n` of them that rated it. `u`'s own thumbs are not
   in it. Where no followed account spoke, `m = 0`.
3. **Departures** (§2.5). For every statement, `u`'s included, `d = thumb − m`. Every other
   cell of who × thing × attribute is `0`.
4. **The fit** (§2.5). `d[who, thing, attribute] ≈ Σ_k P[who, k] · T[thing, k] · A[attribute, k]`
   at rank 3, by alternating least squares over every cell, the zeros at full weight, from
   factors started at a fixed seed. A sweep solves each mode in turn (who, things, attributes);
   sweeps repeat until one lowers the squared error by less than `10⁻⁵` of it, 1 000 at most.
5. **Scores** (§2.6). For every thing a followed account said anything about, and every
   `(thing, attribute)` a followed account rated: `m` plus `u`'s row of the fit, held strictly
   inside `(−1, 1)`. Beside it, how many followed accounts made the statement.

Every map is sorted and the starting factors come from one fixed seed, so one snapshot's result
is bit-identical run to run.

### 2.1 Goals, and what it does not defend

Everything below is per viewer `u`. The output is, for every ratable a followed account
answered, a score `s_u(x) ∈ (−1, 1)` and a count `n ≥ 0` of the followed accounts that answered
it.

Requirements, in priority order:

1. **Personal**: `s_u` is a function of `u`'s thumbs and the thumbs of the accounts `u` follows,
   and of nothing else. No global score and no aggregate over anybody `u` did not choose.
2. **Chosen**: every voice in a list is one its viewer followed. An account `u` does not follow
   changes nothing — not by rating, not by following `u`, not by being followed by someone `u`
   follows (`rust/src/tensor.rs`, `an_account_the_viewer_does_not_follow_is_not_heard`).
3. **Moved by the viewer's own thumbs**: how `u` departs from the accounts they follow is
   fitted from what `u` has rated (§2.5), not assumed.
4. **Useful from the first follow**: a viewer with no thumbs of their own gets a score for
   everything a followed account rated, which is what those accounts say (§2.3).
5. **Unbreakable by a row**: nothing a followed account can write fails the viewer's list.
   Values and keys are sanitized, never refused, and a non-finite result is an error rather than
   a bar.
6. **Discreet on screen**: no screen shows who rated what (§4).

**Following is the defense, and the only one.** Nothing in the model guards a viewer against an
account they follow:

| What a followed account does | What happens |
|---|---|
| Rates one thing dishonestly. | Its thumb is one of the `n` in the accounts' mean (§2.3): alone on a thing it puts the thing at `±1/3`, and among `n` it moves the mean by at most `2/(n + 2)`. Its departure is also one cell of the fit. |
| Copies the viewer's thumbs. | Nothing asks whether a thumb came before or after the viewer's. Its row of the fit is fitted to the same departures as the viewer's, so where it departs from the other accounts on a thing the viewer has not rated, the viewer's score can move the same way. Nothing caps that. |
| Puts an attribute on a thing. | The attribute gets an entry. Alone and thumbed up it scores `1/3`, which is above zero, so the thing is shown as carrying it (§2.4). It is outvoted only by other followed accounts thumbing the attribute down there. |
| Rates thousands of things. | Each lands in the viewer's list, at `±1/3` where nobody else rated it. Its statements are that many more of the cells the fit answers to, so the two patterns are fitted more to it than to an account that rated little. |

The remedy for all of it is the same: **unfollow**, and the account is out of the next
computation entirely. Prefilled accounts are made by the owner. The other direction needs no
model: a follower reads the viewer's thumbs (§4) and changes nothing in the viewer's list, and
the viewer can remove them.

### 2.2 The statements

A thumb is a statement by somebody, about a thing, on a question: *good?* for the thing itself,
*a good example of it?* for an attribute. So the thumbs the browser holds are a table with three
sides — who said it, the thing, the attribute — and one cell per statement, `+1` or `−1`.

**Who** is the viewer and each account the viewer follows, and nobody else. The viewer is the
first row. An account that follows the viewer, or that a followed account follows, is not a row.

**Liking is attribute zero.** A thumb on the thing itself is one more attribute beside the
tags. Nothing else joins a thing's own rating to the ratings of its attributes: they share the
thing's row of the fit (§2.5), and that is the only way a thumb on `fantasy` can say anything
about whether the viewer would like the thing.

**Most of the table is empty.** Nearly every account has said nothing about nearly every thing
and attribute. The table is never built: the statements are a list, and everything computed
from the empty cells is computed without visiting them (§2.5).

### 2.3 What the followed accounts say

For a `(thing, attribute)` that `n` followed accounts rated, with `ups` of them up:

    m  =  (ups − downs) / (n + 2)

This is the mean of their thumbs under a uniform prior on the share that are up: the posterior
mean of that share is `(ups + 1)/(n + 2)`, Laplace's rule of succession, and `m` is that share
on the thumb's own scale, `2p − 1`. One thumb up is `1/3`; ten that agree are `10/12`; five
each way are `0`. **The `+ 2` is all the caution there is**: a thing little stands behind sits
near the middle because its mean does, and nothing shrinks it a second time (§1 "The bar").

**Each followed account counts once, and all alike.** There is no weight per account and no
reliability: an account the viewer has agreed with a hundred times and one they have never
shared a thing with put the same `±1` into `m`. What tells them apart is the fit (§2.5).

**The viewer's own thumbs are not in it.** `m` is what the viewer is given before anything of
their own says otherwise, and the viewer's thumb on a thing is measured against it (§2.5).

**No order.** A thumb counts the same whether it was given before the viewer's or after. The
database keeps when a thumb was given and hands no client any of it (§3.2), so the browser has
no order to read.

**Where no followed account spoke, `m = 0`.** That covers a thing only the viewer rated, and
the thing itself where followed accounts rated only attributes of it.

### 2.4 Tags: applies, and how good an example

**A rating of a tag says two things at once.** That it exists says the tag applies: nobody
thumbs `fantasy` down on a cookbook, they leave it off. Which way it points says how good an
example the thing is. Reading a thumbs-down as "does not apply" instead needs two words for
every idea with a valence (`fantasy`, `good fantasy`), asks people to make a statement almost
nobody makes, and leaves the down thumb on `fantasy` meaning two things at once. That is what a
person's own thumb means, on every screen: the viewer's own thumb down on `fantasy` leaves the
thing a fantasy (§3.5).

**The core computes one number for an attribute on a thing**, the score of §2.6: how far the
viewer would call the thing a good example of it. It does not estimate whether the attribute
applies apart from that. What it returns as `applies` is the same number on `(0, 1)`:

    applies  =  (1 + s) / 2

so an attribute is shown as carried when its score is above zero (§3.5), and
**a bad example sits below an attribute nobody mentioned**: a thing the followed accounts call
a bad fantasy is not drawn with `fantasy` on it, and a search for `fantasy` puts it under the
things nobody tagged at all, which sit at one half ("Search").

**An attribute left off says nothing.** Only a rating is a statement. An account that tagged a
thing and did not use a word has an empty cell there, like everybody who never saw the thing.

**What follows, and is not fixed:**

- **Nobody can say "this is not a fantasy".** The viewer's own remedy is not to rate it. A
  followed account's label is answered only by other followed accounts thumbing it down.
- **What the viewer is shown of other people's bad examples is their absence.** The two halves
  of the statement are told apart for the viewer's own thumbs and folded into one number for
  everybody else's.
- **A thumb on a tag reaches the thing's own score only through the fit**, by way of the row
  the thing shares across its attributes (§2.2). How far it does is not measured.

### 2.5 How the viewer departs: the decomposition

**Departures.** Every statement, the viewer's included, is turned into how far it is from what
the followed accounts say of that cell:

    d[who, thing, attribute]  =  thumb − m(thing, attribute)

and every cell nobody filled is `0`. A followed account that agrees with the rest departs
little; one alone on a thing departs by `±2/3`; the viewer's thumb on a thing nobody followed
rated departs by `±1`.

**The fit.** The departures are fitted by a CP decomposition of rank `RANK = 3`:

    d[who, thing, attribute]  ≈  Σ_k  P[who, k] · T[thing, k] · A[attribute, k]

Each `k` is a pattern: some people depart upward on some things for some attributes, together.
`P` says how much of each pattern a person has, `T` a thing, `A` an attribute. Nobody declares
what a pattern is. It is fitted by least squares over **every** cell, alternating: with two of
`P`, `T`, `A` held, the third is a linear least-squares problem, and a sweep solves the three in
turn.

**The zeros count in full, and that is the design.** A cell nobody filled is fitted as a
departure of zero at the same weight as a statement. Three things follow.

- *It is what holds the fit in.* A fit over the statements alone can put anything in the cells
  nobody filled, which are the cells the list is read from. Against a table that is nearly all
  zeros, a pattern has to earn its size from statements that agree. The ridge below is far too
  small to do this.
- *It is what makes a sweep cheap.* At equal weight every row of a mode has the same left-hand
  side, the entrywise product of the other two modes' `RANK × RANK` Gram matrices, so it is
  factored once (Cholesky) and each row's right-hand side is a sum over that row's statements.
  A sweep is one pass over the statements, however large the table.
- *It says "no statement" is "no departure"*, which is false for a thing a person never saw,
  and is the benefit of the doubt of §2.3 written as an assumption.

**Ridge.** `10⁻³` is added to the diagonal of every system, so that it can be solved when a
factor's columns line up. It is there for solvability and not as a prior.

**When it stops.** After the first sweep that lowers the squared error by less than `10⁻⁵` of
the departures' own squared size, or after 1 000. Measured against the departures and not
against the error that is left: with one or two accounts followed the fit is nearly exact, what
is left keeps shrinking by a steady share of itself, and a rule relative to it never fires. On
real ratings two fits from different starts then rank a viewer's things alike in thirty to
forty-five sweeps; a rule a hundred times stricter measured no different.

**One seed.** The factors start as small random numbers from a fixed seed. Alternating least
squares can end in different places from different starts, so the seed is part of the model:
the same snapshot gives the same list on every device and every open
(`the_same_snapshot_gives_the_same_result`,
`the_result_does_not_depend_on_where_the_fit_starts`).

**Why rank 3, and what else is built.** Ranks one to six measured alike on real ratings (§2.8).
The rank is a compile-time parameter of the whole fit, so that its loops unroll, and the wasm
build carries each from 1 to 6 (`tensor::MOST`). `computeUserTensor` takes which as an
argument, and the app passes the rank the device keeps (`web/src/lib/utils/taste-rank.ts`):
3 until the viewer changes it on the map, kept in `localStorage` under `grapevine-rank` as the
theme is, and not forgotten on sign-out. It changes the list as well as the map, since the
scores come from the same fit, so a change computes the list again. At 2 a thing's two numbers
are a place in the plane; at any other the things have to be laid out (§2.6 "The picture").

**What the fit does for the viewer.** The viewer's row `P[u, ·]` is fitted to the viewer's own
departures. A viewer whose thumbs go with one account's against another's gets a row like the
first's, and on a thing the two split on, the score moves toward the first
(`the_account_that_agrees_with_the_viewer_counts_for_more`). With only those two accounts
followed there is too little to tell them apart by, and the thing sits near the middle
(`two_accounts_that_split_leave_a_thing_near_the_middle`).

**A viewer who has rated nothing** has no departures, so their row is exactly zero and their
scores are exactly `m`. A viewer who shares no thing with any followed account is given what
those accounts say as well
(`a_viewer_who_shares_nothing_with_anybody_leans_the_way_the_accounts_do`).

**No kinds, no record, no reliability.** Nothing computes how well an account predicts the
viewer, per kind of thing or at all; nothing reads the viewer's own record on a tag as a
separate step. That an account is right about films and wrong about restaurants, or that the
viewer likes most fantasy, can only show up as a pattern, and with a few patterns most of it
does not.

### 2.6 Scoring every thing

**The score.**

    s_u(thing, attribute)  =  m(thing, attribute)  +  Σ_k P[u, k] · T[thing, k] · A[attribute, k]

held to within `10⁻⁹` of the ends, so it is strictly inside `(−1, 1)`. For a thing it is how far
the viewer would like it; for an attribute on a thing, how far the viewer would call it a good
example. `m` is a chance on the thumb's scale (§2.3); the second term is a least-squares
estimate and not a probability, so the sum is a score and is read as a chance only loosely.

**What gets an entry.** Every thing a followed account said anything about, and every
`(thing, attribute)` a followed account rated. A thing whose attributes were rated and which
nobody followed rated itself has an entry with `m = 0` and a count of zero: its score is the
viewer's fitted departure alone. A thing or an attribute only the viewer rated has no entry.
With nobody followed, or nothing said by anybody followed, the result is empty.

**What an entry holds** (`Score`):

| field | what it is |
|---|---|
| `score` | `s_u`, above |
| `confidence` | `n`: how many followed accounts made the statement |
| `applies` | `1` for a thing; `(1 + score)/2` for an attribute on a thing (§2.4) |

**The count is not a certainty.** It is not folded into the score a second time, by the core or
by the client: `m` already holds how few thumbs stand behind it. The client uses it only to
break a tie between equal scores, and never draws it (§4).

**The viewer's own thumb on a thing is in the fit** — it is a departure like any other — **and
not in `m`**. A rated thing's score is therefore a fitted value at a cell the fit was given, not
a held-out prediction of it.

**No floor.** Every thing a followed account rated has an entry. Nothing hides one.

**An absent tag is "nothing is known".** A `(thing, tag)` with no entry was put there by nobody
the viewer follows. That is weaker than "it does not apply".

**The picture** (`tensor::decompose`, `Plot`). The same fit gives a point per thing and a point
per attribute, each of as many numbers as the rank, such that the viewer's fitted departure for
a thing and an attribute is the inner product of the two points. The viewer's own row is folded into the
things, so the viewer is not a point: they are how far each axis is stretched. Each axis is
turned so that liking has no negative coordinate, and scaled so that things and attributes
spread equally far along it. `decompose` returns it beside the result, the squared error the
fit ended at and the number of sweeps. The wasm call returns it beside the scores, as `plot`:
`things`, a point per thing by name, and `attributes`, a point per attribute by name, the empty
name being liking (§3.4).

**The map** is that picture drawn, on the people screen: the row *see how your taste differs*
opens a sheet (`components/taste-map-sheet.svelte`, `utils/taste-map.ts`). Up to 600 things
are drawn, each a dot that never moves: the viewer's own rated things first and then the rest,
of either the ones furthest from the centre. Six hundred is a cap on all of them together,
because the layout visits every pair of dots at every step. The page holds and caches the plot
cut down to what a map could draw (`trimPlot`), not a point for every thing in reach.
Under them is a row of chips: a thumbs-up for liking, then the viewer's own attributes. The
chip picked colors each dot by its inner product with that attribute's point: grey at nothing,
teal the further above, red the further below. A tap on a dot names the thing and offers to
open it. No axes and no lines are drawn, and no attribute is a mark on the plot.

Where a dot sits depends on the rank. At 2 it is the thing's own two numbers, turned so that
liking points up, and each chip's two colors meet on a straight line through the middle. At
any other the core lays the things out (`rust/src/layout.rs`, `layOut` over wasm), asked for
by the sheet when it opens and worked out in the worker. At 1 that is a line. From 3 up it is
t-SNE, started along the two directions the points vary most in so that the same list gives
the same picture: things that sit together came from together, and nothing else about the
positions means anything. The colors are exact at every rank; from 3 up the positions are a
look, not a measurement.

The rank is changed on the map itself, with two buttons beside the number in its corner: up
for one more number a thing, down for one fewer.

**Non-finite is an error.** A system that cannot be factored, an error that is not finite, or a
score that is not finite ends the call with `CoreError::Divergent`, never with a result.

### 2.7 Tags that go together

**Nothing infers a tag.** No step links pairs of tags that keep landing on the same things, and
none proposes a tag nobody put on a thing: a `(thing, tag)` no followed account rated has no
entry, and neither the core's answer nor the client has a way to say that one was guessed.

**What stands in for it.** Two tags that go together are, in the fit, two attributes with
similar rows of `A`. That moves scores only at cells that already have an entry. And search
has its own, cruder reading of which attributes go together, from the list the browser has
just computed (§1 "Search", learned nearness), which can reach a thing through an attribute
that goes with the one typed.

**Things with things, and a low rank over whom.** A low-rank structure fitted over everybody's
ratings would be a global aggregate, which §2.1 rules out and which no browser could be handed.
The decomposition is fitted per viewer, over that viewer and the accounts they follow, on
thumbs the viewer is already entitled to read. That is the whole of what it knows, and why it
has little to work with for a viewer who follows few accounts.

### 2.8 What it measures

Measured on real ratings: MovieLens 25M, 80 people. For each, followed accounts were sampled in
proportion to the movies they share with that person, and 30% of the person's movies were held
out whole, the movie's rating and every tag on it. Area under the ROC curve, three ways:
*liking* (the held-out thumbs on movies), *own tags* (the person's held-out tags) and *search*.
With 25 followed accounts:

| | liking | own tags | search |
|---|---|---|---|
| the decomposition (§2.5), what the app runs | **0.721** | 0.570 | 0.647 |
| the model this replaced, since removed from the crate | 0.710 | **0.584** | **0.675** |
| the plain share of followed accounts that are up | 0.720 | 0.581 | 0.666 |

Read plainly: on liking the three are within about a hundredth of each other, and the
decomposition is ahead of the plain share by a thousandth. On the viewer's own tags and on
search it is behind both. **The fit adds almost nothing to §2.3's mean on this measurement, and
costs something on tags.** Ranks one to six measured alike.

The program that produced these is not in the repository, and neither is the data.
**The simulator's worlds (`rust/src/sim.rs`) are not trusted for comparing models.** The
simulator is kept for what it is used for: the world `seed:local` loads, the viewer
`rust/examples/cost.rs` times, and the test that every score in a simulated world is finite
and inside the ends.

### 2.9 Parameters

All constants, in `rust/src/tensor.rs`. Nothing is learned across viewers, and nothing is
passed in but the rank: the wasm call takes a snapshot, a viewer and how many components to
fit.

| name | value | why |
|---|---|---|
| the mean's prior | `+ 2` in `n + 2` | a uniform prior on the share of thumbs that are up (§2.3) |
| `RANK` | 3 | ranks one to six measured alike; each from 1 to `MOST = 6` is built, and the viewer may pick (§2.5) |
| `RIDGE` | `10⁻³` | so every system can be solved; too small to shape the fit |
| `TOLERANCE` | `10⁻⁵` | a sweep that lowers the squared error by less than this share of the departures' squared size is the last |
| `SWEEPS` | 1 000 | after which the fit is taken as it stands |
| `SEED` | fixed | where the factors start, so one snapshot gives one result |
| starting scale | 0.3 | the factors start as normal draws times this |
| `EDGE` | `10⁻⁹` | how close to an end a score may come |

`Options` lets a measurement vary the seed and the tolerance; `compute_user_tensor` uses the
defaults. There is no parameter table to refuse: `rust/src/params.rs` is gone.

### 2.10 Where it comes from, what it does not do, what it costs

**Standard, and where from.**

| part | source |
|---|---|
| the mean under a uniform prior | Laplace's rule of succession |
| a three-way table as a sum of rank-one terms | CP / PARAFAC (Carroll & Chang 1970; Harshman 1970; Kolda & Bader, *SIAM Review* 51, 2009) |
| alternating least squares | the same |
| fitting every cell, the empty ones as zeros, through shared Gram matrices | whole-matrix least squares for implicit feedback (Hu, Koren & Volinsky, ICDM 2008), here at one weight for every cell |

**Original to grapevine, and unproven:** fitting departures from the followed accounts' mean
rather than the thumbs; liking as one more attribute; fitting one small tensor per viewer over
only the accounts they follow; reading a rating of a tag as two statements and returning one
number for it (§2.4).

**What it does not do**, each a choice:

- **Hear anybody the viewer does not follow.** Not the accounts a followed account follows, no
  people like you, no population statistics. It is what makes the model small enough to run in a
  browser on thumbs the viewer is entitled to read, and what makes "who is in my list" a
  question with an exact answer.
- **Defend against a followed account** (§2.1). No cap per account, no cap per thumb, no
  discount for a thumb given after the viewer's, no copy detection.
- **Weigh one followed account above another** in what the accounts say (§2.3).
- **Estimate whether a tag applies** apart from how good an example the thing is, or
  **propose a tag** nobody put on a thing (§2.4, §2.7).
- **Say how sure it is.** The count beside a score is a count.
- **Learn anything across viewers.**
- **Update from a change.** Every computation is from scratch, over every thumb.

**What one list costs.** Natively, on the MovieLens people of §2.8: about 15 ms a person with
10 followed accounts, 29 ms with 25 and 60 ms with 40. A sweep is one pass over the statements
(§2.5), so the cost is the number of statements times the number of sweeps.
`cargo run --release --example cost` times one call on a made-up viewer of a given size
(`--follows`, `--items`, `--own`, `--each`, `--tags`, `--runs`).

The app runs the same code as WebAssembly in a worker; that build, and a phone, are not timed.
§3.4 says why it runs there.

### 2.11 Attribute similarity: proposing attributes to apply

**What it is for.** The entity screen ends in a row of dashed chips headed *suggested* — the
attributes this viewer might want to apply to this thing. The problem it solves is that an
attribute nobody has ever put on a thing does not exist for it, and a viewer who would happily
answer "is it *quiet*?" is never asked. The suggestion is the ask. It is not a recommendation
and it is not a score: a chip proposes a question, and the answer is the viewer's own thumb.

**The rail has one source: the viewer's own words**, by `shared/src/suggest-attributes.ts`,
which is the rest of this section. The model proposes nothing: the decomposition has no entry
for an attribute nobody put on a thing (§2.7). The rail reads the viewer's own ratings and
nothing else — not a followed account's, not the computed list, not any aggregate over anybody
— so nothing anybody else does can reach it, it runs with no round trip, and the row re-ranks
the instant a thumb is given. It can only ever propose a word the viewer has already used,
which is the feature: the viewer can type any attribute they like, so their vocabulary grows
on its own.

**The estimator: maximum coverage over your own history, chosen greedily.**

Let the viewer's history be the things they have rated, each carrying the attributes they rated
on it — **either thumb counts**, since either says the attribute applies. For a candidate attribute `t`, let `U(t)` be the
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
attributes. **This source gives at most five chips**, which is what fits two lines at the chip sizes
`web/DESIGN-UI.md` gives. Rating one more attribute re-ranks the whole row, which is free here
because the computation is local.

**No floor, and no quiet mode.** A viewer who has rated five attributes gets those five
proposed. The row is a convenience, not a claim, and the most-used-of-five is still a better
guess than an empty row. A viewer who has rated no attributes at all gets the heading over an
empty rail, never filler.

**What it must satisfy:**

- **No attribution, ever.** A chip says *suggested* and nothing more. Not "people like you", not
  "3 people in your vine", not a source (§4).
- **No number is shown.** No bar, no count, no rank that reads as a score. Rank order within the
  row is allowed; it is what a list is.
- **It changes no score.** A suggested attribute the viewer ignores leaves the list exactly as it
  was. Only a thumb moves anything.
- **It proposes questions rather than answers.** Nothing anybody else does can reach it: its
  one source is the viewer's own words.

The rule that a chip tapped but never thumbed creates nothing is §1's (item 4 of "The one view").

## 3. System design

### 3.1 Stack

SvelteKit static export on GitHub Pages, Svelte 5, Tailwind, Biome, Bun for scripts and tests. The
backend is **Supabase**: Postgres with row-level security, PostgREST in front of it, GoTrue for
auth, and Realtime for the one channel that has to feel live. **There is no server of ours in
any request**: no Edge Function, nothing that computes. The list is computed in the browser, by
the Rust core built to WebAssembly (§3.4). **Nothing runs on a schedule outside the database**
(§3.7). Repo layout:

    web/            SvelteKit app (static export). The only thing a user touches
    shared/         pure TypeScript used by web/: id normalization, the search fold,
                    search, attribute suggestions, folding the core's scores into a
                    list, reading other services' export files
    rust/           the one Rust crate, no I/O: the model of §2 (`src/tensor.rs`), the
                    simulator, their tests; built to WebAssembly by wasm-pack
    supabase/       config.toml (auth providers and redirect URLs, in the repo),
                    migrations/ (schema, grants, policies, functions, cron),
                    tests/ (pgTAP), seed.sql
    prefilled/      the prefilled accounts' thumbs, written by hand
    scripts/        build-wasm.sh, generate-name-rules.ts, load-prefilled.ts
    .github/workflows/  ci.yml, web.yml (deploy)

**The database's whole job is to store thumbs and to decide who may read whose.** Nothing in it
computes anything about a person, and nothing a server computed is stored. That is what lets
every user action be a direct PostgREST write under row-level security, and what makes the
privacy question of §4 one about read policies rather than about a server's good behavior.

`rust/` is the only place the model lives. It takes a snapshot in, returns scores out, and does
no I/O, so `cargo test` runs it and the simulator in seconds against nothing.
`scripts/build-wasm.sh` builds it for two targets: `web` into `web/core-wasm/`, which the
browser's worker loads, and `nodejs` for `rust/examples/smoke.mjs`, the one thing that runs the
boundary outside a browser; CI builds both. Neither build is committed. One crate, so the code
the browser runs is the code the tests and `rust/examples/cost.rs` run natively.

### 3.2 Postgres schema

Column names are `snake_case`; the client sees them through PostgREST under the same names.

```sql
profiles          (id uuid pk, display_name text, photo_url text, created_at,
                   prefilled boolean, handle text unique, tags text[])
                  -- a person or a prefilled account; a handle if and only if prefilled,
                  -- tags only if prefilled
follows           (follower_id, followed_id) pk, since timestamptz        -- one way
invite_links      (owner_id uuid pk, token text unique, created_at)
                  -- at most one link per person; the token is readable by its owner only
items             (id text pk, search_id text not null, created_at, created_by uuid)
                  -- id IS the name; search_id is it with accents/punctuation stripped,
                  -- client-written from `searchFold`, its own text_pattern_ops index,
                  -- checked by a script rather than by a trigger (below)
ratings           (user_id, item_id, tag) pk, value smallint, rated_at timestamptz,
                   revision bigint
                  -- neither rated_at nor revision is in any client's grant; nothing
                  -- reads rated_at, and revision is what a follower's read is cut by
reports           (user_id, item_id) pk, created_at      -- insert only; nobody reads one
item_refs         (item_id pk -> items on delete cascade, source, ref, created_at,
                   created_by uuid), unique (source, ref)
                  -- insert only; a thing's link to Wikipedia (Wikidata's Q-id) or
                  -- OpenStreetMap (n/w/r and the id); no URL, description or position
private.ratings_revision (user_id pk, revision bigint, salt uuid, floor bigint)  -- trigger-written, §3.4
private.ratings_cleared  (user_id, item_id, tag) pk, revision, cleared_at    -- trigger-written, §3.4
private.debug_events  (id, user_id, kind, detail, at, expires)
private.write_budget  (user_id, day) pk, writes                       -- trigger-written
private.deleted_identities (fingerprint pk, day, writes)             -- §4, swept daily
private.import_sources (source pk)                                    -- what can be imported from
private.imports       (user_id, source) pk, started_at, thumbs        -- written by import_thumbs
private.deleted_imports (fingerprint, source) pk, started_at, thumbs  -- §4, swept daily
private.removed_names (id pk, removed_at, purged_at)                  -- the owner's, §4
private.ref_sources   (source pk, pattern)                            -- one row per index
private.removed_refs  (source, ref) pk, removed_at                    -- links taken off, §4
private.admins        (user_id pk, added_at)                          -- written by hand, §4
```

- **A profile is not a foreign key to `auth.users`**, because a prefilled account has no
  sign-in. A person's row is created by a trigger on `auth.users` with that account's id and
  removed by a second one, and everything else about a person hangs off the profile by
  `on delete cascade`. `prefilled` and `handle` go together by a `CHECK`: a prefilled account
  has a handle (`^[a-z0-9][a-z0-9_.]{1,30}$`), which is what it is loaded by and what the people
  screen's search finds, and a person has none. `tags` is the attributes a prefilled account's thumbs use,
  those on the most things first, and null for every person by a second `CHECK`. It is stored
  because nobody who does not follow the account can read its thumbs, and finding it comes
  before following it. `load_prefilled` writes it from the thumbs it has just loaded, so the
  file stays the one source, and no client may write it; `remove_name` takes a removed name
  out of it at once, since unlike a thumb it is read by people who follow nobody. `photo_url` is null or starts `https://`: a link's holder is
  shown it before signing in, so it is a URL a stranger's browser is handed.
- **A follow is one row, one way**, and no client inserts one: three functions do, each saying
  why the caller may follow that account (§3.3). Either end may delete it. No name is copied
  onto the row, since either end can read the other's profile, so a rename is a change to the
  only copy.
- **One link per person, keyed by its owner.** `set_invite_link()` mints 32 random bytes as 43
  characters of base64url and writes them over the owner's row, so the old token stops working
  in the same statement; deleting the row turns the link off. The token is stored as itself,
  not hashed, because the owner has to be able to copy it again at any time: the select policy
  admits the owner's own row only, so a filter on `token` finds nothing that is not already the
  caller's, and `owner_id` is in no select grant. What that gives up against a hash is that a
  copy of the database is a copy of everyone's links — and whoever holds the database holds the
  thumbs a link would open anyway. `invite_owner(text)` and `redeem_invite(text)` take the
  exact token and touch at most one row. There is no insert and no update grant: a token is
  made on the server.
- **An item's id is its display text, and there is no `tags` table.** `items` holds `id`,
  `search_id`, `created_at` and `created_by`; the grants are `insert (id, search_id)` and
  `select (id, search_id)`, so the client writes both, from the one `searchFold` in `shared/`,
  and `created_at` and `created_by` are the server's. A tag has no row anywhere: it exists
  because somebody rated it. `"Late Night"` normalizes to `late night`, which is what a person
  would write and what every screen shows.

  What that costs is the creator's capitalization, everywhere: `"Café Bleu"` is stored and
  shown as `café bleu`. §1 "The one view" puts the whole interface in lower case, so a stored
  capital would be a spelling nothing renders, and dropping it removes a second field per name,
  the rule that would keep it immutable, a client cache in front of it and the branch where a
  name is missing. A thing with no `items` row can appear in a list — a ratings row can name an
  id nobody created — and that is harmless, because the id has been through the same folding
  and the same `CHECK`s the catalog holds and renders as the same plain text. `items` is the
  catalog: what creation spends a write budget unit on, and what the prefix search over things
  nobody the viewer follows has rated reads.
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
  the one reference to a person that does **not** cascade: `on delete set null`, because a
  thing's name is shared, permanent and pointed at by everyone's ratings, so the row has to
  outlive its creator. Null there means "added by an account that is gone", or by a prefilled
  account's load; any other `on delete` action would make an account that ever added a thing
  impossible to delete.
- **Nothing computed is stored.** There is no table for a list, a score, a fit or a
  copy of anybody's thumbs: the list lives in the browser that computed it (§3.4).

Three things the schema says directly:

- **There is no column for an email address or a phone number**, so there is no key to park one
  under. A contact detail exists in exactly one place, the auth account, in a schema the API does
  not serve and no policy exposes — which is a narrower claim than "it is not in the database",
  and is the one worth making.
- **A rating's value is validated, and its key is columns.** One row per thumb means
  `check (value in (1, -1))`, and the thumb is keyed by `(user_id, item_id, tag)` — `tag` **not
  null**, with the empty string meaning the thing itself rather than one of its tags. On the
  thing, `value` is good or not; on a tag, **the row existing says the tag applies and `value`
  says how good an example of it the thing is**, so "does not apply" has no row. Each
  field carries the id `CHECK` on its own, and `tag` carries it or is empty. `item_id` is not a
  foreign key: a thumb can name a thing nobody created a catalog row for. The sanitizers on
  both sides of the wasm boundary stay — `sanitizeRatings` in `shared/` and `to_snapshot` in
  the crate — because a followed account's rows are input the viewer did not write, and they
  check the two fields separately.

  **Inside the core one map key per rated thing is still wanted**, and the two fields join
  there with a **NUL** (`\0`): `café bleu` for the thing, `café bleu\0coffee` for one of its
  tags. Postgres text cannot contain a NUL at all — the server refuses the byte on input — so
  no name anybody can type can forge the join or smuggle a second separator into a half, which
  matters because an id is any script's letters and punctuation and no pattern could enumerate
  what a half may contain. The join is the core's and the wasm boundary's; it is never stored,
  never queried and never shown.
- **A thumb carries its own clock, and nothing reads it.** `rated_at` is when the thumb was
  first given, on the server's clock, and it is in neither the insert grant nor the select
  grant: a follower reading when somebody rated each thing would have a record of that
  person's days. Nothing in the database reads it either. It is kept because history cannot be
  backfilled, and `/privacy/` says a rating is stored with when.
- **"What changed in this account's thumbs?" is a counter, not a clock.**
  `private.ratings_revision` holds one number per account, and every thumb written takes the
  next one into `ratings.revision`, by a trigger, whatever role wrote it: a client, an import,
  a reload of a prefilled account. Writing the value a thumb already has takes none. A cleared
  thumb takes one too and leaves a **tombstone** in `private.ratings_cleared`, because a
  deleted row cannot say it was deleted; giving the thumb again deletes the tombstone, so a
  key is never both. A thumb on a removed name leaves none: every reader was sent back for a
  full read when the name went, and a tombstone would hand the removed name to followers for
  another month. Tombstones are swept after 30 days, and the sweep raises the account's
  `floor` to the highest revision it swept, so a reader older than that is answered in full.
  Neither column is in any client's grant: a revision counts an account's changes, which is
  nobody's to watch. §3.4's stamp is a digest of the counter under a salt that is random,
  fixed and never readable, so the same revision is a different stamp for every account and
  a stamp cannot be turned back into a count. A digest of how many thumbs an account has and
  when the newest was given is rejected: the count is a follower's to see and a timestamp has
  few enough values to try them all, so it gives the time away.

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
- **Anything off the allow-list** (migration `0002`). An id is ordinary letters, numbers and
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
  list is a new migration that, like `0002`, refuses to apply over an existing id it
  would refuse, since Postgres does not re-check old rows and an id cannot be renamed.
- **A word that starts with `!`, `#` or `@`** (also `0002`). Search reads each at a word's
  front (§1 "Search"), so a name with a word like that could not be found by typing it. Anywhere else
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
the list the viewer already holds. Two alternatives are rejected:

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
the collation is not `C`. Inside the list, which is where most searching happens, the match is
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
adding a second one is shown the first. This is bounded and not prevented:
nothing stops a determined account creating a homograph of an existing thing, and if nobody
searches for it nothing will surface it. What it buys is that the accident — two honest people,
two keyboards — is caught, and the attack costs a write budget unit per name and gains a
duplicate catalog row rather than anybody's ratings. The remedy if it is ever used in anger is
the one §4 gives a misleading name: a report, and removal by an admin.

### 3.3 Row-level security

Five conventions:

- **Schema isolation.** Anything no client may touch lives in schema `private`, which is not in
  PostgREST's exposed list — not a policy that can be got wrong, an address that does not exist.
  The diagnostics table, the budgets, the removed names, the admins, every policy helper and the
  prefilled accounts' loader live there.
- **Column privileges.** `GRANT INSERT (id, search_id)` on `items`: a column the client cannot
  write takes its default, and a column it cannot select is in no response. This is what makes
  `created_at`, `created_by`, `since`, `rated_at`, `at` and `expires` unforgeable, and
  `rated_at`, `created_by` and a link's `owner_id` unreadable.
- **Table privileges.** "No update verb and no delete verb, for anyone" is a `REVOKE`. Every
  grant is taken away first and then named back, so a client privilege exists only because the
  migration wrote it down.
- **A daily write budget, in the database.** Every rating insert or update, every item created,
  every link added to a thing, every link turned on or replaced, every follow, every report and
  every diagnostics event draws on one allowance per account per UTC day, a number written once,
  in `private.daily_write_limit()`; deletes draw nothing. A `security definer` BEFORE trigger
  (`private.count_write`) counts against `auth.uid()` in `private.write_budget` and refuses the
  write past the allowance with SQLSTATE `PT429`, which PostgREST serves as HTTP 429 and the
  client says in a sentence with no number in it; the three follow functions spend the same
  budget through `private.spend_write`. The client cannot be what holds itself to this, since a
  crafted client is the case a budget exists for. A connection with no request identity — a
  migration, the owner, a scheduled statement — is not counted, and a scheduled statement
  deletes past days.
- **No policy reads another table directly.** Every cross-table predicate goes through a
  `security definer stable` helper in `private` — `following()`, `followers()`, `is_removed`,
  `unpurged_names()`, `is_ref_removed` — so RLS never nests and never recurses. Policies say
  `(select auth.uid())`, never bare `auth.uid()`, so the planner evaluates it once per statement
  instead of once per row; `following()` returns one array for the same reason, so a read of
  several accounts' thumbs is index probes on the key's first column rather than a probe of
  `follows` per row.

**The policies** are short:

- **`profiles`**: readable by its owner, by anyone it follows, by anyone following it, and — a
  prefilled one — by everyone signed in, its handle and tags included. Updatable by its owner,
  name and photo only, never a prefilled one. No insert and no delete for any client.
- **`follows`**: a row is readable and deletable by the two accounts it names, and insertable by
  no client. So a person can list whom they follow and who follows them and nobody else's
  follows at all; who follows a prefilled account is no client's to read, since no session is
  that account.
- **`ratings`**: readable by its owner **and by every account that follows the owner**; written
  by its owner alone. This is the policy the product rests on: the list is computed in the
  browser, so the browser has to be handed the followed accounts' thumbs. Unfollowing, or being
  removed as a follower, ends the read with the row. A second, restrictive policy hides every
  thumb on a removed name from the moment of removal (§4).
- **`items`** and **`item_refs`**: readable by everyone signed in and insertable by them, with no
  update and no delete; restrictive insert policies refuse a removed name or a removed link.
- **`invite_links`**: readable and deletable by its owner alone.
- **`reports`**: insertable by its author and readable by no client.

**The whole of what a client may call**, and it is short, because a stored procedure here is a
transaction rather than a server:

- `set_invite_link()` (after `has_credential()`; mints a token over the caller's one link and
  returns it), `invite_owner(text)` (the name and photo behind one exact token, or nothing; the
  one call `anon` may make, since the link is the authority to see them), and
  `redeem_invite(text)`: spends one write whether or not the token matches, then makes the
  caller follow the link's owner. One row, the caller's; the owner follows nobody by it.
- `follow_back(uuid)`: follows somebody who already follows the caller, and `follow_prefilled(uuid)`:
  follows a prefilled account. Each refuses a locked caller, and each gives **one refusal for
  every other uuid** — a stranger, nobody at all, the caller's own — so the answer says nothing
  about whether an account exists.
- `followed_stamps()` and `account_thumbs_since(uuid, bigint, bigint)`, which are how the
  browser reads what it computes from (§3.4), and `account_thumbs(uuid)`, an account's thumbs
  whole, which nothing in the browser calls.
- `import_thumbs(text, jsonb)` and `import_state()` (below).
- `account_locked()` and `account_is_admin()`, each about the caller only;
  `reported_names()`, `remove_reported_name(text)`, `dismiss_reports(text)` and
  `remove_reference(text)`, each of which answers only an admin (§4).
- `record_debug_event(text, text)`, the only write verb on a table in `private`, which supplies
  none of the three columns it stamps.
- `delete_account()` (§4), which takes no argument and deletes the caller's own `auth.users`
  row.

**Why each of the three ways to follow is allowed.** A link: its owner handed it over to be
followed by. A follow back: somebody who follows you has already let you see their name, and a
follower they can see and remove is the least a follow can cost them — and they chose to hear
you, which is the stronger act. A prefilled account: it is public by design. Knowing a person's
uuid is not a way to follow them, and nothing else is.

**An import has an allowance of its own** (§1 item 9). `public.import_thumbs(source, things)`
is the one bulk write a client has: `security definer`, keyed on `auth.uid()`, a chunk of at
most 500 things a call, each a name, its stripped copy, its link and a thumb. It refuses a
locked caller, and per thing checks what a client's own insert is checked for — the name rules,
a removed name, the link's format against `private.ref_sources`, a removed link — and leaves a
refused thing out without failing the chunk. The thumb goes on whatever already holds the link;
otherwise the name is created if new and linked if it has no link; a name that holds a
different link is refused; **a thumb the caller already has is never overwritten**; and
`rated_at` is the server's clock, never a date from a file. What is skipped is the per-row
budget, through a transaction-local setting only that function and the prefilled loader set.
The allowance is in `private.imports`, one row per account and source: **one import per source
every 30 days, of up to 10 000 thumbs, open for a day after its first thumb** so one that
stopped part-way can be finished. A call past the day is refused with `GV429`; thumbs past the
allowance are counted `over` and not written; an import that wrote nothing leaves no row. Each
call spends one write of the daily budget, which is what bounds the calls. Chunks rather than
one call of 10 000, because a thumb is three inserts and their triggers and a role's statement
timeout is seconds. `public.import_state()` answers the caller's own rows as whether each is
open, what is left, and seconds until the next, with no timestamp in it.

**A prefilled account is loaded by the owner, and by no client** (§1 "Objects").
`private.load_prefilled(handle, name, thumbs)` finds the account by its handle, so loading it
again is the same account with the same id, and makes its thumbs equal the array exactly: new
ones written, changed ones turned over, and any the array no longer holds deleted, so a source
that withdrew an opinion stops holding it here. Anything wrong with an entry fails the whole
load and names the entry, since a load that quietly dropped a typo would be that account holding
less than it was given; a thumb on a removed name is left out, as it would be refused for
anyone. `scripts/load-prefilled.ts` turns the hand-written files under `prefilled/` into the
call, checking the same things first so that a mistake is a line number.

Triggers complete the schema and none is callable: `handle_new_user()` on `auth.users` creates
the profile row in the same transaction as the account, so "the profile is missing" cannot
happen for a signed-in user; `handle_deleted_user()` takes the profile when the account goes;
`count_write` and `refuse_if_locked` (§3.6); a link's pattern check; the two on
`ratings` that give a written thumb its revision and a cleared one its tombstone; and the one
on `follows` that revokes a link when its owner becomes locked, and replaces the link of an
account that removes a follower.

**Three hazards are permanent.**

*A follow is a read.* Whatever lets one account follow another lets it read every thumb that
account has given. So the three follow functions are the most sensitive code in the schema: a
fourth way to follow, or a looser check in one of the three, is a disclosure of ratings and not
a social feature. The same holds for any clause added to `ratings_select`.

*Enumeration is the default.* A clause that authorizes reading a row authorizes reading every
row it matches. The `profiles` policy has exactly one clause that does not name a live
relationship — `prefilled` — and it is there on purpose: those accounts are public. Any other
such clause — a public flag for people, a "has a link" — would authorize `select * from
profiles` for everybody it matches, which is a directory of people this app does not have. The
one read of a person with no relation to the caller lives inside a `security definer` function
that takes an exact key and returns at most one answer: `invite_owner(text)`, keyed on a
244-bit token and answering with a name and a photo only. A pattern, a prefix or an unbounded
limit in its body is the enumeration it exists to prevent.

*Postgres grants `EXECUTE` on a new function to `PUBLIC` by default*, and the platform grants
everything on a new table in `public` to `authenticated`. The migration turns both defaults off
before it creates anything, and `private.load_prefilled`, which writes as its owner past the
budget and the lock, is executable by the service role alone. Schema isolation is the
mitigation and the default privileges the belt; every migration is read with this in mind.

**`security definer` means the function's own rights.** `followed_stamps()` and
`account_thumbs_since()` read tables and a column no client may, so each body restates what
the policies on `ratings` would have decided: the caller's own thumbs or those of an account
the caller follows, and none on a removed name awaiting its purge. The second answers any other
uuid, one that names nobody included, as it would a followed account that never rated.
`account_thumbs` is deliberately *not* `security definer`: the policies decide what it sees, so
an account the caller does not follow, a uuid that names nobody and an account with no thumbs
all answer `{}`.

**One check is kept although it is currently vacuous.** `has_credential()` — an account that is
not anonymous and carries a confirmed email, a confirmed phone or a Google identity — gates
making a link and every way of following, because a link is followed in its owner's name and a
follow is a read nobody should hold from an account nobody can sign back into. With Google as
the only door every session passes it by construction. It stays because the thing it guards
against is a dashboard toggle rather than a code path: enabling anonymous sessions or a second
provider is a two-click change that ships no diff and passes no review. Every other check in
this design guards against a client; this one guards against us.

### 3.4 Computation: in the browser, on open

**The list is computed where it is read.** The browser asks the database for the thumbs it is
entitled to — its own and the followed accounts' — hands them to the core, and draws what comes
back. No server computes a list, holds one, or reads more than one person's thumbs on anybody's
behalf.

**What it reads, in two steps**, because PostgREST caps a read at 1 000 rows and one critic can
hold thousands of thumbs:

1. `followed_stamps()`: one row per followed account that has a thumb the caller may read, with
   an opaque stamp that moves whenever what the caller would load does: an md5 of the account's
   salt, its revision (§3.2) and the number of names ever removed. The last is there because
   removing a name hides its thumbs at once and deletes them later, so no revision has moved in
   between; a removal therefore moves every stamp, once.
2. `account_thumbs_since(uuid, revision, removed)`, once per account whose stamp is new, four
   at a time, passing the `revision` and `removed` of the answer last applied for that account.
   It answers `{ revision, removed, full, thumbs, cleared }`: `thumbs` nested thing to tag to
   value with `""` for the thing itself — `{"café bleu": {"": 1, "coffee": -1}}`, nested rather
   than keyed by a joined string, because any separator a name could hold could be forged by
   one — and `cleared` a list of `[thing, tag]`. When `full`, `thumbs` is everything and
   replaces what is held; otherwise the cleared keys are taken out and then `thumbs` written
   in, cleared first because a thumb cleared and given again is both.

**It is full whenever a difference could not be trusted**: nothing held yet, a revision the
account has not reached, a revision below the account's `floor` (a tombstone it would have
needed is swept), or a different count of removed names, since a removal hides thumbs without
any revision moving.

**Why applying a difference is exact**, under READ COMMITTED, from two facts. The function is
`STABLE`, so every query in it runs on the calling statement's one snapshot: the counter reads
N exactly when the transaction that took N is visible, because that transaction wrote both.
And writers to one account are serialized by the row lock `private.next_revision` takes on the
counter and holds until commit, so they commit in revision order: anything a snapshot does not
see has a revision above the one answered, and the next read asks for it. Break either and a
change is skipped for good: a sequence hands out numbers without the lock, so a reader answered
at 8 while the writer of 7 had not committed never sees 7; a `VOLATILE` function, or the
counter and the rows read in two statements, reads them at two instants.
`supabase/tests/25_thumbs_since.test.sql` pins the answers and `supabase/tests/races.sh` the
overlap.

**The followed accounts' thumbs are kept on the device** (`web/src/lib/utils/followed-cache.ts`):
IndexedDB, one row per viewer and account holding the thumbs with their stamp, revision and
removed count; IndexedDB rather than `localStorage` because one critic is thousands of thumbs.
They are loaded into memory on a viewer's first computation in a session. So **an open on which
nothing changed costs the stamps call and nothing else**, and one on which an account changed
reads that account's difference. Every failure of the cache — a private window, a full disk, no
IndexedDB — is answered as an empty cache, which costs a full read and never an error on
screen. An account's row is deleted when it leaves the stamps (unfollowed, or with nothing
visible), and everything is deleted on sign-out, whoever's it was: these are other people's
ratings, and the next person at a shared device follows nobody.

**Then the core.** `buildSnapshot` (`web/src/lib/utils/taste.ts`) sanitizes every account's
thumbs and names the viewer, whom they follow and everybody's thumbs under one key per ratable;
a Web Worker (`taste-worker.ts`) holds the wasm module and runs `computeUserTensor`, which answers `{ viewer, scores, plot }`; `foldScores`
(`shared/src/entries.ts`) turns the scores into one entry per thing, `{ itemId, score, conf,
tags }` with each tag a `{ score, conf, applies }` — `conf` the count of followed accounts
(§2.6), zero for a thing only its tags were spoken of — and `allFinite`
refuses a number that is not one. A worker and not the page, because a list over forty followed
accounts is tens of milliseconds of arithmetic natively (§2.10), more for accounts with
thousands of thumbs and unmeasured as WebAssembly, and on the page that is a swipe that does
not answer.

**When.** On open, when the tab comes back after a while, when the viewer's vine changes, and
after an import. **Not on each thumb**: a list that re-ranks under a finger is a row that moves
as it is swiped. Asking is one small request: if no stamp moved and the viewer's own thumbs are
the same object as last time, nothing is read and nothing is computed. One computation runs at a
time, and an ask that arrives during one is answered by a second run after it, since the first
may have read before whatever prompted the ask.

**First paint and offline** are the last list this browser computed, kept in `localStorage`
under a per-viewer key and forgotten on sign-out. It is the viewer's own list, which they may
see anyway. A cached list is something to look at and not an answer: "nothing here yet" is
never said on the strength of a browser that has not computed. With no cached list and no
computation yet, the list draws the mark, pulsing, and nothing else.

**What is held is one account's.** The list, the viewer's thumbs and the followed accounts'
thumbs are dropped on every change of session, from the store, and a computation checks whose
session it is before it writes anything.

**A failure** — a read refused, a worker that did not load, a non-finite number — leaves the
list on screen as it was, and while no computation has finished in the session the screen says
over it that the list could not be loaded, cached list or none, and never "nothing here yet".
A worker closes itself when the core fails to load, and the page drops one on any error, on a
message it cannot read, or after 60 s without an answer, so the next ask makes a new one.

**Why not in the database.** One SQL function per viewer would keep other people's thumbs off
the client. That was tried once, for part of the model this one replaced: written as SQL and
timed on 2026-10-08, it took 0.9 s, 5 s and 21 s at sizes that took 11 ms, 119 ms and 265 ms
natively, against a signed-in request's statement timeout of about 8 s (recalled, not
checked). That SQL is not in the repository, and the decomposition has not been written as SQL
at all: it is an iteration of a few dozen sweeps, each a pass over every thumb.

**What it costs is §4's first sentence**: a follower's browser holds the followed account's
thumbs. A server function that read them and returned only a list would keep them off the
client, at the price of a server in every open holding a key that bypasses row-level security.
It is the change to make if follower-readable thumbs stop being acceptable.

### 3.5 Client

- The list is computed as §3.4 says, kept in memory and in local storage, and all searching,
  fuzzy matching and filtering is local over it. The viewer's own ratings are loaded too, to
  overlay them on rows, to honor the hide-rated eye, and as the core's input. There is no
  "as of" line on screen.
- Typing does two searches at once and shows one list: the computed list, matched fuzzily and
  accent-insensitively on an item's name **and** on its attributes, plus the catalog itself —
  `items` by prefix over both the normalized query against the primary key and the folded query
  against `search_id` — for things nobody the viewer follows has rated. Over the list the fold
  happens in memory on both sides; over the catalog it matches the stored folded copy, so
  typing a name without its accents finds a thing the viewer has never heard of rather than
  offering to create it a second time (§3.2). The catalog query is what makes the *add* button
  honest: it is offered the whole time there is a query, and the client inserts `items` with
  `on conflict do nothing`, which settles a race between two people typing the same name by
  letting the loser read the winner's row instead of collecting a permission error. The insert
  happens on the first rating or attribute, not on the tap — a provisionally opened thing that
  the viewer backs out of writes nothing.
- Accounts are found in memory too: the accounts the viewer follows, their followers and every
  prefilled account are read on mount and when the tab comes back, and the people screen's search,
  its *critics* and the first run's offer of them draw from those and ask the server nothing.
- The attributes on a row and on a thing's own screen are the ones the thing **carries**
  (`carries` in `utils/discover.ts`): any the viewer rated, and any in the entry that somebody
  followed put there with `applies > 0.5`, which is a score above zero (§2.4). They are ordered by
  the bar's value, nearest the middle first, on the thing's screen. A chip renders the tag itself — there is nothing to look up and no cache in front of
  it.
- Ratings are written directly by the client into its own rows: an upsert for a thumb, a delete
  for clearing one. The list follows on the next computation.
- **One Realtime channel over one published table**: the insert of a `follows` row naming the
  viewer as the one followed. A new follower is the one thing that happens to a person while
  they are looking at the screen and that somebody else did. The event is a signal to re-read,
  not a row to apply. The publication is `insert, update` only, because a policy can bound a
  row but cannot bound a delete of anything (`0004_realtime.sql` gives the reason at length),
  so being unfollowed, or removed as a follower, shows on the next load. Thumbs are not
  published: a followed account's thumbs are fetched when its stamp moves, and a row event for
  each would be thousands for one import. There is no notification anywhere in the product.
  RLS applies to Realtime, so a follow reaches its two ends and nobody else.

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
  apps they use, cannot sign in at all, so cannot be invited. There is also no second door when
  Google's OAuth is down or misconfigured. Email link and anonymous sessions are additive, and
  what they need is mail sent from an owned domain with mail authentication on it, because a
  fresh consumer address sending sign-in links is filed as spam whatever the authentication —
  tolerable for a notification, fatal for a front door that *is* an email. Nothing sends mail
  from `grapevine.hafa.cc` — support mail is forwarded in, never sent out — so Google is the
  only door.

Google-only makes a fresh identity cost a Google account rather than a click. **That is not a
defense of anybody's list and must never be written up as one**: a list hears only the accounts
its viewer follows (§2.1), however many accounts exist. What the cost does protect is the
shared catalog and the write budget, which are per account.

**A link does not come with an anonymous account, deliberately.** The obvious way to let
somebody holding a link try grapevine before handing Google anything is an anonymous session
(`signInAnonymously`) converted later by linking a Google identity to it (`linkIdentity`, which
needs `enable_manual_linking`). Supabase supports both, and they are not built, for four
reasons:

- **The write budget and the shared catalog lean on an account costing something to make.** The
  budget is per account per day; an anonymous account is a click, so one person could multiply
  it into as many catalog items as they have the patience to mint accounts for. Supabase's own
  answer is a CAPTCHA on anonymous sign-in, which is a third-party script on the welcome screen,
  and `/privacy/` says the site loads none.
- **The conversion fails for exactly the person who opens a link on a new device.** `linkIdentity`
  refuses a Google identity that already belongs to a grapevine account, so someone who already
  has one and opens a link on a phone that is signed out would be left with an orphan anonymous
  account holding the new follow, and nothing merges two accounts.
- **An account nobody converts is a follower nobody can sign back into.** It stays on the link
  owner's list, reading their thumbs, until the owner removes it.
- **It reopens what one door keeps shut**: an account with no confirmed anything that can call
  `updateUser({ email })`, and a `has_credential()` that is no longer vacuous and has to be right
  on every path it guards.

So a link asks for Google first and survives the trip (§1 item 6). If an anonymous door is ever
added, it needs all four answered: a budget that does not multiply by accounts, a merge, a
sweep, and `has_credential()` on everything a link can do.

**Invite-only: an account that follows no other person is locked.** The soundest place to
refuse a sign-up with no link would be before the account exists, and that place cannot see the
link. Supabase's *before user created* auth hook is called with the user record GoTrue is about
to write and the request's metadata; the OAuth round trip carries nothing of ours through
Google into either, and the token lives in the browser's `sessionStorage`, where GoTrue never
looks. So every Google sign-in creates an account, and the gate is on what the account can do:

- **Locked means following no person.** Nothing stores the lock: `private.is_unlocked()` reads
  `follows`, so an account that never joined, one that unfollowed its last person, one whose
  last person removed it as a follower and one whose last person deleted their account are
  locked by one rule. **A prefilled account does not count**, or following a critic would be a
  way in with no invitation. **Being followed does not count either**: it is somebody else's
  act, and a lock the account's own followers could lift is no gate.
- **What a locked account cannot do.** `private.count_write`, the trigger every counted write
  goes through — a rating, an item, a link on a thing, a report, an invite link, a diagnostic —
  refuses a locked caller before it spends anything; a second trigger refuses the two client
  writes it does not see, a name update and clearing a thumb, with the same error rather than
  by matching no row; and `follow_back`, `follow_prefilled` and `import_thumbs` check the lock
  themselves. Reads are not stopped: a locked account sees its own rows, the catalog, the
  prefilled accounts' profiles and its followers.
- **Unlocked by a link.** `redeem_invite` writes the follow, and the follow is the unlock. It
  is the one follow function that does not ask about the lock.
- **No link while locked.** Losing the last follow of a person deletes the account's own link
  (a trigger on `follows`), and a locked account cannot make one. Both take a row lock on the
  account's profile first, because under READ COMMITTED each could otherwise run beside the
  other's uncommitted half and leave a locked account holding a link; and `redeem_invite`
  treats a link whose owner is locked as dead, whatever got it there. `supabase/tests/races.sh`
  runs those overlaps on two connections.
- **Nothing is deleted.** A locked account keeps its ratings and its followers, who go on
  reading them, and can sign out, delete itself and answer a link.
- **Admins are never locked** (§4), whoever they follow. That is the bootstrap: the first
  account is made an admin by hand and makes the first link.
- **A Google account with no name is called *unknown***, rather than asked: there is no name
  screen, and the name is changed on the people screen like any other.

What this does not change: an account is still a Google sign-in away, and it can still spend a
write guessing a token. What it removes is an account that can rate, name things or make a link
without anyone having handed it a link.

### 3.7 Nothing runs on a schedule except six statements in the database

Six `pg_cron` statements, all in `0003_cron.sql`, are the only scheduled work in the project:

- **The diagnostics sweep**, daily, which deletes expired `debug_events`.
- **The write-budget sweep**, daily, which deletes past days from `private.write_budget`.
- **The fingerprint sweep**, daily, which deletes past days from `private.deleted_identities`
  (§4).
- **The import sweep**, daily, which deletes rows of `private.imports` and
  `private.deleted_imports` past their 30 days: each says when somebody imported, and nothing
  reads one after that.
- **The tombstone sweep**, daily, which deletes cleared-thumb tombstones older than 30 days and
  raises each account's `floor` (§3.2): a tombstone names what somebody once rated.
- **The purge of removed names' thumbs** (§4), every minute.

They are load-bearing twice over: besides their own jobs, they are what keeps a free project
from pausing after seven days without database activity, so deleting the last of them would do
something nobody would guess.

There is no scheduler outside the database. A scheduled GitHub Actions workflow is disabled
automatically after sixty days of repository inactivity, and nothing goes red when it is; a job
run that way would also need a long-lived credential that bypasses RLS in a repository secret.

### 3.8 Cost, and where the free tier breaks

The free tier is 500 MB of database and 5 GB of egress a month. **Nothing below is measured**;
it is arithmetic on stated assumptions, so that they can be argued with.

**Egress is what changed since a device last read.** A thumb crosses the wire as an entry of
`account_thumbs_since`'s JSON: the thing's id once, then `"":1`, about the id's length plus ten
bytes — say 30 bytes for a thing with a twenty-character name, before any compression the
platform applies. A device reads an account in full once, and after that only its changes
(§3.4), so:

| a viewer follows | each holding | the first read on a device |
|---|---|---|
| 20 accounts | 400 thumbs | about 240 KB |
| 40 accounts | 3 000 thumbs | about 3.6 MB |

An open on which nothing changed is the stamps call: a uuid and a 32-character stamp per
followed account, a few kilobytes at forty. An open on which accounts changed adds about 30
bytes for each thumb they changed. So egress follows how fast thumbs are given and how often a
device starts from nothing — a new device, a sign-out, a private window, cleared site data —
rather than how often the app is opened. What sends every device back for everything at once:
a removed name (every stamp moves, and every answer is full), and for one account, a reload of
a prefilled account that rewrites many thumbs, or a sweep past a reader who had been away more
than 30 days.

What to change next, if it binds: compress, if the platform does not already; then pay for a
larger tier.

**Storage** is the `ratings` table: one row per thumb, with its index. An import can write
10 000 thumbs from each of four sources, and a prefilled account as many as its file holds.
A cleared thumb costs a tombstone row for 30 days.
Nothing stores a list, a copy of anybody's thumbs or anything computed, so storage grows with
thumbs given and with nothing else.

**Compute costs the project nothing.** It is the viewer's own device (§2.10).

An id is arbitrary UTF-8, so a name in a non-Latin script costs two or three bytes a character
instead of one. `account_thumbs`' nested shape writes each item id once however many of its
tags an account answered. `search_id` is usually the smaller of an item's two columns, since
folding strips characters and never adds any.

## 4. Privacy and social safety

The stance: **your ratings are readable by you and by the accounts that follow you, and by
nobody else; and you decide who follows you.** No screen shows anybody's ratings, but that is a
choice about screens, not a protection: a follower's browser holds every thumb the followed
account has given, because that is what the list is computed from (§3.4). The privacy page says
so in those words.

**Who can read what.**

| | who |
|---|---|
| your thumbs — every one, on things and on tags, and so every tag you put on anything | you, and every account that follows you |
| when you gave each thumb | nobody, through the API (below) |
| your name and photo | you, the accounts you follow, the accounts following you, and anyone holding your link, signed in or not |
| that you follow an account | you and that account |
| that an account follows you | you and that account |
| your link's token | you |
| your list | your own browser; no server computes or holds it |
| a thing's name, and its link | everyone signed in |
| who added a thing or a link, who reported a name | no client |
| a prefilled account's name and handle | everyone signed in |
| a prefilled account's thumbs | every account that follows it, which is anyone unlocked who chooses to |
| who follows a prefilled account | no client |

**Following is a read, so who may follow you is the whole of the control.** An account can
follow you in exactly two ways, and each is your own act:

- **It holds your link.** You handed the link over, or someone you handed it to passed it on.
  Anyone holding it can see your name and photo and follow you, until you make a new one or
  turn it off; either stops new followers and keeps the ones it made.
- **You follow it.** Following somebody lets them follow you back with no link and no question
  to you. Accepting a person's link is therefore also an offer of your own thumbs to that
  person, if they take it.

Nobody else can follow you: knowing your uuid is not enough, there are no handles for people,
and no search reaches a person the searcher cannot already see (§1 "Search").

**The remedy is removing a follower**, from *following you* on the people screen: the follow
row goes, and with it the read, at once. Two things it does not do, stated plainly. It does not
take back what was already read: a follower's browser had your thumbs, and a determined one
kept them, and what a follower's device kept between sessions (below) is deleted only when
that browser next learns it no longer follows you. And it does not stop them following back
while you still follow them: that is the rule, since following somebody is the offer.

**Removing a follower replaces your link.** The same statement mints a new token over it, so
the link that person was handed is dead and they cannot walk back in with it; so is that link
for everybody else who held it, and the owner copies the new one to hand out again. It costs no
write. A follower who leaves by unfollowing changes nothing.

**What a follower can work out, beyond the thumbs themselves.**

- *When you rated*, roughly. No clock leaves the database: `rated_at` is in no select grant,
  and `followed_stamps` returns a salted digest of a counter. But the stamp moves *when* your
  thumbs do, so a follower who asks often sees when it moved, and by re-reading, which thumb
  appeared between two asks. A patient observer can rebuild a coarse copy of the clock for the
  time they were watching.
- *Nothing about anybody you follow.* Your follower reads your thumbs, not your vine's, and
  cannot list whom you follow. Your list is not theirs to read: it exists only in your browser.

**What you can work out about an account you follow.** Everything it rated, by reading it.
Nothing on a screen lists it — an account is a row, with no page — but a row in your list that
only one account you follow could have put there says the same thing more slowly. The friction
on screen is: no counts, no attribution, no order by time, a bar instead of a number. It is
friction against a glance, not against the API.

**What the followed account learns about a follower**: that they follow, and their name and
photo. Not their thumbs, unless it follows back.

- No screen ever shows counts, raters, averages, "N people liked this", who created an item, or
  how the viewer's taste compares with any account's. Scores are shown as a personal bar — four
  segments, filled to the score (§1 "The bar") — never
  as a number and never with a word beside it. The one place an ordinary account sees a number
  is its own import's progress (§1 item 9).
- **How well each account predicts you is not computed at all.** The model has no number per
  account (§2.3). The fit does hold a row for each followed account beside the viewer's (§2.5),
  in the browser and for the length of one computation; nothing keeps it, sends it or draws
  it, so that nobody is told "the app thinks you and X disagree". A viewer who wanted such a
  figure could compute one from the thumbs they are already entitled to read.
- **A leaked link costs its owner the followers it makes before it is replaced**, each of whom
  reads every thumb the owner has given, and each of whom can be removed.
- **Prefilled accounts are public on purpose.** They hold what a critic or a source published,
  entered by the owner by hand, and anyone signed in can find one. Its thumbs are read by
  following it. Nobody signs in to one, so nobody reads its followers.
- A locked account (§3.6) keeps its thumbs and its followers, who go on reading them. It can
  read its own rows, the catalog and the prefilled accounts' profiles, and write nothing.
- Nothing is public to signed-out visitors except the app shell, the three written pages and,
  to whoever holds a link, its owner's name and photo.
- Item names and tags are the one channel of user-written text that everyone signed in can
  see, and a name can never change — it *is* the id (§3.2), so there is no verb that could
  change it and nothing that could be changed under it. A name like "blue bottle (rated by 9
  people)" or a real person's name is therefore possible and permanent. v1 accepts this with
  three limits: names are rendered as plain text, never as links or markup; the folding
  refuses control characters, so a bidirectional override cannot reverse the row a name is
  drawn in; and a misleading name occupies only itself — anyone else can still create and
  find the name they meant, since identity is exact. **A name can be reported**, from the
  quiet *report this name* line at the end of the thing's screen (§1 item 4): a `reports` row
  the client may insert and nobody may read through the API, one per person per name, no reason
  asked, one write spent. An **admin** — a row in `private.admins`, written by hand, which no
  client reads — reviews them on a screen of their own, `#/reports`, opened from the people
  screen, under a title bar reading *names people reported*: every reported name with how many
  reported it, never who, each row swiping left to *remove* (asking first) and right to
  *dismiss*, with a side button for each on desktop, and *nothing is reported.* in its middle
  when there is none. Anybody else who opens `#/reports` is put on the list.
  `reported_names()`, `remove_reported_name(text)` and `dismiss_reports(text)` check
  `private.is_admin()` before anything else and answer anybody else nothing or a refusal.
  Dismissing deletes a name's reports and keeps the name. Removing calls
  `private.remove_name(text)`, which no client can call directly: it adds the name to
  `private.removed_names`, which restrictive insert policies on `items`, `ratings`, `item_refs`
  and `reports` check so it cannot be typed back, linked or reported again, and deletes its
  catalog row and its reports. That is all it does, in about a millisecond however many people
  rated it. **From that moment every reader leaves the name out, on the server**: a restrictive
  `SELECT` policy on `ratings` hides every thumb naming it, as a thing or as a tag, the
  viewer's own and a followed account's alike, and `account_thumbs_since` leaves them out; and
  both it and `followed_stamps` carry the number of names ever removed, so every stamp moves
  once and each browser's next read of each account is a full one, replacing what its device
  held with the name in it.
  The thumbs themselves are deleted by a scheduled statement, a batch of 5 000 a minute; the
  name counts as purged once a run finds none left, ten minutes or more after the removal,
  because a thumb whose insert passed the policy just before the removal can still commit.
  What lags: a list already computed keeps the name until that browser computes again, and the
  copy in `localStorage` with it. Removal rather than a hidden flag the client filters: a flag
  would still ship the name to every follower, and a report is about text that should not be
  served at all. The same path is the remedy for a homograph of an existing name, which §3.2
  says is bounded rather than prevented.
- **An import sends the same services what is in the file, and nothing else leaves the
  browser** (§1 item 9): to Wikidata the IMDb and Spotify ids, and to Wikipedia and Wikidata the titles,
  years and authors' surnames (inside a guessed page title), of the things that will become a
  thumb, and the ids of the candidates; to Photon the name of each reviewed place and its
  position rounded to about a kilometer. Plain requests with no cookie: each service sees
  those and the IP address, never the rating or the account. The file itself goes nowhere, a
  place's position is compared in memory and never stored, and grapevine's own database is
  sent the names and links to see what exists, then the names, links and thumbs to save.
  **Nothing records that a thumb was imported or where from**; what is kept is when an account
  last imported from each source and how many thumbs, for 30 days (§3.3). An imported thumb is
  a thumb like any other: every follower reads it.
- **Adding a thing is the one time the browser sends typed text to someone else**: the name
  about to be added, to Wikipedia and to Photon, straight from the browser with no cookie, so
  each sees that text and the IP address and never the account; Photon also gets a position
  rounded to about a kilometer while that setting is on, and Wikidata, from the same browser,
  the ids of Wikipedia's matches (§1 item 2). Only on a tap of add, never while
  typing, and the first setting turns it off. A link is chosen by a client, so it is as
  trustworthy as a name: the remedy for a wrong one is the report line and the owner's
  `private.remove_reference(text)`, run by hand, which deletes only the link and adds it to
  `private.removed_refs`, which a restrictive insert policy checks, so a wrong link on a
  well-rated name is fixed without removing the name. `public.remove_reference(text)` is the
  same for an admin's client, and nothing in the app calls it yet.
- The operator of the project (whoever holds the Supabase project) can read the database to
  keep it working or when the law requires it; the privacy page says so. "You and your
  followers" is a statement about grapevine's users and the app, not about the operator.
- **What a device keeps.** The viewer's last computed list, in `localStorage` under a
  per-viewer key, for first paint and offline, forgotten on sign-out. **And the thumbs of
  every account the viewer follows**, in IndexedDB, between sessions (§3.4): the same thumbs
  the viewer may read from the server, now at rest on their device. An account's are deleted
  when the browser next computes after the follow ended, and all of them on sign-out. A device
  that never opens the app again keeps what it last held; nothing reaches into it.
- **An account can be deleted by its owner, from the app, and by nobody else.**
  `delete_account()` is `security definer` with no argument, so the only account it can reach is
  `auth.uid()`; it deletes that `auth.users` row, a trigger takes the profile, and the rest is
  the schema's own cascade from the profile: ratings, every follow at either end, the link,
  reports, the write budget, the import rows and an admin row, with GoTrue's identity and
  sessions. The person's diagnostics, which carry no foreign key, are dropped by the trigger
  that takes the profile, so an account deleted from the dashboard leaves none either. Items
  and links they added stay, with `created_by` null (§3.2). The account's followers find it
  gone on their next read (Realtime publishes no deletes), and one whose last followed person
  it was is locked by the same rule as any other (§3.6). Signing in again with the same Google
  account makes a new, empty account with a new uuid — **but not a fresh write budget.**
  Deleting keeps, until the end of that UTC day, a one-way fingerprint of each identity the
  account signed in with beside the day's spent budget, and an account created from the same
  identity that day starts from it, so deleting cannot be used to reset the limit. The
  fingerprint is HMAC-SHA256 of `provider:provider_id` (Google's stable subject id) under a
  random key kept in Supabase Vault: keyed, so knowing somebody's subject id is not enough to
  confirm they deleted an account; in Vault, so the key is encrypted at rest and absent from
  any dump of `public`, `private` and `auth`. No email, name or uuid is kept, and a scheduled
  statement deletes it after its day. One day is enough for the budget, which resets at
  midnight. **An import's 30 days are kept the same way**: `private.deleted_imports` holds,
  under the same fingerprint, each source the account imported from within its 30 days, when,
  and how many thumbs, and an account created from the same identity inside them starts with
  those imports made. A scheduled statement deletes each row when its 30 days are up. A second
  Google account still buys a fresh budget and fresh imports, which no fingerprint can stop.
- Diagnostic records carry an `expires` field and nobody reads one back. What deletes them
  is a scheduled statement in a migration, in the repo and applied by the deploy, rather
  than a console setting somebody has to remember to make and whose absence is silent.
