import { TextArea, Toggle } from "@carbon/react";

import { useHarnessStore } from "../../app/store/harnessStore";

/** Cap on the global custom instructions (~500 tokens) so they can't crowd out
 *  the workspace context in a small local model's window. */
const MAX_CUSTOM_INSTRUCTIONS_CHARS = 2000;

/**
 * Settings that apply to every agent, not one in particular: file-edit
 * permission + review mode, and the shared custom instructions. They write the
 * global, sticky store values the run pipeline reads, so the same choice carries
 * across whichever agent you pick in the footer.
 *
 * The two file-access toggles are distinct: the first is *permission* (may an
 * agent change files at all), the second is *workflow* (how an allowed edit
 * lands) — and the second only shows when editing is on.
 */
export function FileAccessSection() {
  const allowEdits = useHarnessStore((state) => state.allowEdits);
  const setAllowEdits = useHarnessStore((state) => state.setAllowEdits);
  const reviewEdits = useHarnessStore((state) => state.reviewEdits);
  const setReviewEdits = useHarnessStore((state) => state.setReviewEdits);

  return (
    <div className="settings-section">
      <h3>File access</h3>
      <p className="settings-helper">What agents can do with files — only inside your workspace folder.</p>
      <Toggle
        id="agents-allow-edits"
        size="sm"
        labelText="Let agents change files"
        labelA="Read & suggest only"
        labelB="Can create, edit & delete"
        toggled={allowEdits}
        onToggle={(checked) => setAllowEdits(checked)}
      />
      {allowEdits ? (
        <div className="settings-subsetting">
          <Toggle
            id="agents-review-edits"
            size="sm"
            labelText="How edits are applied"
            labelA="Apply directly — undo anytime"
            labelB="Show me each change to approve first"
            toggled={reviewEdits}
            onToggle={(checked) => setReviewEdits(checked)}
          />
        </div>
      ) : null}
    </div>
  );
}

export function CustomInstructionsSection() {
  const customInstructions = useHarnessStore((state) => state.customInstructions);
  const setCustomInstructions = useHarnessStore((state) => state.setCustomInstructions);

  return (
    <div className="settings-section">
      <TextArea
        id="global-custom-instructions"
        labelText="Custom instructions"
        helperText="Added to every agent's system prompt, where supported."
        placeholder="e.g. Answer in British English; keep summaries to 3 bullets."
        rows={3}
        enableCounter
        maxCount={MAX_CUSTOM_INSTRUCTIONS_CHARS}
        value={customInstructions}
        onChange={(event) => setCustomInstructions(event.target.value)}
      />
    </div>
  );
}
