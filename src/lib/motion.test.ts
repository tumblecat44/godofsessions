// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { transitionState, updateStateWithoutTransition } from "./motion";

const originalStartViewTransition = document.startViewTransition;

afterEach(() => {
  Object.defineProperty(document, "startViewTransition", {
    configurable: true,
    value: originalStartViewTransition,
  });
});

describe("transitionState", () => {
  it("never loses a nested state update while another transition is active", () => {
    let capturedUpdate: (() => void) | undefined;
    const updateOrder: string[] = [];
    const skipTransition = vi.fn();
    const firstUpdate = vi.fn(() => updateOrder.push("first"));
    const nestedUpdate = vi.fn(() => updateOrder.push("nested"));
    const transition = {
      ready: Promise.resolve(),
      updateCallbackDone: Promise.resolve(),
      finished: new Promise<void>(() => undefined),
      skipTransition,
    } as unknown as ViewTransition;

    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn((update: () => void) => {
        capturedUpdate = update;
        return transition;
      }),
    });

    transitionState(firstUpdate);
    transitionState(nestedUpdate);

    expect(skipTransition).toHaveBeenCalledOnce();
    expect(firstUpdate).toHaveBeenCalledOnce();
    expect(nestedUpdate).toHaveBeenCalledOnce();
    expect(updateOrder).toEqual(["first", "nested"]);
    capturedUpdate?.();
    expect(firstUpdate).toHaveBeenCalledOnce();
  });

  it("settles an older transition before applying a newer non-animated update", () => {
    let capturedUpdate: (() => void) | undefined;
    let value = "initial";
    const skipTransition = vi.fn();
    const transition = {
      ready: Promise.resolve(),
      updateCallbackDone: Promise.resolve(),
      finished: new Promise<void>(() => undefined),
      skipTransition,
    } as unknown as ViewTransition;

    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn((update: () => void) => {
        capturedUpdate = update;
        return transition;
      }),
    });

    transitionState(() => { value = "old transition"; });
    updateStateWithoutTransition(() => { value = "latest event"; });

    expect(skipTransition).toHaveBeenCalledOnce();
    expect(value).toBe("latest event");
    capturedUpdate?.();
    expect(value).toBe("latest event");
  });

  it("observes the ready rejection when a transition is skipped before it is ready", async () => {
    let rejectReady: ((reason?: unknown) => void) | undefined;
    const ready = new Promise<void>((_resolve, reject) => {
      rejectReady = reject;
    });
    const readyCatch = vi.spyOn(ready, "catch");
    const transition = {
      ready,
      updateCallbackDone: new Promise<void>(() => undefined),
      finished: new Promise<void>(() => undefined),
      skipTransition: vi.fn(() => {
        rejectReady?.(new DOMException("Transition was skipped", "AbortError"));
      }),
    } as unknown as ViewTransition;

    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn(() => transition),
    });

    transitionState(() => undefined);
    updateStateWithoutTransition(() => undefined);

    expect(transition.skipTransition).toHaveBeenCalledOnce();
    expect(readyCatch).toHaveBeenCalledOnce();
    await expect(ready).rejects.toMatchObject({
      name: "AbortError",
      message: "Transition was skipped",
    });
  });

  it("propagates a non-abort ready rejection", async () => {
    let rejectReady: ((reason?: unknown) => void) | undefined;
    const ready = new Promise<void>((_resolve, reject) => {
      rejectReady = reject;
    });
    const readyCatch = vi.spyOn(ready, "catch");
    const transition = {
      ready,
      updateCallbackDone: new Promise<void>(() => undefined),
      finished: new Promise<void>(() => undefined),
      skipTransition: vi.fn(),
    } as unknown as ViewTransition;

    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn(() => transition),
    });

    transitionState(() => undefined);
    expect(readyCatch).toHaveBeenCalledOnce();

    // Rejection is re-thrown asynchronously - verify the catch handler is registered
    const catchHandler = readyCatch.mock.calls[0][0] as (error: unknown) => void;
    const nonAbortError = new DOMException("test", "InvalidStateError");

    // Non-abort errors are re-thrown (unlike AbortError which is swallowed)
    expect(() => catchHandler(nonAbortError)).toThrow(nonAbortError);
  });
});
