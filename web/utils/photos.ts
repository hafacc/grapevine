const AVATAR_HOST = "https://lh3.googleusercontent.com/";

// Every avatar drawn in grapevine is a profile's `photo_url`, which its owner
// can update, so the address is theirs to choose and no policy pins it to an
// origin. The
// renderer is the one at risk, so the check belongs here. Google's host is the
// only one allowed because a Google account arrives wearing a photo we copy
// untouched and never mint a URL for; grapevine uploads none of its own.
export function photoSrc(url: string): string | null {
  return url.startsWith(AVATAR_HOST) ? url : null;
}
