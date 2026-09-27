// The list's one-time hint, remembered per viewer on this device. Storage can
// throw (a private window) or be cleared; either way the hint shows again,
// which costs a tap.
const HINT_KEY = "grapevine:hint-seen:";

export function hintSeen(uid: string): boolean {
  try {
    return window.localStorage.getItem(HINT_KEY + uid) !== null;
  } catch {
    return false;
  }
}

export function markHintSeen(uid: string): void {
  try {
    window.localStorage.setItem(HINT_KEY + uid, "1");
  } catch {
    // Shown again next time, and nothing else.
  }
}

// Everybody's, on sign-out: the uid in each key says who used this device.
export function forgetHintsSeen(storage: Storage): void {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(HINT_KEY)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}
