# harness-claude

The **Claude Code** (`claude`) adapter for [`harness-core`](../core).
Invokes `claude -p` in headless `stream-json` mode and parses its NDJSON
into the normalized `RunEvent` vocabulary, so a host treats Claude Code
exactly like any other harness.

- `ClaudeHarness` — the `Harness` implementation.
- `parse_claude_line` — the stream-json decoder (text deltas, thinking
  deltas, `tool_use` start / `tool_result` end, retry activity).

Claude Code manages its own credentials (its OAuth login or
`ANTHROPIC_API_KEY` in the environment), so `credential().required` is
`false` and the adapter supports an interactive `login()` (`claude auth
login`). It needs no `bob-core` — only `harness-core`.

## License

Licensed under either of MIT or Apache-2.0 at your option.
