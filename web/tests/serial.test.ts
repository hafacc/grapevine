import { describe, expect, it } from "bun:test";
import { createSerializer } from "../utils/serial";

// A write the test finishes by hand, so a slow request can be made to land
// after a fast one.
function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
} {
  let resolve: () => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

function harness() {
  const shown: (number | null)[] = [];
  const sent: (number | null)[] = [];
  const submit = createSerializer<number | null>((_key, value) => {
    shown.push(value);
  });
  return { shown, sent, submit };
}

describe("createSerializer", () => {
  it("sends a second thumb only after the first has landed", async () => {
    const { shown, sent, submit } = harness();
    const slow = deferred();
    const first = submit("coffee", 1, null, async () => {
      sent.push(1);
      await slow.promise;
    });
    await settle();
    const second = submit("coffee", -1, null, async () => {
      sent.push(-1);
    });
    await settle();
    // The second is not on the wire while the first is.
    expect(sent).toEqual([1]);
    // But the screen already shows it: it answers the swipe, not the network.
    expect(shown).toEqual([1, -1]);
    slow.resolve();
    await Promise.all([first, second]);
    expect(sent).toEqual([1, -1]);
    expect(shown).toEqual([1, -1]);
  });

  it("never sends a thumb that was overtaken before its turn", async () => {
    const { sent, submit } = harness();
    const slow = deferred();
    const first = submit("coffee", 1, null, async () => {
      sent.push(1);
      await slow.promise;
    });
    await settle();
    const middle = submit("coffee", -1, null, async () => {
      sent.push(-1);
    });
    const last = submit("coffee", null, null, async () => {
      sent.push(null);
    });
    slow.resolve();
    await Promise.all([first, middle, last]);
    expect(sent).toEqual([1, null]);
  });

  it("puts back what the server holds when the newest write is refused", async () => {
    const { shown, submit } = harness();
    await submit("coffee", 1, null, async () => {});
    const refused = submit("coffee", -1, 1, async () => {
      throw new Error("refused");
    });
    await expect(refused).rejects.toThrow("refused");
    expect(shown).toEqual([1, -1, 1]);
  });

  it("does not put an older answer back over a newer one", async () => {
    const { shown, submit } = harness();
    const slow = deferred();
    const first = submit("coffee", 1, null, async () => {
      await slow.promise;
    });
    await settle();
    const second = submit("coffee", -1, null, async () => {});
    slow.reject(new Error("refused"));
    // The overtaken refusal is not the row's answer, so it is not reported.
    await first;
    await second;
    expect(shown).toEqual([1, -1]);
  });

  it("rolls back past a refused older write to the value before either", async () => {
    const { shown, submit } = harness();
    const slow = deferred();
    const first = submit("coffee", 1, null, async () => {
      await slow.promise;
    });
    await settle();
    const second = submit("coffee", -1, null, async () => {
      throw new Error("refused too");
    });
    slow.reject(new Error("refused"));
    await first;
    await expect(second).rejects.toThrow("refused too");
    expect(shown).toEqual([1, -1, null]);
  });

  it("keeps keys apart", async () => {
    const { sent, submit } = harness();
    const slow = deferred();
    const coffee = submit("coffee", 1, null, async () => {
      sent.push(1);
      await slow.promise;
    });
    const tea = submit("tea", -1, null, async () => {
      sent.push(-1);
    });
    await tea;
    expect(sent).toEqual([1, -1]);
    slow.resolve();
    await coffee;
  });
});
