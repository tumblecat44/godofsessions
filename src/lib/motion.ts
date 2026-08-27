import { flushSync } from "react-dom";

type TransitionStarter = (update: () => void) => ViewTransition;

interface ActiveTransition {
  transition: ViewTransition;
  applyUpdate(): void;
}

let activeTransition: ActiveTransition | undefined;

/**
 * Applies a non-animated update after first settling any older transition
 * callback, so that callback cannot later overwrite newer external state.
 */
export function updateStateWithoutTransition(update: () => void) {
  const previousTransition = activeTransition;
  if (!previousTransition) {
    update();
    return;
  }

  previousTransition.transition.skipTransition();
  previousTransition.applyUpdate();
  if (activeTransition === previousTransition) activeTransition = undefined;
  flushSync(update);
}

/**
 * Keeps state changes synchronous while Chromium snapshots the old and new UI.
 * Unsupported browsers and reduced-motion users get the state change directly.
 */
export function transitionState(update: () => void) {
  const reduceMotion = typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const startViewTransition = (document as unknown as { startViewTransition?: TransitionStarter }).startViewTransition;

  if (reduceMotion || !startViewTransition) {
    update();
    return;
  }

  if (activeTransition) {
    updateStateWithoutTransition(update);
    return;
  }

  let updateApplied = false;
  const applyUpdate = () => {
    if (updateApplied) return;
    updateApplied = true;
    flushSync(update);
  };

  try {
    const transition = startViewTransition.call(document, applyUpdate);
    void transition.ready?.catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      throw error;
    });
    const currentTransition = { transition, applyUpdate };
    activeTransition = currentTransition;
    const clearTransition = () => {
      if (activeTransition === currentTransition) activeTransition = undefined;
    };
    void transition.finished.then(clearTransition, clearTransition);
  } catch {
    applyUpdate();
  }
}
