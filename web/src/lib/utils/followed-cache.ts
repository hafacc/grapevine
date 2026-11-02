import type { Held } from "./taste";

// The thumbs of the accounts a viewer follows, kept on the device between
// sessions so an open reads only what changed. IndexedDB rather than
// localStorage: one critic is thousands of thumbs, and localStorage is a few
// megabytes shared with the list itself.
//
// Everything here may fail — a private window, a full disk, a browser with no
// IndexedDB — and failing costs a full read from the server, never an error on
// screen. So every function answers as though the cache were empty.

const DATABASE = "grapevine-followed";
const STORE = "thumbs";

type Row = Held & { readonly viewer: string; readonly account: string };

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE, {
          keyPath: ["viewer", "account"],
        });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function settle(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
}

/** Everything kept for `viewer`, by account. */
export async function readFollowed(viewer: string): Promise<Map<string, Held>> {
  const held = new Map<string, Held>();
  const database = await open();
  if (database === null) return held;
  try {
    const transaction = database.transaction(STORE, "readonly");
    const request = transaction
      .objectStore(STORE)
      .getAll(IDBKeyRange.bound([viewer], [viewer, []]));
    await settle(transaction);
    for (const row of (request.result ?? []) as Row[]) {
      if (
        typeof row.account === "string" &&
        typeof row.stamp === "string" &&
        typeof row.revision === "number" &&
        typeof row.removed === "number" &&
        typeof row.thumbs === "object" &&
        row.thumbs !== null
      )
        held.set(row.account, {
          stamp: row.stamp,
          revision: row.revision,
          removed: row.removed,
          thumbs: row.thumbs,
        });
    }
  } catch {
    held.clear();
  } finally {
    database.close();
  }
  return held;
}

/** Keeps `changed` for `viewer` and forgets every account in `gone`. */
export async function writeFollowed(
  viewer: string,
  changed: ReadonlyMap<string, Held>,
  gone: readonly string[],
): Promise<void> {
  if (changed.size === 0 && gone.length === 0) return;
  const database = await open();
  if (database === null) return;
  try {
    const transaction = database.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    for (const [account, held] of changed)
      store.put({ viewer, account, ...held } satisfies Row);
    for (const account of gone) store.delete([viewer, account]);
    await settle(transaction);
  } catch {
    // Not kept: the next open reads these accounts in full.
  } finally {
    database.close();
  }
}

/**
 * Everything kept, whoever's it was. Called on sign-out: these are other
 * people's ratings, and the next person at a shared device follows nobody.
 */
export async function forgetFollowed(): Promise<void> {
  const database = await open();
  if (database === null) return;
  try {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).clear();
    await settle(transaction);
  } catch {
    // Nothing could be written here either, so nothing is left behind.
  } finally {
    database.close();
  }
}
