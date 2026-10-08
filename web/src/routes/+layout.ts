// A static export: every page is written out at build time, and there is no
// server to render one later.
export const prerender = true;

// `/about/`, not `/about`: Pages serves a directory's `index.html` at the
// address with the slash, and the service worker keys its offline copies on it.
export const trailingSlash = "always";
