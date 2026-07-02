import { afterEach, describe, expect, it } from "vitest";

import { showErrorToast, showToast, useToastStore } from "./toastStore";

describe("toast store — duplicate coalescing", () => {
  afterEach(() => useToastStore.setState({ toasts: [] }));

  it("coalesces identical toasts into one with a bumped count", () => {
    showErrorToast("File changed on disk");
    showErrorToast("File changed on disk");
    showErrorToast("File changed on disk");
    const { toasts } = useToastStore.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].count).toBe(3);
  });

  it("keeps distinct messages as separate toasts", () => {
    showErrorToast("Error A");
    showErrorToast("Error B");
    expect(useToastStore.getState().toasts).toHaveLength(2);
  });

  it("swaps in the latest id so the viewport re-arms the dismiss timer", () => {
    const first = showToast({ kind: "info", message: "saved" });
    const second = showToast({ kind: "info", message: "saved" });
    expect(first).not.toBe(second);
    const { toasts } = useToastStore.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].id).toBe(second);
    expect(toasts[0].count).toBe(2);
  });
});
