/**
 * Another service's scale as a thumb (DESIGN §1 "Importing"). The cuts are
 * fixed: the top of a scale is a yes, the bottom a no, and the middle is
 * neither and is not imported.
 */

export type Thumb = 1 | -1;

/** A thumb, or `between` for a rating that is neither a yes nor a no. */
export type Cut = Thumb | "between";

/** IMDb's and Trakt's 1–10: 7 and up is a yes, 4 and down a no. */
export function imdbThumb(rating: number): Cut {
  if (rating >= 7) return 1;
  else if (rating <= 4) return -1;
  else return "between";
}

/**
 * Letterboxd's ½–5 and its heart: 4 and up is a yes, 2 and down a no. A heart
 * is a yes on a film with no rating or a middle one; a rating outside the
 * middle wins over it.
 */
export function letterboxdThumb(rating: number | null, liked: boolean): Cut {
  if (rating !== null && rating >= 4) return 1;
  else if (rating !== null && rating <= 2) return -1;
  else if (liked) return 1;
  else return "between";
}

/**
 * Five stars, Goodreads', Google's and StoryGraph's: 4 and up is a yes, 2 and
 * down a no. StoryGraph's quarter stars between, `3.75` among them, are
 * neither.
 */
export function fiveStarThumb(rating: number): Cut {
  if (rating >= 4) return 1;
  else if (rating <= 2) return -1;
  else return "between";
}

/**
 * Netflix's thumbs: `1` is down, `2` up and `3`, two thumbs up, up. `0` is
 * not rated, and is no thumb.
 */
export function netflixThumb(thumbs: number): Thumb | null {
  if (thumbs === 1) return -1;
  else if (thumbs === 2 || thumbs === 3) return 1;
  else return null;
}
