import { UnifiedDiff } from "./UnifiedDiff";

/**
 * A file change shown as a collapsible unified diff — or, when the content is
 * binary or too large to inline, a size-only note. The shared preview body for
 * both the review list (accept/reject) and the applied-changes list
 * (informational), so the two surfaces render diffs identically.
 */
export function ChangePreview({
  after,
  before,
  omittedLabel,
  omittedSize,
  previewOmitted,
}: {
  after: string;
  before: string;
  omittedLabel: string;
  omittedSize: number;
  previewOmitted: boolean;
}) {
  if (previewOmitted) {
    return (
      <div className="diff diff--omitted">
        {omittedLabel} · {formatBytes(omittedSize)} · preview not shown
      </div>
    );
  }
  return <UnifiedDiff before={before} after={after} />;
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} bytes`;
  }
  return `${Math.round(size / 1024)} KB`;
}
