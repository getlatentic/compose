import { TextArea, Toggle } from "@carbon/react";

import { useHarnessStore } from "../../app/store/harnessStore";

/** Cap on the global custom instructions (~500 tokens) so they can't crowd out
 *  the workspace context in a small local model's window. */
const MAX_CUSTOM_INSTRUCTIONS_CHARS = 2000;

/**
 * Settings that apply to every agent, not one in particular: file-edit
 * permission + review mode, and the shared custom instructions. They live with
 * the agent list (above the per-agent detail) and write the global, sticky store
 * values the run pipeline reads — so the same choice carries across whichever
 * agent you pick in the footer.
 */
export function FileAccessSection() {
  const allowEdits = useHarnessStore((state) => state.allowEdits);
  const setAllowEdits = useHarnessStore((state) => state.setAllowEdits);
  const reviewEdits = useHarnessStore((state) => state.reviewEdits);
  const setReviewEdits = useHarnessStore((state) => state.setReviewEdits);

  return (
    <div className="settings-section">
      <h3>File access</h3>
      <p className="settings-helper">
        Applies to every agent — and only inside your workspace folder.
      </p>
      <Toggle
        id="agents-allow-edits"
        size="sm"
        labelText="Let the AI edit files"
        labelA="Read & suggest only"
        labelB="Can edit my files"
        toggled={allowEdits}
        onToggle={(checked) => setAllowEdits(checked)}
      />
      {allowEdits ? (
        <Toggle
          id="agents-review-edits"
          size="sm"
          labelText="Review changes before applying"
          labelA="Off — apply directly (undo anytime)"
          labelB="On — approve a copy first"
          toggled={reviewEdits}
          onToggle={(checked) => setReviewEdits(checked)}
        />
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
        helperText="Added to every agent's system prompt where supported — a persona, house style, or rules to always follow. Keep it short so it leaves room for your files on small local models."
        placeholder="e.g. Answer in British English and keep summaries to 3 bullet points."
        rows={3}
        enableCounter
        maxCount={MAX_CUSTOM_INSTRUCTIONS_CHARS}
        value={customInstructions}
        onChange={(event) => setCustomInstructions(event.target.value)}
      />
    </div>
  );
}
