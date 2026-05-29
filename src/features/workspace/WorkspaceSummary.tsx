export function WorkspaceSummary({ lastSavedAt }: { lastSavedAt: Date | null }) {
  return (
    <div className="h-[5.5rem] border-b border-line p-3">
      <div className="text-xs font-medium uppercase tracking-[0.08em] text-muted">Workspace</div>
      <div className="mt-2 truncate text-sm font-semibold">~/Documents/Bob Workspace</div>
      <div className="mt-1 text-xs text-muted">
        {lastSavedAt ? `Saved ${lastSavedAt.toLocaleTimeString()}` : "No local save yet"}
      </div>
    </div>
  );
}
