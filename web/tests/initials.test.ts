import { describe, expect, it } from "bun:test";
import { initials } from "../utils/initials";

describe("initials", () => {
  it("takes the first and last word's first letters", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("Ada King Lovelace")).toBe("AL");
  });

  it("keeps to the script the name starts in", () => {
    expect(initials("Chen Wei 陈伟")).toBe("CW");
    expect(initials("陈伟 Chen Wei")).toBe("陈");
  });

  it("draws one letter for one word and a mark for none", () => {
    expect(initials("陈伟")).toBe("陈");
    expect(initials("  ")).toBe("?");
  });
});
