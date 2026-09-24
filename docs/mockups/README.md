# mockups — the one view

Static comps of the interface settled on 2026-09-17, when the app stopped being five tabs and
became a single list with a search field at the bottom. Each file is one screen at 390 × 844
(`desktop.html` is 1280 × 820), self-contained HTML with inline styles and no script: they are
pictures, not a prototype, so the only thing that works is the links between them —
`main.html` is the feed and everything else is reachable from there. They were generated from
a Python source that is not in the repo, so a change to the design is a change to the code and
to `DESIGN.md`, never to these files. `logo.html` is the mark and wordmark at the sizes they
were chosen at, and `../mark.svg` is the 176 px drawing on its own.

The decisions these illustrate — what a swipe means, what the bar is, what is on the entity
screen and what is behind the avatar — live in [`DESIGN.md`](../../DESIGN.md) §1, and the
tokens and components in [`web/DESIGN-UI.md`](../../web/DESIGN-UI.md). Where a comp and those
files disagree, the files win: a comp shows one state of one screen at one width, and several
states it does not show (dark mode above all, which nothing here draws) are decided in prose.
