# harness-bob

The **bob** adapter for [`agent-harness`](../../agent-harness): implements the
`Harness` trait over the [`bob-rs`](../../bob-rs) SDK and parses
bob's `--output-format stream-json` stdout into the normalized
`RunEvent` vocabulary.

- `BobHarness` — the `Harness` implementation (readiness, install, run,
  credential). bob's API key is stored by the host (via `bob-rs`), so
  `credential().required` is `true`.
- `parse_bob_line` / `BobStreamParser` — bob's wire-format decoder.
  Reasoning streamed inline as `<thinking>…</thinking>` is routed to the
  `Thinking` stream; the final answer (delivered via the
  `attempt_completion` tool) becomes assistant text.
- `normalize_bob_event` — convenience over `agent_harness::normalize_process_event`.

```rust
use agent_harness::Harness;
use harness_bob::BobHarness;

let harness = BobHarness::new();
let info = harness.info(); // id == harness_bob::BOB_HARNESS_ID
```

## License

Licensed under either of MIT or Apache-2.0 at your option.
