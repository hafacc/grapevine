/** A first-run question remembered per account on this device. */
export interface OfferMemory {
  /** whether the account is still to be asked */
  readonly waiting: (uid: string) => boolean;
  /** remember that the account is to be asked, or has answered */
  readonly set: (uid: string, waiting: boolean) => void;
  /** forget every account's, on sign-out */
  readonly forget: (storage: Storage) => void;
}

// Storage can throw or be cleared; either way the question is not asked, and
// what it offers stays on the people screen.
export function offerMemory(prefix: string): OfferMemory {
  return {
    waiting(uid) {
      try {
        return window.localStorage.getItem(prefix + uid) !== null;
      } catch {
        return false;
      }
    },
    set(uid, waiting) {
      try {
        if (waiting) window.localStorage.setItem(prefix + uid, "1");
        else window.localStorage.removeItem(prefix + uid);
      } catch {
        // Not asked, and nothing else.
      }
    },
    // The uid in each key says who used this device.
    forget(storage) {
      const keys: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(prefix)) keys.push(key);
      }
      for (const key of keys) storage.removeItem(key);
    },
  };
}
