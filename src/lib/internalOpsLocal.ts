/** Client-side ops tools until dedicated broadcast/notes RPCs exist. */

export type InternalShopNote = {
  id: string;
  body: string;
  author: string;
  createdAt: string;
};

export type OpsAnnouncement = {
  id: string;
  title: string;
  body: string;
  kind: "maintenance" | "feature" | "payment" | "update";
  createdAt: string;
  createdBy: string;
};

const NOTES_KEY = "waka.ops.internal.notes";
const ANNOUNCE_KEY = "waka.ops.announcements";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function listShopInternalNotes(shopId: string): InternalShopNote[] {
  const all = readJson<Record<string, InternalShopNote[]>>(NOTES_KEY, {});
  return all[shopId] ?? [];
}

export function addShopInternalNote(shopId: string, body: string, author: string): InternalShopNote {
  const note: InternalShopNote = {
    id: crypto.randomUUID(),
    body: body.trim(),
    author,
    createdAt: new Date().toISOString(),
  };
  const all = readJson<Record<string, InternalShopNote[]>>(NOTES_KEY, {});
  all[shopId] = [note, ...(all[shopId] ?? [])].slice(0, 40);
  writeJson(NOTES_KEY, all);
  return note;
}

export function listAnnouncements(): OpsAnnouncement[] {
  return readJson<OpsAnnouncement[]>(ANNOUNCE_KEY, []);
}

export function createAnnouncement(
  input: Omit<OpsAnnouncement, "id" | "createdAt">,
): OpsAnnouncement {
  const row: OpsAnnouncement = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const list = [row, ...listAnnouncements()].slice(0, 20);
  writeJson(ANNOUNCE_KEY, list);
  return row;
}
