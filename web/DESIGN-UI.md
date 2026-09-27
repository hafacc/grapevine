# grapevine — UI design language

The visual half of `DESIGN.md` §1 "The one view". §1 says what the interface *is* — one list,
a field at the bottom, a swipe to rate; this file says what it is made of. Where the two
disagree, §1 wins.

The direction is an instrument panel: one saturated teal, rules instead of shadows, the
hex-grapes mark and the swipe.

## Voice

Compact rows on a plain surface, separated by rules. One accent and one danger colour, no
third. Nothing counts anything and nothing is a number (DESIGN §4). **Everything user-facing
is lower case** — labels, buttons, headings, the wordmark, the empty state, and the things and
attributes people type, which are stored lower case (DESIGN §3.2) and so need no CSS to arrive
that way. A capital letter in the interface is a person's own display name from Google, or a
bug. Do not add `text-transform` anywhere to enforce this: a transform would hide the one case
that matters, an id that reached the screen without being normalized.

Dark first in intent; the light palette is the same instrument under a lamp. **The light palette
was designed; the dark one is derived** from it, and "How far the dark column has been checked"
below says what that leaves open.

## The mark

**Hex grapes**: six hexagons in a 3–2–1 bunch, no stem. `docs/mark.svg` is the drawing; the
generator that produced it is not in the repo, so the SVG is the source.

Each berry is an **outlined hexagon with a same-size hexagon clipped inside it**, offset
toward one vertex. Because the inner hexagon is the same size, it covers the outline on the
sides it is pushed against and leaves a rim of even width on **exactly two** sides. A
*smaller* hexagon centred or shifted inside shows a rim on **three** sides and reads as a ring,
not as a lit berry. If a retrace produces three visible rim sides, the inner hexagon shrank.

- Geometry, in the 64 × 64 viewBox: berry radius 10.2, centres at ±17.6 in x and 15.3 in y
  (3 on top, 2, then 1), outline 2.2 wide, corner radius 17% of the berry radius, inner
  hexagon offset about 4.2 toward the lower-right vertex.
- The mark is used at 22 px in the top bar beside the wordmark and at 48 px on the empty
  screen. Below about 18 px the rim closes up; use a solid bunch there, not this.
- The solid bunch is the favicon: the same six hexagons filled in `accent`, following the
  theme, on no background — a disc that fits in 16 px leaves each berry a blot. Each berry is
  4 px across its flats with 1 px between, so the upright sides land on pixel edges.
- Centre the bunch by its weight, not its box: a 3–2–1 triangle centred by its box hangs high.
  In a maskable icon's safe circle, centre the smallest circle around it.
- The install icon is just the grapes in `accent`, on no background. The maskable and Apple
  icons, which the platform crops or composites on black, put them on a square of the light
  theme's `bg` — the manifest's `background_color` — so Android's launch screen, which draws the
  maskable icon in a circle on that colour, shows just the grapes.
- The launch screen cannot follow the theme on Android: it is drawn from the manifest, which has
  one `background_color`, and Chrome's dark-mode manifest field never shipped. Planned, not built:
  iPhone launch images (`apple-touch-startup-image`) in a light and a dark variant per screen
  size, which do follow the phone's own setting. The in-app theme choice reaches neither.

## Shape

**One corner radius: 4 px.** Panels, buttons, chips, fields, avatars-that-are-not-hexagons,
everything. 2 px is allowed only on parts under about 8 px tall, which in practice is the
bar's segments and nothing else. A radius scale would be four decisions where one does.

**Hexagons carry real rounded corners** — the path is built with a quadratic at each vertex —
not a rounded pen stroke. A wide `stroke-linejoin: round` rounds the outside of the join and
not the inside, so a hexagon drawn that way has six subtly wrong corners at every size.

**Avatars are hexagons.** Pointy-top like the mark's berries, which also fits a face, radius-30 in a 64 box, 5 px corners, 2 px `border` rule.
A Google photo is clipped to that hexagon; with no photo it is `accent-soft` with the
person's initials in the display face. Sizes: 36 in a bar, 40 in a people row, 48 on the
viewer's own row.

