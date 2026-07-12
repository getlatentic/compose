# When Compose — and when something else

*The honest version, kept current. Every claim here is verifiable in the shipped app.*

## The one-liner

**Compose is the AI writing workspace for people who will never install a CLI.**
Coding-agent power on your documents — Claude Code, Codex, or a local model — with a
review-and-undo net, and none of the developer setup: no terminal, no API keys to
paste, no runtime to install.

## The problem with "works with Claude Code"

Every AI-markdown editor today — Scratch, SoloMD, Moraya, and friends — integrates
agents the same way: *"works with Claude Code / Codex / Ollama via local CLI."*
Read that as a requirement: **you must already have a coding agent installed,
authenticated, and on your PATH.** That's a developer filter on the front door.

Compose removes the filter:

- **The runtime ships inside the app.** Node and uv are bundled; Compose can
  install an agent for you on first run. Nothing to `brew install` first.
- **Keys live in the macOS keychain**, entered once in Settings — or skipped
  entirely: Claude Code and Codex run on the subscription you already pay for.
- **Local models are one click.** If Ollama is installed but not running,
  Compose starts it for you.
- **Signed and notarized.** It installs and updates like a normal Mac app.

Your thesis-writing colleague can use Compose's AI features. They cannot use the
same features in the alternatives — not because the alternatives are bad, but
because those assume a developer at the keyboard.

## What only Compose does

1. **A safety net that doesn't require git.** Every agent edit is reviewable
   (accept/reject per file) or snapshot-backed; stale edits are flagged; every
   file has browsable version history with one-click restore; deletes go to a
   recoverable trash. Other tools answer "what if the AI ruins my file?" with
   *optional git integration* — which again assumes a developer.
2. **One normalized agent stream.** Claude Code, Codex, bob, ACP agents, and
   OpenAI-compatible/local models all flow through
   [`agent-harness`](https://github.com/getlatentic/agent-harness) (our
   published Rust crate) into the same chat, the same tool cards, the same edit
   review, the same Stop button. Adding an agent doesn't add a new UI.
3. **Comments that become agent work.** Select a passage, leave review comments,
   send them to the assistant as a brief — the writing workflow, not a chatbot
   bolted to a text box.
4. **Documents from anywhere, safely.** Double-click any `.md` in Finder and
   Compose edits the original in place — no folder mounted, no copy made — with
   the same autosave and conflict protection as workspace notes.

## When you should use something else

- **You want a minimal, calm notes app** and you're happy driving AI from a
  terminal → [Scratch](https://github.com/erictli/scratch) is excellent, more
  mature, and cross-platform. We think of it as the best of the "notes app
  with optional AI" category — Compose deliberately isn't that.
- **You live in Obsidian's plugin ecosystem** → stay there; Compose reads and
  writes plain `.md`, so you can point it at the same vault when you want
  agent help and keep Obsidian for everything else.
- **You need Windows or Linux today** → Compose is macOS-first while the core
  loop hardens (it's where signing, keychain, and the OS integrations live).
- **You want an IDE for code** → Compose is for prose. Use Cursor/VS Code.

## The bet

The market is moving from *"AI chat beside my notes"* to *"agents do real work
in my writing projects."* When that lands for non-developers, the products that
matter will be the ones that made agent power safe and zero-setup for people
who don't know what a PATH is. That's the product we're building — and the
safety loop (review, snapshots, history) plus the zero-setup stack (bundled
runtime, keychain, signing) is the part that can't be bolted on later.
