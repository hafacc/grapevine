import type { ImportSource } from "grapevine-shared/import";

// Where an import that was left part-way stopped: its source, how many
// ratings its file held and how many of them were dealt with. No rating and
// no name. With it, choosing the same file again takes up where it stopped,
// which for a long history of places is hours not asked for twice.
const RESUME_KEY = "grapevine:import-resume:";

type Resume = { source: ImportSource; total: number; done: number };

/** How many of this file's ratings an earlier run already dealt with. */
export function importResume(
  uid: string,
  source: ImportSource,
  total: number,
): number {
  try {
    const kept = JSON.parse(
      window.localStorage.getItem(RESUME_KEY + uid) ?? "null",
    ) as Partial<Resume> | null;
    // Another file, or the same one exported again with more in it, starts
    // from its top.
    return kept?.source === source &&
      kept.total === total &&
      Number.isInteger(kept.done) &&
      Number(kept.done) > 0 &&
      Number(kept.done) < total
      ? Number(kept.done)
      : 0;
  } catch {
    return 0;
  }
}

/** Remembers how far a run has got; null once it has finished. */
export function setImportResume(uid: string, resume: Resume | null): void {
  try {
    if (resume === null) window.localStorage.removeItem(RESUME_KEY + uid);
    else window.localStorage.setItem(RESUME_KEY + uid, JSON.stringify(resume));
  } catch {
    // The next run starts from the top, and skips what is already rated.
  }
}

// Everybody's, on sign-out: the uid in each key says who used this device.
export function forgetImportResumes(storage: Storage): void {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(RESUME_KEY)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}
