// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => {
  const queue: string[] = [];
  const listeners = new Map<string, () => void>();
  return {
    queue,
    listeners,
    invoke: vi.fn(async (command: string) => (command === "drain_things" ? queue.splice(0) : [])),
    listen: vi.fn(async (event: string, callback: () => void) => {
      listeners.set(event, callback);
      return () => void listeners.delete(event);
    }),
  };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
vi.mock("../../lib/runtime/desktopRuntime", () => ({ isTauriRuntime: () => true }));

import { useNativeQueue } from "./useNativeQueue";

/** The native side queues an item and announces it. */
function arrive(item: string) {
  native.queue.push(item);
  native.listeners.get("thing-arrived")?.();
}

function mountWindow(handled: string[]) {
  const handle = async (item: string) => void handled.push(item);
  return renderHook(() => useNativeQueue("thing-arrived", "drain_things", handle));
}

describe("a queue the native side fills for the main window", () => {
  beforeEach(() => {
    native.queue.length = 0;
    native.listeners.clear();
    vi.clearAllMocks();
  });

  it("hands over what was queued before the window, then each arrival", async () => {
    native.queue.push("before the window");
    const handled: string[] = [];
    mountWindow(handled);
    await waitFor(() => expect(handled).toEqual(["before the window"]));

    arrive("while it is open");
    await waitFor(() => expect(handled).toEqual(["before the window", "while it is open"]));
  });

  it("does not hand a window made later what an earlier one already handled", async () => {
    const first: string[] = [];
    const earlier = mountWindow(first);
    await waitFor(() => expect(native.listeners.has("thing-arrived")).toBe(true));
    arrive("opened once");
    await waitFor(() => expect(first).toEqual(["opened once"]));
    earlier.unmount();

    const second: string[] = [];
    mountWindow(second);
    await waitFor(() => expect(native.invoke).toHaveBeenCalledTimes(3));
    expect(second).toEqual([]);
  });
});
