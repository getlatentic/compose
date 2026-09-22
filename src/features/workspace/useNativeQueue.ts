import { useEffect, useRef } from "react";

import { isTauriRuntime } from "../../lib/runtime/desktopRuntime";

/**
 * Hand `handle` each item the native side queued for the main window: those
 * queued before the window mounted, then each one its event announces. Only the
 * queue is read, so an item is handled once however many main windows come and
 * go — the window can be closed and made again while Compose keeps running.
 * Listening before the first drain leaves no gap between the two.
 */
export function useNativeQueue(event: string, drainCommand: string, handle: (item: string) => Promise<void>): void {
  const latest = useRef(handle);
  latest.current = handle;

  useEffect(
    function bindNativeQueue() {
      if (!isTauriRuntime()) return;
      let unlisten: (() => void) | null = null;
      let disposed = false;
      let draining: Promise<void> = Promise.resolve();

      const drain = () => {
        draining = draining
          .then(async () => {
            if (disposed) return;
            const { invoke } = await import("@tauri-apps/api/core");
            for (const item of await invoke<string[]>(drainCommand)) {
              if (disposed) return;
              await latest.current(item);
            }
          })
          .catch((error: unknown) => console.error(`Failed to drain ${drainCommand}:`, error));
      };

      void (async () => {
        const { listen } = await import("@tauri-apps/api/event");
        if (disposed) return;
        const stop = await listen(event, drain);
        if (disposed) {
          stop();
          return;
        }
        unlisten = stop;
        drain();
      })();

      return function unbind() {
        disposed = true;
        unlisten?.();
      };
    },
    [event, drainCommand],
  );
}
