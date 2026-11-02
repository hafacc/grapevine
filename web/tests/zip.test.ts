import { describe, expect, it } from "bun:test";
import { deflateRawSync } from "node:zlib";
import {
  canInflate,
  listZip,
  MAX_ENTRY_BYTES,
  readZipEntry,
} from "../src/lib/utils/zip";

type Made = {
  path: string;
  text: string;
  stored?: boolean;
  // Sizes left out of the local header and written after the data, as a zip
  // streamed from a server has them.
  descriptor?: boolean;
  utf8Flag?: boolean;
  zip64?: boolean;
  // Extra bytes in the local header only.
  localExtra?: number;
};

const encoder = new TextEncoder();

function bytes(...parts: (Uint8Array | number[])[]): Uint8Array {
  const all = parts.map((part) => Uint8Array.from(part));
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of all) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const u16 = (value: number): number[] => [value & 0xff, (value >> 8) & 0xff];
const u32 = (value: number): number[] => [
  ...u16(value & 0xffff),
  ...u16((value >>> 16) & 0xffff),
];
const u64 = (value: number): number[] => [...u32(value), ...u32(0)];

// A zip written by hand, so each feature the reader handles is in a file.
function makeZip(
  files: readonly Made[],
  { comment = "", zip64End = false } = {},
): Blob {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.path);
    const raw = encoder.encode(file.text);
    const data = file.stored ? raw : new Uint8Array(deflateRawSync(raw));
    const method = file.stored ? 0 : 8;
    const flags = (file.descriptor ? 1 << 3 : 0) | (file.utf8Flag ? 1 << 11 : 0);
    const sizes = file.descriptor
      ? [...u32(0), ...u32(0)]
      : [...u32(data.length), ...u32(raw.length)];
    const local = bytes(
      u32(0x04034b50),
      u16(20),
      u16(flags),
      u16(method),
      u32(0),
      u32(0),
      sizes,
      u16(name.length),
      u16(file.localExtra ?? 0),
      name,
      new Array(file.localExtra ?? 0).fill(0),
      data,
      file.descriptor
        ? [...u32(0x08074b50), ...u32(0), ...u32(data.length), ...u32(raw.length)]
        : [],
    );
    const extra = file.zip64
      ? [...u16(0x0001), ...u16(24), ...u64(raw.length), ...u64(data.length), ...u64(offset)]
      : [];
    const wide = file.zip64 ? 0xffffffff : null;
    central.push(
      bytes(
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(flags),
        u16(method),
        u32(0),
        u32(0),
        u32(wide ?? data.length),
        u32(wide ?? raw.length),
        u16(name.length),
        u16(extra.length),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(wide ?? offset),
        name,
        extra,
      ),
    );
    locals.push(local);
    offset += local.length;
  }
  const directory = bytes(...central);
  const note = encoder.encode(comment);
  const end64 = zip64End
    ? bytes(
        u32(0x06064b50),
        u64(44),
        u16(45),
        u16(45),
        u32(0),
        u32(0),
        u64(files.length),
        u64(files.length),
        u64(directory.length),
        u64(offset),
        u32(0x07064b50),
        u32(0),
        u64(offset + directory.length),
        u32(1),
      )
    : new Uint8Array();
  const end = bytes(
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(zip64End ? 0xffff : files.length),
    u16(zip64End ? 0xffff : files.length),
    u32(zip64End ? 0xffffffff : directory.length),
    u32(zip64End ? 0xffffffff : offset),
    u16(note.length),
    note,
  );
  return new Blob([bytes(...locals, directory, end64, end) as BlobPart]);
}

const RATINGS = "Date,Name,Year,Letterboxd URI,Rating\r\n2024-03-02,Amélie,2001,https://boxd.it/2aLg,5\r\n";

async function read(zip: Blob, path: string): Promise<string> {
  const entry = (await listZip(zip)).find((found) => found.path === path);
  if (entry === undefined) throw new Error(`no ${path}`);
  return readZipEntry(zip, entry);
}

describe("zip", () => {
  it("can inflate here", () => {
    expect(canInflate()).toBe(true);
  });

  it("lists files, not folders, and reads a deflated and a stored one", async () => {
    const zip = makeZip([
      { path: "likes/", text: "", stored: true },
      { path: "ratings.csv", text: RATINGS },
      { path: "likes/films.csv", text: "Date,Name,Year,Letterboxd URI\r\n", stored: true },
    ]);
    expect((await listZip(zip)).map((entry) => entry.path)).toEqual([
      "ratings.csv",
      "likes/films.csv",
    ]);
    expect(await read(zip, "ratings.csv")).toBe(RATINGS);
    expect(await read(zip, "likes/films.csv")).toBe(
      "Date,Name,Year,Letterboxd URI\r\n",
    );
  });

  // Letterboxd's own zips: every entry deflated, flags 0x808.
  it("reads an entry whose sizes follow its data, by the directory's sizes", async () => {
    const zip = makeZip([
      { path: "profile.csv", text: "Date Joined,Username\r\n", descriptor: true, utf8Flag: true },
      { path: "ratings.csv", text: RATINGS, descriptor: true, utf8Flag: true },
    ]);
    expect(await read(zip, "ratings.csv")).toBe(RATINGS);
  });

  it("reads a name that is not ASCII, as Takeout's are in some languages", async () => {
    const path = "Takeout/Maps (tus sitios)/Reseñas.json";
    const zip = makeZip([{ path, text: "{}", utf8Flag: true }]);
    expect(await read(zip, path)).toBe("{}");
  });

  it("finds the data past a local header longer than the directory's", async () => {
    const zip = makeZip([
      { path: "a.csv", text: "first", localExtra: 36 },
      { path: "b.csv", text: "second", localExtra: 36 },
    ]);
    expect(await read(zip, "b.csv")).toBe("second");
  });

  it("finds the directory behind a comment", async () => {
    const zip = makeZip([{ path: "ratings.csv", text: RATINGS }], {
      comment: "exported by somebody, with a note",
    });
    expect(await read(zip, "ratings.csv")).toBe(RATINGS);
  });

  it("reads zip64 records and a zip64 entry", async () => {
    const zip = makeZip(
      [
        { path: "first.csv", text: "one" },
        { path: "ratings.csv", text: RATINGS, zip64: true },
      ],
      { zip64End: true },
    );
    expect(await read(zip, "ratings.csv")).toBe(RATINGS);
    expect(await read(zip, "first.csv")).toBe("one");
  });

  it("refuses what is not a zip", async () => {
    await expect(listZip(new Blob(["Date,Name\r\n"]))).rejects.toThrow("not a zip");
    await expect(listZip(new Blob([]))).rejects.toThrow("not a zip");
  });

  it("refuses an entry that says it is past the cap, or inflates past it", async () => {
    const zip = makeZip([{ path: "ratings.csv", text: RATINGS }]);
    const [entry] = await listZip(zip);
    if (entry === undefined) throw new Error("no entry");
    await expect(
      readZipEntry(zip, { ...entry, size: MAX_ENTRY_BYTES + 1 }),
    ).rejects.toThrow("too large");
    const bomb = makeZip([{ path: "big.csv", text: "0".repeat(MAX_ENTRY_BYTES + 1) }]);
    const [big] = await listZip(bomb);
    if (big === undefined) throw new Error("no entry");
    await expect(readZipEntry(bomb, { ...big, size: 10 })).rejects.toThrow(
      "too large",
    );
  });
});
