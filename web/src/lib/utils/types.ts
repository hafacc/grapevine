export type Profile = {
  readonly uid: string;
  // Whatever its owner typed, first name from Google by default. It is the only
  // thing that says who a person is: a person has no handle, because no person
  // is found by typing anything (DESIGN §1).
  readonly displayName: string;
  readonly photoURL: string | null;
  readonly createdAt: number;
  // True while the account follows no other person: the server refuses every
  // write it could make until it accepts a live link.
  readonly locked: boolean;
  // A row in `private.admins`: never locked, and shown the review queue for
  // reported names.
  readonly admin: boolean;
  // No `email` and no `phone`, deliberately — a contact detail exists on the
  // auth account only, in a schema the API does not serve.
};

// Another account, as anyone allowed to see it sees it: somebody the viewer
// follows, somebody following them, or a prefilled account. Read from its
// profile each time, so a rename shows everywhere at once.
export type Account = {
  readonly uid: string;
  readonly displayName: string;
  readonly photoURL: string | null;
  // Made by us to hold a critic's or a publication's taste: nobody signs in
  // to it, and anyone may find and follow it.
  readonly prefilled: boolean;
  // A prefilled account's, shown as `@handle`. A person has none.
  readonly handle: string | null;
  // The attributes a prefilled account's thumbs use, on the most things
  // first: what the people screen's search finds it by, as a thing by its
  // attributes. A person's is empty.
  readonly tags: readonly string[];
};

// Five screens (DESIGN §1): the list, a thing, the people, importing, and an
// admin's reported names. Every variant round-trips through
// `screenHash`/`screenForHash`, so each screen has a URL — `#/`, `#/item/<id>`,
// `#/people`, `#/import` and `#/reports`.
export type Screen =
  | { readonly kind: "list" }
  | { readonly kind: "people" }
  // Nothing of an import is in the address: a reload starts it over.
  | { readonly kind: "import" }
  // Only an admin's: anybody else who opens it is put on the list, as for a
  // fragment that names no screen.
  | { readonly kind: "reports" }
  // `id` is the item's id, which is the text somebody typed, so the URL of a
  // thing reads as the thing.
  | { readonly kind: "item"; readonly id: string };

// One entry in the shared catalog. No name — the id IS the display text
// (DESIGN §3.2) — and no creator, no url and no tag list; `created_at` is in no
// select grant either, so nothing here can carry it.
export type Item = {
  // Lower-case NFKC Unicode, what `normalizeId` makes of what somebody typed:
  // `café bleu`, accent and space kept.
  readonly id: string;
  // The same id with its accents and punctuation stripped, which is what the
  // catalog's prefix search matches against. The client writes it, from
  // `searchFold` — there is no second implementation anywhere.
  readonly searchId: string;
};

export type RatingValue = 1 | -1;

// The viewer's own thumbs, keyed the way the rows are: item id, then tag, with
// the empty string for the thing itself. Two levels rather than one joined
// string, because `(user_id, item_id, tag)` is the primary key and the NUL the
// core joins the two halves with never leaves the core.
export type Ratings = Readonly<
  Record<string, Readonly<Record<string, RatingValue>>>
>;

// One item in the viewer's own recommendations. Every number in it is personal
// to the viewer: there is no global score, and nothing says who any of it came
// from.
export type { RecsEntry } from "grapevine-shared/entries";
