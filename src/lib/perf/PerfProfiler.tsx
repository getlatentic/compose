import { Profiler, type ReactNode } from "react";

import { bootMarks } from "./index";

/**
 * React's own profiler around a region, reporting what its first mount cost.
 *
 * Timing marks say when a component's render body ran; they cannot say how long
 * its subtree took, because the work interleaves. `actualDuration` can. Needs
 * the profiling build of react-dom, which `vite.config.ts` aliases in only for
 * `COMPOSE_PERF` builds — a release build renders `children` and nothing else.
 */
export function PerfProfiler({ id, children }: { id: string; children: ReactNode }) {
  if (!__COMPOSE_PERF__) {
    return <>{children}</>;
  }
  return (
    <Profiler
      id={id}
      onRender={(profilerId, phase, actualDuration, _base, startTime, commitTime) => {
        if (phase === "mount") {
          bootMarks.push(
            `profile ${profilerId}: render ${actualDuration.toFixed(1)}ms, start ${startTime.toFixed(0)} → commit ${commitTime.toFixed(0)} (${(commitTime - startTime).toFixed(0)}ms wall)`,
          );
        }
      }}
    >
      {children}
    </Profiler>
  );
}
