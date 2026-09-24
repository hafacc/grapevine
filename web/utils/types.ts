export type Profile = {
  readonly uid: string;
  // Optional and permanent; exists only to power searchability, so an account
  // that never wants to be found never needs one. Empty until claimed.
  readonly username: string;
  readonly displayName: string;
  readonly photoURL: string | null;
  // Off means unreadable by non-friends and no inbound requests, not just hidden.
  readonly searchable: boolean;
  readonly createdAt: number;
  // No `email` and no `phone`, deliberately — a contact detail exists on the
  // auth account only, in a schema the API does not serve.
};

// One side of a friendship, joined to the other party's profile at read time.
// Nothing here is a copy the database keeps: a friend may read your profile, so
// a rename heals everywhere at once instead of being rewritten per edge.
export type Friend = {
  readonly uid: string;
  readonly username: string;
  readonly displayName: string;
  readonly photoURL: string | null;
  readonly since: number;
};

// "Let's be friends", nothing else. `(from, to)` is the primary key, so exactly
// one pending ask per pair.
export type ConnectRequest = {
  readonly from: string;
  readonly to: string;
  readonly createdAt: number;
  // The party at the other end, whoever that is: the sender on an ask you
  // received, the recipient on one you sent. Both lists are read for one viewer,
  // so "the other one" is never ambiguous. It is joined rather than stored: a
  // pending request in either direction is itself what lets the two read each
  // other's profile.
  readonly other: Party;
};

// A public-safe identity, for wherever two people can't yet read each other.
export type Party = {
  readonly uid: string;
  readonly username: string;
  readonly displayName: string;
  readonly photoURL: string | null;
};

// Three screens (DESIGN §1): the list, a thing, and the people.
// Every variant round-trips through `screenHash`/`screenForHash`, so each screen
// has a URL — `#/`, `#/item/<id>` and `#/people`.
export type Screen =
  | { readonly kind: "list" }
  | { readonly kind: "people" }
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

// One item in the viewer's own recommendations, as the recompute writes it
// (DESIGN §3.2). Every number here is personal to the viewer: there is no
// global score, and nothing says who any of it came from.
export type RecsEntry = {
  readonly itemId: string;
  readonly score: number;
  // Support behind the score. Below `W_min` an entry does not surface at all,
  // so what is stored is already above the floor.
  readonly conf: number;
  // The viewer's personalized "does it have this tag?" score per tag, which is
  // also where the item page's chips come from.
  readonly tags: Readonly<Record<string, number>>;
};

// Somebody taste search found. A uid and a rank and nothing else: the name and
// handle are joined from the profile, which anyone in your own suggestions list
// lets you read, and the words the row is drawn with are the attributes you
// agree on against the grain — asked for by `sharedAttributes` and stored
// nowhere (DESIGN §5.1).
export type Suggestion = {
  readonly uid: string;
  readonly username: string;
  readonly displayName: string;
};

// `user_prefs`, which only its owner can read or write. Off means never
// suggested to anyone and no suggestions of your own: one channel, both ways
// (DESIGN §5.1).
export type { Prefs } from "grapevine-shared/entries";