There is no notification badge: nothing in the product waits for the viewer.

## Space

- 4 px base. Side gutter 16 px, which is also a row's horizontal padding.
- **Tap target 44 px**, for every button, field and icon button. Rows are taller than that on
  their own.
- Row: 12 px × 16 px, name and chips in a column 8 px apart, the bar at the right, 16 px
  between them. An attribute row on a thing's screen is 14 px × 16 px with no chips.
- Section heading: 16 px top, 8 px bottom, same gutter.
- The bottom bar: 10 px above, 20 px below (the home indicator), 10 px between the add button
  and the field.
- Surfaces are separated by 1 px rules, never by shadow. The one shadow in the language is on
  a card **being swiped**, so that it reads as lifted off the reveal behind it.

## Type

| role | face | weights | where |
|---|---|---|---|
| display | Barlow Semi Condensed | 500 / 600 | wordmark, titles, buttons, chips, section headings |
| text | Barlow | 400 / 500 | names, body, the search field |

Fallback stack: `"Barlow", ui-sans-serif, system-ui, "Helvetica Neue", Arial, sans-serif`
(and `"Barlow Semi Condensed", "Barlow", …` for display). Fonts from Google Fonts with
`display=swap`.

| px | face | what |
|---|---|---|
| 22 | display 600 | wordmark, screen title, a thing's name in its title bar |
| 19 | text 500 | the viewer's own name |
| 17 | text 500 | a row's name; body copy; display 600 for a button label |
| 16 | text 400 | the search field, the link line, the install line, the "nobody here by that name" note; text 500 for a name in a people row |
| 15 | display 500 | chips, section headings (600, `.06em` tracking, muted); text 400 for the sheets' notes |

Body line-height 1.5; the empty state 1.55. Nothing is smaller than 14, and nothing between
these sizes is a new step — pick one.

## Palette

| token | light | dark | use |
|---|---|---|---|
| `bg` | `#E8ECED` | `#0E1417` | canvas behind the list |
| `surface` | `#FFFFFF` | `#151D21` | rows, bars, fields |
| `surface-muted` | `#F1F4F4` | `#1C262B` | a plain chip, a muted button |
| `text` | `#0E1417` | `#DEE7EA` | names, body |
| `muted` | `#55666D` | `#8B9AA1` | chip text, section headings, placeholder |
| `faint` | `#92A1A7` | `#5E6E75` | tertiary |
| `border` | `#CAD4D7` | `#253136` | every rule |
| `accent` | `#0F7E75` | `#3FB3A6` | the mark, a lit segment above the midpoint, a yes reveal |
| `accent-ink` | `#0A5A53` | `#6ECEC1` | accent text and glyphs **on** a soft or tinted fill |
| `accent-soft` | `#D6E8E5` | `#13312E` | a yes-rated attribute row, an avatar with no photo |
| `accent-tint` | `#EAF4F2` | `#102A28` | a yes-rated row in the list |
| `accent-on` | `#FFFFFF` | `#0E1417` | text on a filled accent |
| `danger` | `#BF4F3B` | `#DD6B55` | a lit segment at or below the midpoint, a no reveal |
| `danger-ink` | `#8E3524` | `#EE8D79` | danger text and glyphs on a soft or tinted fill |
| `danger-soft` | `#F3DCD6` | `#412923` | a no-rated attribute row |
| `danger-tint` | `#FAEAE5` | `#39241F` | a no-rated row in the list |
| `track` | `#DDE5E6` | `#1F2A2E` | the unlit part of the bar |
| `track-edge` | `#9AA8AA` | `#4A5A61` | the bar segment's outline |
| `clear` | `#8D9B9D` | `#5E6E75` | the reveal behind a swipe that clears a rating |

**Soft and tint are two different fills and both are needed.** A thing's own screen carries
one background colour — its own verdict — so a rated attribute *inside* it has to be marked
against an already-tinted page, and takes the stronger `*-soft`. A rated row in the list sits
on plain `surface` and takes the lighter `*-tint`. Collapsing them makes one of the two
unreadable.

