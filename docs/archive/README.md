# Archived docs — superseded, kept for provenance

These documents describe **earlier designs that the codebase has since moved
past.** They are retained for history and to explain *why* certain decisions
were made, but they **do not describe the app as it is built today.** Do not
treat anything here as current.

For the current picture, read:

- [`docs/spec.md`](../spec.md) — the current product & architecture overview.
- [`docs/editor-guide.md`](../editor-guide.md),
  [`docs/ipc-guide.md`](../ipc-guide.md),
  [`docs/review-guide.md`](../review-guide.md) — current domain guides.
- [`AGENTS.md`](../../AGENTS.md) — the durable agent/contributor contract.
- [`RELEASE.md`](../../RELEASE.md) — first-release checklist.

## What's here and why it's archived

| File | Why superseded |
|---|---|
| `vellum-local-first-production-spec-v3.2.md` | The original "Vellum" production spec. Describes a **custom Canvas2D / WASM (`vellum_engine`) editor** and an R0–R13 milestone plan. The editor is now **Tiptap/ProseMirror** and the WASM engine was removed; the product is now **Compose**. Still useful for the storage-contract reasoning (metadata outside the vault) and invariants, much of which survives. |
| `vellum-local-first-production-spec-v3.1.md` | Prior revision of the above. |
| `handoff-2026-05-28.md` | Session handoff describing the Canvas/WASM editor and an unproven Bob auth path — both obsolete. |
| `progress-handoff-2026-05-26.md` | "Files-first Bob workspace" handoff describing a **CodeMirror 6** editor and a pre-streaming Bob (command-preview only). Both obsolete. |
| `Stack.md` | "BobShell desktop wrapper" stack doc (Tailwind/Radix/Lucide/CodeMirror). The shipped stack is Tauri + React + Tiptap + Carbon; the product name is Compose, not Bob. |
| `folio-prototype.html` | An early static UI prototype ("Workspace — Bob"). |

The `bob Shell Details.md` and `bob shell help docs.md` files were **not**
archived — they document the `bob` CLI wire format and remain valid reference
for the bob harness adapter.
