// Writes to one key that must reach the server in the order they were made.
//
// Two thumbs on the same row a moment apart are two requests racing: when the
// first is slow, the second lands first, the first then collides with it and
// falls back to an update, and the server ends up holding the thumb the screen
// no longer shows. So each key's writes run one after another, a write that was
// overtaken before its turn is never sent, and a refusal puts the screen back
// only when nothing newer has been asked for since — putting back an older
// answer over a newer one is the same desync the other way round.

type Pending<T> = {
  tail: Promise<void>;
  // The sequence number of the newest intent for this key.
  latest: number;
  // What the server holds, as far as this tab knows: the value before the
  // first unsent intent, then whatever each write that landed wrote.
  confirmed: T;
};

export type Serializer<T> = (
  key: string,
  value: T,
  current: T,
  write: () => Promise<void>,
) => Promise<void>;

/**
 * `show` puts a value on screen for a key; it is called with the new value at
 * once and again with the confirmed one if the newest write is refused.
 * `current` is what the screen shows for the key when nothing is pending.
 */
export function createSerializer<T>(
  show: (key: string, value: T) => void,
): Serializer<T> {
  const pending = new Map<string, Pending<T>>();
  let sequence = 0;

  return (key, value, current, write) => {
    const entry: Pending<T> = pending.get(key) ?? {
      tail: Promise.resolve(),
      latest: 0,
      confirmed: current,
    };
    sequence += 1;
    const mine = sequence;
    entry.latest = mine;
    pending.set(key, entry);
    show(key, value);

    const run = entry.tail.then(async () => {
      if (entry.latest !== mine) return;
      await write();
      entry.confirmed = value;
    });
    entry.tail = run.then(
      () => undefined,
      () => undefined,
    );
    void entry.tail.then(() => {
      if (entry.latest === mine && pending.get(key) === entry)
        pending.delete(key);
    });
    // An overtaken write's refusal is not reported: the newer intent behind it
    // runs next and answers for the row.
    return run.catch((error: unknown) => {
      if (entry.latest !== mine) return;
      show(key, entry.confirmed);
      throw error;
    });
  };
}