Light is the bare `:root`; dark is under `@media (prefers-color-scheme: dark)` guarded as
`:root:not(.light):not([data-theme="light"])` and again under `.dark, :root[data-theme="dark"]`.
Both spellings, because `app/layout.tsx` configures next-themes with `attribute="class"`;
honouring only one would make the other silently do nothing.

**How far the dark column has been checked.** Only by arithmetic, comparing each dark pair
against its own light equivalent rather than against a threshold, since light is the column
that has been seen and approved:

- **Text is fine everywhere, and in three places dark is clearer than light** (tertiary text,
  the bar's outline against its track, the clear-reveal against the canvas). Nothing that has to
  be read falls below its light counterpart by enough to matter.
- **`danger-soft` and `danger-tint` are not derived.** Derived, they measured 1.11 and **1.02**
  against `surface`, so a no-rated row was the same colour as an unrated one. `#412923` and
  `#39241F` put them at 1.27 and 1.18 (light's are 1.31 and 1.17; the accent pair is 1.23 and
  1.13), with `danger-ink` at 5.6 and 6.0 on top. A rated row signals itself by tinting its
  background and nothing else — there is no thumb glyph to fall back on — so this is where a
  dark value carries meaning on its own.
- **Two differences are left alone deliberately.** A rule against a row is 1.28 in dark against
  1.51 in light, and a row against the canvas is 1.09 against 1.19. Both are fainter, neither is
  a signal, and the obvious fix — lifting `surface` — compresses every token that sits on it
  (tested: the bar's track, the muted chip and the yes-tint all lose more than the rule gains).
  Whoever first looks at this on a screen decides; the arithmetic does not.

So: the dark column is verified for legibility and for the one place where colour carries meaning
on its own, and is unverified as a *look*.

## Components

**The bar** — an item's or an attribute's score for this viewer, everywhere one is shown. Four
segments, 15 × 9 px, 4 px apart, 2 px radius, `track` fill with a 1 px `track-edge` outline.
The fill is the value as it is: map `v ∈ [−1, 1]` to `(v + 1) / 2`, multiply by 4, and fill that
many segments — the one it lands in is part-filled, and every lit part is at full opacity.
`danger` at or below the midpoint, `accent` above. **No word beside it, anywhere**, and no number
ever; the whole label is the `aria-label` on the group (`role="img"`), which is a sentence like
"how café bleu scores for you", or "nothing known yet" where there is no score. A word beside it
(*strong no … strong yes*) would repeat the bar to someone who can already read it and pretend to
a precision the bar does not have.

**For a thing, the value is the cautious one**, `c = s · W / (1 + W)` (`cautiousScore` in
`utils/bar.ts`; DESIGN §1 "The bar", §2.6): the score `s` pulled toward the middle by how little
stands behind it, `W` being how many of the viewer's own thumbs the evidence amounts to and the
one the prior's one pseudo-thumb. A thing reaches an end only when the prediction is strong and a
lot stands behind it; little behind a thing leaves it near the middle on either side, and
`W = 0` is "nothing known yet". An attribute's entry carries no `W`, so its bar draws `s`. The
component takes that one value as `score`; nothing else about the bar varies. The list ranks by
the same `c` the bar draws, so the order never disagrees with the bars.

**Row** (the list) — `surface`, 1 px `border` bottom, 12 × 16. Name at 17, attribute chips
under it, the bar at the right. Rated: background `accent-tint` / `danger-tint`, and the
bottom rule takes `accent` / `danger`. The bar stays — a rated row still shows what the
network thinks, beside what the viewer said.

**Chip** — 28 px tall, 4 px radius, 12 px horizontal, display 500 at 15. Five tones:
*plain* (`surface-muted` fill, `border`, `muted` text) for an attribute; *match*
(`surface` fill, `accent` border, `accent-ink` text) for each attribute a search matched;
*yes* / *no* (`*-soft` fill, `accent`/`danger` border, `*-ink` text) for one the viewer
answered; *add* (`surface` fill, **dashed** `accent` border, `accent-ink` text) for a
suggested attribute you can apply. A chip is never a button unless it does something — the
suggested row's chips are `<button>`, the rest are `<span>`.

A chip's text is the attribute itself — there is no display name to look up (DESIGN §3.2) — so
it is arbitrary Unicode with spaces in it, up to 128 characters, and it may be in any script or
direction. The chip therefore ships with `max-width`, `overflow: hidden` and
`text-overflow: ellipsis` rather than assuming a short word, renders as plain text with no
markup, and sets no `direction`: the browser's own bidi handling is correct here and an
override would be the bug.

**Search field** — 44 px, `surface`, 1 px `border`, 4 px radius, magnifier at 18 px on the
left, input at 16 px. With a query the border and the magnifier take `accent` / `accent-ink`.
It is always at the bottom: on the list it searches and adds, on a thing's screen it filters
attributes and adds one, on the people screen it filters people by name and reaches nobody else.
The other text input is in a sheet: the name, in *your name* (a tap on the viewer's own
name). The viewer's link is never shown in a field or anywhere else.

**Add button** — above the field, full width, 40 px, `surface`, **1 px dashed `border`**,
plus glyph and label in `muted`, left-aligned. Deliberately the quietest thing on the screen:
it is available on every keystroke, so it must not compete with the results it sits over.
With a `!`, `@` or `#` starting a word of the query it stays in place, disabled — half
opacity, no pointer, as every disabled button — because an operator is not part of a name.

**Eye toggle** — 44 px icon button beside the field. Open eye in `muted` on `surface` when
everything is shown; **crossed-out** eye in `accent-ink` on `accent-soft` when rated things
are hidden, with `aria-pressed`. The icon changes, not only the colour: a toggle whose only
state is a tint is unreadable to anyone who cannot see the tint, and this one is load-bearing
on two screens.

**Swipe reveal** — the row translates horizontally by about 104 px (96 on a title bar or
attribute row) and nothing else: no rotation, no vertical travel. Behind it, a full-bleed
`accent` (right, yes) or `danger` (left, no) with a white thumb glyph pinned to the side the
row came from. When the swipe would **clear** an existing rating the reveal is `clear` grey
with a **minus** glyph instead. The moving row keeps `surface` and takes the one shadow in the
language, `0 0 20px rgba(14, 20, 23, 0.16)`. **Thumbs are for rating only.** A row whose sides
are not a rating shows a white **word** in place of the glyph, display 600 at 17, saying what
letting go does, with a 20 px icon stacked over it and 16 px from the edge (side by side, the
pair is wider than the travel reveals): *remove* `LuUserMinus`, *turn on* `LuLink`, *turn
off* `LuUnlink`, *new link* `LuRefreshCw`. A friend's row swipes left only, to *remove*, and
asks before anything is written. The link row swipes right to *turn on* while off; while on,
left to *turn off* and right to *new link*, each asking first. It is the one swipe on a phone
that nothing else explains, so at phone width only it carries a second line, text 400 at 15 in
`muted`: *swipe to turn on*, or *swipe to turn off or make a new one*. No other row carries a
swipe affordance.

**Side buttons (desktop only)** — 56 px wide, full row height, welded to each end with no
gap and no radius: no on the left, yes on the right. Unpressed they carry `accent-soft` /
`danger-soft` with the glyph in `*-ink`. The side matching the viewer's current rating goes
`surface-muted` with a `muted` **minus**, because pressing it clears. On a row whose sides are
not a rating, each button carries its word and the same icon at 16 px instead (display 600 at
15, at least 56 px wide and as wide as the word needs): a friend's row has the left button alone, *remove*; the link row has
*turn on* alone, or *turn off* and *new link*. They replace the swipe and nothing else: the rest
of the desktop is the phone layout in a 720 px column.

**Section heading** — display 600 at 15, `.06em` tracking, `muted`, on the canvas rather than
in a bar: *your vine* on the people screen, *suggested* over a thing's rail. It names a group
and claims nothing about it — *suggested* in particular never becomes "people like you use these"
(DESIGN §4).

**First-run hint** — one line over the list's first row, on the canvas: text 400 at 15 in
`muted`, a bottom rule, and a close icon button at the right. Shown once per viewer on a device
(`utils/first-run.ts`); closing it or rating anything puts it away.

**People row** — 10 × 16, hexagonal avatar at 40, name at 16. No bar: a person does not have
a score, and nothing else is said about them.

**Buttons** — 44 px, 4 px radius, display 600 at 17. *primary* is `accent` fill with
`accent-on`; *soft* is `accent-soft` with `accent-ink` and an `accent` border; *muted* is
`surface-muted` with `text`; *quiet* is `surface` with `muted`. The people screen carries
two: sign out (muted) and the theme control on the viewer's own row, and *install* on the
install line where the browser offers one. While the link is on, its row ends in two icon
buttons, 44 px, `muted`, each named by its `aria-label`: *share* (`LuShare2`), only where the
device has a share sheet (feature-tested), and *copy* (`LuCopy`, then `LuCheck` in
`accent-ink` once it has). The viewer's own name
is a button too, drawn as the name with a 16 px pencil in `muted` after it. Everything else there
is a row that swipes. Its sheet carries its own: *cancel* (quiet) and *save* (primary) in *your
name*. The last line on the screen, *delete your account*, is a full-width `danger-tint` line in
`danger-ink`, the tint of a no-rated row, 32 px below the sections; its sheet's `dangerSolid` button stays disabled until *delete* is typed.

## Layout

- **Phone (the design).** Top bar 56 px: the mark and the wordmark on the left, the avatar
  (44 px tap target) on the right. Then the list, scrolling. Then the
  bottom bar, pinned: the add button if there is a query, then the field and the eye. The other
  two screens swap the top bar for a **title bar**, 56 px, and keep the bottom bar with a
  different field:
  - **A thing**: back arrow, the thing's name, its bar, and the avatar
    (`components/avatar-button.tsx`, the same button the top bar uses). The whole bar is the
    thing's rating row. The page ends in a quiet *report this name* line — `surface`, a top
    rule, text 400 at 15 in `muted`, pushed to the bottom of the page — which reads *reported*,
    disabled, once sent.
  - **People**: back arrow and *you and your vine*, and **no avatar** — this is where the
    avatar leads. Under it, in order: the viewer's own row, the link row, the install line,
    then *your vine*, then the delete line.
- **Desktop (deferred).** The whole phone in a 720 px column centred on `bg`, with a rule down
  each side from the top of the screen to the bottom: top or title bar, list, bottom bar, and
  every screen alike — the list, a thing and people share the one column, set once around
  whichever screen is showing (`app/page.tsx`), so nothing inside a screen sizes itself. **Only
  the canvas spans the width.** A bar's fill and its hairline stop at the column's rules, so the
  wordmark, a back button, the avatar, the field and the eye all sit at the column's edges, 16 px
  in, where they sit on a phone. The swipe is replaced by the side buttons. A dialog is centred
  over everything and is narrower than the column already. The welcome screen is the same
  column without the rules, so its theme control sits at the column's edge, and so are the
  locked screen and a link's question — one full screen for every account, never a dialog,
  since a locked account has nothing under it to lay a sheet over; a written page's
  header sits over its own text column. Nothing else is designed; a second pane is a decision,
  not a layout tweak.
- **The written pages** (`/about/`, `/privacy/`, `/help/`) keep `components/doc-page.tsx`:
  text face at body size, display-face headings, bare canvas, cards only where they earn it.

## Tailwind: the `@source` rule

**Tailwind only emits a utility it has SEEN, and one it never emitted fails silently** — the
class is on the element, the rule is not in the stylesheet, and the screen just looks a little
wrong. A recursive `content` glob in `tailwind.config.js` does **not** recurse in this build:
it matches only the top level of `components/`, so every primitive under `components/ui`
renders unstyled while the screens around them look right.

So the sources are listed **one directory level at a time** as `@source` lines in
`web/app/globals.css`, `tailwind.config.js` holds nothing but `darkMode`, and
`web/tests/styles.test.ts` fails when a new directory of components has no line of its own.
A new directory means a new `@source` line and a new line in that test, in the same commit.
