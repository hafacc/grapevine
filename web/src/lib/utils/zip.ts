/**
 * Reading a few files out of a zip, with nothing but standard APIs: the
 * Compression Standard inflates a stream and reads no archive, so the
 * directory is read here (PKWARE APPNOTE 6.3.10).
 *
 * Through `Blob.slice`, so a multi-gigabyte Takeout is never loaded: only its
 * directory and the entries asked for.
 */

export type ZipEntry = {
  readonly path: string;
  // 0 is stored, 8 deflated; anything else cannot be read here.
  readonly method: number;
  readonly compressedSize: number;
  readonly size: number;
  // Of the entry's local header.
  readonly offset: number;
};

// No export this reads comes near it; a zip that claims more is not one.
export const MAX_ENTRY_BYTES = 50 * 1024 * 1024;

const END = 0x06054b50;
const END_64_LOCATOR = 0x07064b50;
const END_64 = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const ZIP64_EXTRA = 0x0001;
// The record is 22 bytes and a comment of up to 65 535 follows it.
const END_SEARCH = 22 + 0xffff;

async function view(file: Blob, from: number, to: number): Promise<DataView> {
  return new DataView(await file.slice(from, to).arrayBuffer());
}

// The sizes here fit a double exactly: a zip past 2^53 bytes is no file.
function uint64(data: DataView, at: number): number {
  return Number(data.getBigUint64(at, true));
}

/**
 * Chrome 80 to 102 has `DecompressionStream` and throws on `deflate-raw`, so
 * it is tested by making one.
 */
export function canInflate(): boolean {
  try {
    new DecompressionStream("deflate-raw");
    return true;
  } catch {
    return false;
  }
}

/** Every file in the zip. Throws for a file that is not a zip. */
export async function listZip(file: Blob): Promise<ZipEntry[]> {
  const tailStart = Math.max(0, file.size - END_SEARCH);
  const tail = await view(file, tailStart, file.size);
  let end = tail.byteLength - 22;
  while (end >= 0 && tail.getUint32(end, true) !== END) end -= 1;
  if (end < 0) throw new Error("not a zip");
  let count = tail.getUint16(end + 10, true);
  let directorySize = tail.getUint32(end + 12, true);
  let directoryOffset = tail.getUint32(end + 16, true);
  if (
    count === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  ) {
    const locatorAt = tailStart + end - 20;
    const locator = await view(file, locatorAt, locatorAt + 20);
    if (locatorAt < 0 || locator.getUint32(0, true) !== END_64_LOCATOR)
      throw new Error("not a zip");
    const recordAt = uint64(locator, 8);
    const record = await view(file, recordAt, recordAt + 56);
    if (record.getUint32(0, true) !== END_64) throw new Error("not a zip");
    count = uint64(record, 32);
    directorySize = uint64(record, 40);
    directoryOffset = uint64(record, 48);
  }
  const directory = await view(
    file,
    directoryOffset,
    directoryOffset + directorySize,
  );
  const entries: ZipEntry[] = [];
  let at = 0;
  for (let index = 0; index < count; index += 1) {
    if (
      at + 46 > directory.byteLength ||
      directory.getUint32(at, true) !== CENTRAL
    )
      throw new Error("not a zip");
    const nameLength = directory.getUint16(at + 28, true);
    const extraLength = directory.getUint16(at + 30, true);
    const commentLength = directory.getUint16(at + 32, true);
    let compressedSize = directory.getUint32(at + 20, true);
    let size = directory.getUint32(at + 24, true);
    let offset = directory.getUint32(at + 42, true);
    const nameAt = directory.byteOffset + at + 46;
    // Read as UTF-8 whether or not the entry's flag says so: without it a
    // name is nominally CP437, which agrees on every ASCII name, and a zip
    // made on a Mac writes UTF-8 without the flag.
    const path = new TextDecoder().decode(
      new Uint8Array(directory.buffer, nameAt, nameLength),
    );
    // Each 64-bit value is present only where its 32-bit field is all ones,
    // in this order.
    let extraAt = at + 46 + nameLength;
    const extraEnd = extraAt + extraLength;
    while (extraAt + 4 <= extraEnd) {
      const id = directory.getUint16(extraAt, true);
      const length = directory.getUint16(extraAt + 2, true);
      if (id === ZIP64_EXTRA) {
        let valueAt = extraAt + 4;
        if (size === 0xffffffff) {
          size = uint64(directory, valueAt);
          valueAt += 8;
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = uint64(directory, valueAt);
          valueAt += 8;
        }
        if (offset === 0xffffffff) offset = uint64(directory, valueAt);
      }
      extraAt += 4 + length;
    }
    if (!path.endsWith("/"))
      entries.push({
        path,
        method: directory.getUint16(at + 10, true),
        compressedSize,
        size,
        offset,
      });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * One entry's text. The sizes are the directory's, so a data descriptor after
 * the data never has to be read; the local header is read only for where the
 * data starts, since its name and extra field can differ in length from the
 * directory's.
 */
export async function readZipEntry(
  file: Blob,
  entry: ZipEntry,
): Promise<string> {
  if (entry.size > MAX_ENTRY_BYTES) throw new Error("too large");
  const header = await view(file, entry.offset, entry.offset + 30);
  if (header.byteLength < 30 || header.getUint32(0, true) !== LOCAL)
    throw new Error("not a zip");
  const start =
    entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  const data = file.slice(start, start + entry.compressedSize);
  if (entry.method === 0) return new Response(data).text();
  else if (entry.method !== 8) throw new Error("unknown compression");
  // Counted as it inflates: the directory's size is the zip's own claim.
  const reader = data
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"))
    .getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ENTRY_BYTES) {
      await reader.cancel();
      throw new Error("too large");
    }
    chunks.push(value);
  }
  return new Response(new Blob(chunks as BlobPart[])).text();
}
