// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createValueStore } from "./valueStore";

describe("createValueStore", () => {
  it("re-renders readers when the value changes, and not when it is set to the same value", () => {
    const store = createValueStore(1);
    const listener = vi.fn();
    store.subscribe(listener);
    const { result } = renderHook(() => store.use());
    act(() => store.set(2));
    expect(result.current).toBe(2);
    act(() => store.set(2));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
