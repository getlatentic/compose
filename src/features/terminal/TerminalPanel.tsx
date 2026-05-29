export function TerminalPanel({ workspacePath }: { workspacePath: string }) {
  return (
    <div className="h-[calc(100%-2.5rem)] overflow-auto p-3 font-mono text-xs leading-5">
      <div className="text-[#b8b09f]">workspace</div>
      <div className="mt-1 text-[#f7f0df]">{workspacePath}</div>
      <div className="mt-4 text-[#b8b09f]">planned command</div>
      <div className="mt-1 text-[#d6f0c2]">bob -i "Start by reviewing this workspace"</div>
    </div>
  );
}
