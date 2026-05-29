
This changes the answer significantly.

Bob is closer to being embeddable than I assumed, because it has:

```txt
-o, --output-format
choices: text, json, stream-json
```

That means you likely have **three usable integration layers**:

```txt
1. text
   Human terminal output.

2. json
   Structured final output.

3. stream-json
   Structured event stream for app UIs.
```

## Important correction

Since your help output says:

```txt
-p, --prompt
[deprecated: Use the positional prompt instead.]
```

You should not design around:

```bash
bob -p "..."
```

Use positional prompts instead:

```bash
bob "Create a markdown note about this workspace"
```

or interactive continuation:

```bash
bob -i "Start by reviewing this workspace"
```

## What this means for your desktop app

For a Tauri app, your best integration path is probably:

```txt
Tauri React UI
  ↓
Rust backend
  ↓
spawn bob with --output-format stream-json
  ↓
parse JSON events from stdout
  ↓
render chat/tool/file events in React
```

Example command shape:

```bash
bob "Create a markdown note called architecture.md explaining this project" \
  --chat-mode code \
  --output-format stream-json \
  --approval-mode auto_edit \
  --max-coins 200
```

In Rust, you would run Bob with:

```txt
cwd = selected workspace folder
stdout = piped
stderr = piped
stdin = optional, depending on mode
```

Then parse each JSON event as it arrives.

## `json` vs `stream-json`

### `--output-format json`

Use this when you want one final structured result.

Good for:

```txt
- create a note
- summarize a file
- generate metadata
- return list of files changed
- produce a final report
```

Example:

```bash
bob "Create a project summary. Return a JSON object with summary, risks, next_steps." \
  --output-format json \
  --hide-intermediary-output
```

App flow:

```txt
Run Bob
Wait for completion
Parse final JSON
Update UI
```

### `--output-format stream-json`

Use this when you want a Codex/Claude Code-like UI.

Good for:

```txt
- live chat rendering
- streaming assistant output
- showing tool calls
- showing file edits
- progress UI
- logs
- cancellation
```

App flow:

```txt
Run Bob
Read JSON events line by line
Render events immediately
Persist events to local DB
Handle completion/error
```

This is likely the format you want for your desktop wrapper.

## Is this the same as `pi --mode rpc`?

Not exactly, but it may be good enough.

The distinction:

```txt
Bob --output-format stream-json
= machine-readable event stream from a Bob CLI run

Pi --mode rpc
= long-running bidirectional JSON protocol
```

Bob’s `stream-json` gives you structured output. That is great.

But from the help text alone, it does not prove Bob exposes a full app-control protocol where your app can send multiple JSON commands into one long-running process and receive typed responses. It looks more like:

```txt
App starts Bob with prompt
Bob streams structured events
Bob completes or continues interactively depending on mode
```

Whereas RPC is usually:

```txt
App starts agent server process
App sends request 1
Agent streams events
App sends request 2
Agent streams events
App sends cancel/resume/etc.
```

So the practical mapping is:

|Need|Bob option|
|---|---|
|Human terminal|`bob`|
|One-shot automation|`bob "prompt"`|
|One-shot structured output|`bob "prompt" -o json`|
|App-style streaming output|`bob "prompt" -o stream-json`|
|Prompt then continue interactively|`bob -i "prompt"`|
|Resume prior session|`bob --resume latest`|
|Control mode|`--chat-mode plan/code/advanced/ask`|
|Safer automation|`--approval-mode auto_edit` or `--allowed-tools`|
|Fully automatic risky mode|`--yolo` or `--approval-mode yolo`|

## For your app, use three Bob execution modes

### 1. Structured task mode

For app-native actions like “create markdown note”:

```bash
bob "Create a markdown note about X. Return JSON with files_created and summary." \
  --chat-mode code \
  --output-format json \
  --hide-intermediary-output \
  --approval-mode auto_edit
```

Use this when the UI wants a clean result.

### 2. Streaming agent mode

For Codex-like agent tasks:

```bash
bob "Review this workspace and propose improvements" \
  --chat-mode plan \
  --output-format stream-json \
  --approval-mode default
```

Use this for your main chat UI.

### 3. Embedded terminal mode

For full Bob Shell experience:

```bash
bob
```

or:

```bash
bob -i "Start by analyzing this workspace"
```

Run this through a Rust PTY and render it with `xterm.js`.

## Your Tauri architecture now becomes stronger

```txt
React UI
├── Chat panel
├── File tree
├── Markdown editor
├── Preview
├── Bob event timeline
└── Terminal panel

Rust backend
├── Workspace manager
├── BobProcessManager
│   ├── run_json()
│   ├── run_stream_json()
│   ├── run_interactive_pty()
│   ├── resume_session()
│   └── cancel_run()
├── File APIs
├── Event parser
├── SQLite persistence
└── Export service
```

## BobProcessManager should support this

```txt
runBobTask(prompt, options)
→ bob "<prompt>" -o json

runBobStream(prompt, options)
→ bob "<prompt>" -o stream-json

openBobTerminal(prompt?)
→ bob or bob -i "<prompt>" inside PTY

resumeBobSession(id | latest)
→ bob --resume latest -o stream-json
```

## Safety defaults

Do not default to `--yolo`.

For your app, default to:

```bash
--approval-mode auto_edit
```

or:

```bash
--approval-mode default
```

Use `--allowed-tools` for safe tools you trust.

Use `--max-coins` to prevent runaway sessions:

```bash
--max-coins 200
```

Use `--sandbox` where it works for your workflow.

Be careful with:

```bash
--trust
--yolo
--approval-mode yolo
--include-directories
```

Those are powerful and should be explicit user choices.

## Final read

With `--output-format stream-json`, Bob is much more suitable for your idea.

You can build a real app-native experience:

```txt
Obsidian-like local Markdown workspace
+
BobShell as an embedded coding/writing agent
+
stream-json for custom chat/tool UI
+
PTY terminal for full Bob interactive fallback
```

That is a strong architecture. You probably do **not** need Pi unless you specifically want Ollama/local-model support or Pi’s RPC protocol.