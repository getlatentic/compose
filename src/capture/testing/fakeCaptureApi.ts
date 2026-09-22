import { vi } from "vitest";

import type { CaptureApi, ClipboardEntry, ClipboardSummary, QuickNote, QuickNoteView } from "../captureApi";

export interface FakeClip extends ClipboardEntry {
  sourceName?: string;
  pinned?: boolean;
}

/**
 * The app as the quick-note window sees it, in memory: quick notes, saved
 * notes, images, and a clipboard history, with every call recorded.
 */
export function fakeCaptureApi(options: { notes?: QuickNote[]; clips?: FakeClip[]; historyOn?: boolean } = {}) {
  const notes = new Map((options.notes ?? []).map((note) => [note.id, note]));
  const saved: { id: string; text: string }[] = [];
  const images = new Map<string, Uint8Array>();
  let clips = [...(options.clips ?? [])];
  let historyOn = options.historyOn ?? true;
  let shown: ((view: QuickNoteView) => void) | null = null;
  let copied: (() => void) | null = null;
  let now = 1_700_000_000_000;

  const summary = (clip: FakeClip, index: number): ClipboardSummary => ({
    id: clip.id,
    kind: clip.kind,
    preview: clip.text,
    characters: clip.text.length,
    rich: clip.html !== null,
    sourceName: clip.sourceName ?? null,
    copiedAt: now - index * 60_000,
    pinned: clip.pinned ?? false,
  });

  const api: CaptureApi = {
    notes: vi.fn(async () => [...notes.values()].sort((a, b) => b.createdAt - a.createdAt)),
    keepNote: vi.fn(async (id: string, body: string) => {
      const existing = notes.get(id);
      const note = { id, body, createdAt: existing?.createdAt ?? (now += 1), updatedAt: (now += 1) };
      notes.set(id, note);
      return note;
    }),
    deleteNote: vi.fn(async (id: string) => void notes.delete(id)),
    keepImage: vi.fn(async (id: string, relativePath: string, bytes: Uint8Array) => void images.set(`${id}/${relativePath}`, bytes)),
    noteFolder: vi.fn(async (id: string) => `/data/quick-notes/${id}`),
    save: vi.fn(async (id: string, text: string) => {
      if (!text.trim()) return false;
      saved.push({ id, text });
      notes.delete(id);
      return true;
    }),
    close: vi.fn(async () => {}),
    destination: vi.fn(async () => "My Notes"),
    onShown: vi.fn(async (callback: (view: QuickNoteView) => void) => {
      shown = callback;
      return () => {
        shown = null;
      };
    }),
    clipboard: {
      history: vi.fn(async (query: string) => ({
        enabled: historyOn,
        items: clips
          .map(summary)
          .filter((item) => item.preview.toLowerCase().includes(query.trim().toLowerCase()))
          .sort((a, b) => Number(b.pinned) - Number(a.pinned)),
      })),
      setEnabled: vi.fn(async (enabled: boolean) => (historyOn = enabled)),
      entry: vi.fn(async (id: string) => {
        const clip = clips.find((each) => each.id === id);
        return clip ? { id: clip.id, kind: clip.kind, text: clip.text, html: clip.html, imageDataUrl: clip.imageDataUrl } : null;
      }),
      copy: vi.fn(async () => {}),
      pin: vi.fn(async (id: string, pinned: boolean) => {
        clips = clips.map((clip) => (clip.id === id ? { ...clip, pinned } : clip));
      }),
      forget: vi.fn(async (id: string) => {
        clips = clips.filter((clip) => clip.id !== id);
      }),
      clear: vi.fn(async () => {
        clips = clips.filter((clip) => clip.pinned);
      }),
      onChanged: vi.fn(async (callback: () => void) => {
        copied = callback;
        return () => {
          copied = null;
        };
      }),
    },
  };

  return {
    api,
    notes,
    saved,
    images,
    /** The shortcut opened the window on `view`. */
    show: (view: QuickNoteView) => shown?.(view),
    /** Something new was copied in another app. */
    copy(clip: FakeClip) {
      clips = [clip, ...clips];
      copied?.();
    },
  };
}

export function clip(id: string, text: string, extra: Partial<FakeClip> = {}): FakeClip {
  return { id, kind: "text", text, html: null, imageDataUrl: null, ...extra };
}
