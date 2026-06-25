import { Toggle } from "@carbon/react";

import { useHarnessStore } from "../../app/store/harnessStore";

/**
 * The global agent permission settings: file-edit permission + review mode. They
 * write the global, sticky store values the run pipeline reads, so the same
 * choice carries across whichever agent you pick in the footer.
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
