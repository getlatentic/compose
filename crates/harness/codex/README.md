# harness-codex

The **OpenAI Codex** (`codex`) adapter for [`agent-harness`](../../agent-harness).
Invokes `codex exec --json` and parses its JSONL into the normalized
`RunEvent` vocabulary.

- `CodexHarness` — the `Harness` implementation.
- `parse_codex_line` — the `--json` decoder: the assistant reply arrives
  as a single `agent_message` on `item.completed`; tool items
  (`command_execution`, `file_change`, `web_search`, `mcp_tool_call`)
  become structured tool cards.

Codex manages its own credentials (`codex login` / ChatGPT auth or
`OPENAI_API_KEY`), so `credential().required` is `false` and the adapter
supports an interactive `login()` (`codex login`). It exposes reasoning
effort (`-c model_reasoning_effort`) and free-text model selection. It
needs no `bob-rs` — only `agent-harness`.

## License

Licensed under either of MIT or Apache-2.0 at your option.
