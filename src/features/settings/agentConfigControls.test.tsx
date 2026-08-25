// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const status = vi.fn(async () => ({ configured: false }));
const setCredential = vi.fn(async () => {});
vi.mock("../../lib/ipc/harnessClient", () => ({
  harnessCredentialStatus: (...args: unknown[]) => status(...(args as [])),
  harnessSetCredential: (...args: unknown[]) => setCredential(...(args as [])),
}));

import { HarnessCredentialForm } from "./agentConfigControls";

/**
 * The API key form's RESTING states — what someone sees when they are not
 * mid-action. A saved key used to look identical to an empty one: the success
 * banner cleared itself after four seconds and left helper text phrased as an
 * instruction ("Paste a new one to replace it"), so the screen never said the
 * key was there.
 */
describe("HarnessCredentialForm", () => {
  beforeEach(() => {
    status.mockReset().mockResolvedValue({ configured: false });
    setCredential.mockReset().mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  it("says a key is saved, rather than only implying it", async () => {
    status.mockResolvedValue({ configured: true });
    render(<HarnessCredentialForm harnessId="openrouter" name="OpenRouter" />);
    expect(await screen.findByText(/a key is saved/i)).toBeTruthy();
  });

  it("offers no save until something is typed", async () => {
    render(<HarnessCredentialForm harnessId="openrouter" name="OpenRouter" />);
    const save = await screen.findByRole("button", { name: /save key/i });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    await userEvent.type(screen.getByLabelText(/openrouter api key/i), "k");
    expect((save as HTMLButtonElement).disabled).toBe(false);
  });

  it("never submits an empty value, which would clear the stored key", async () => {
    status.mockResolvedValue({ configured: true });
    render(<HarnessCredentialForm harnessId="openrouter" name="OpenRouter" />);
    const replace = await screen.findByRole("button", { name: /replace key/i });

    // The footgun: this button was enabled with an empty field, and submitting
    // it stored "" — which deletes the key, reporting success either way.
    expect((replace as HTMLButtonElement).disabled).toBe(true);
    expect(setCredential).not.toHaveBeenCalled();
  });

  it("makes removing a key a separate, deliberate action", async () => {
    status.mockResolvedValue({ configured: true });
    render(<HarnessCredentialForm harnessId="openrouter" name="OpenRouter" />);
    const remove = await screen.findByRole("button", { name: /remove key/i });

    await userEvent.click(remove);
    await waitFor(() => expect(setCredential).toHaveBeenCalledWith("openrouter", ""));
  });

  it("shows no remove action when there is nothing to remove", async () => {
    render(<HarnessCredentialForm harnessId="openrouter" name="OpenRouter" />);
    await screen.findByRole("button", { name: /save key/i });
    expect(screen.queryByRole("button", { name: /remove key/i })).toBeNull();
  });
});
