// @vitest-environment jsdom
//
// The transcript reserves room for the floating composer with a real end
// spacer sized to the composer's live height, and re-pins to bottom when that
// height changes — so the last turn always scrolls clear of the composer (the
// "last message hides under the composer" bug). Mounted with react-dom/client
// + React's `act` (no RTL dep), like the editor integration test.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { WorkspaceChatMessage } from "../../app/workspaceModel";
import { ChatMessageList } from "./ChatMessageList";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function message(id: string, role: "user" | "assistant", content: string): WorkspaceChatMessage {
  return { id, role, content, activity: null };
}

const noop = () => {};
const callbacks = { onAccept: noop, onOpenDocument: noop, onReject: noop, onRegenerate: noop };

function render(props: { composerHeight: number; messages: WorkspaceChatMessage[] }): void {
  act(() => {
    root.render(
      <ChatMessageList
        callbacks={callbacks}
        composerHeight={props.composerHeight}
        contextFileLabel={null}
        messages={props.messages}
        onUseSuggestion={noop}
        runState="idle"
      />,
    );
  });
}

function spacer(): HTMLElement | null {
  return container.querySelector(".chat-messages__composer-spacer");
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("ChatMessageList", () => {
  it("renders an end spacer sized to the live composer height", () => {
    render({ composerHeight: 180, messages: [message("u1", "user", "hi")] });
    expect(spacer()?.style.blockSize).toBe("180px");
  });

  it("resizes the spacer when the composer height changes", () => {
    render({ composerHeight: 120, messages: [message("u1", "user", "hi")] });
    expect(spacer()?.style.blockSize).toBe("120px");
    render({ composerHeight: 240, messages: [message("u1", "user", "hi")] });
    expect(spacer()?.style.blockSize).toBe("240px");
  });

  it("omits the spacer in the empty state (nothing to scroll clear of)", () => {
    render({ composerHeight: 144, messages: [] });
    expect(spacer()).toBeNull();
  });

  /** jsdom doesn't lay out, so drive the geometry the effects read. */
  function geometry(scroller: HTMLElement, scrollHeight: number, clientHeight: number) {
    Object.defineProperty(scroller, "scrollHeight", { value: scrollHeight, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: clientHeight, configurable: true });
  }

  it("pins the transcript to the bottom after the composer height changes", () => {
    const messages = [message("u1", "user", "hi"), message("a1", "assistant", "hello")];
    render({ composerHeight: 100, messages });
    const scroller = container.querySelector<HTMLElement>(".chat-messages")!;
    geometry(scroller, 900, 400);
    // At the bottom → following, so a composer resize must re-pin (regression:
    // scroll fired before the reserved space updated, leaving the last turn
    // under the composer).
    scroller.scrollTop = 500;
    render({ composerHeight: 260, messages });
    expect(scroller.scrollTop).toBe(900);
  });

  it("leaves the scroll alone when the reader has scrolled up", () => {
    // The reported bug: scrolling up to re-read something was undone by the
    // next delta. A reasoning model emits its answer in one lump, so the yank
    // was a whole message tall.
    const messages = [message("u1", "user", "hi"), message("a1", "assistant", "hello")];
    render({ composerHeight: 100, messages });
    const scroller = container.querySelector<HTMLElement>(".chat-messages")!;
    geometry(scroller, 900, 400);
    scroller.scrollTop = 0; // scrolled right up to read the start

    render({
      composerHeight: 100,
      messages: [...messages, message("a2", "assistant", "another turn")],
    });

    expect(scroller.scrollTop).toBe(0);
  });

  it("resumes following once the reader returns to the bottom", () => {
    const messages = [message("u1", "user", "hi")];
    render({ composerHeight: 100, messages });
    const scroller = container.querySelector<HTMLElement>(".chat-messages")!;
    geometry(scroller, 900, 400);

    scroller.scrollTop = 0;
    render({ composerHeight: 100, messages: [...messages, message("a1", "assistant", "one")] });
    expect(scroller.scrollTop).toBe(0);

    // Back to the bottom — following again.
    scroller.scrollTop = 500;
    render({
      composerHeight: 100,
      messages: [...messages, message("a1", "assistant", "one"), message("a2", "assistant", "two")],
    });
    expect(scroller.scrollTop).toBe(900);
  });
});
