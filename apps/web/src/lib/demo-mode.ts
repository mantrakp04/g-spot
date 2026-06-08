import { useEffect, useSyncExternalStore } from "react";

export const DEMO_ROTATION_INTERVAL_MS = 10_000;
const DEMO_INTERACTION_IDLE_MS = 12_000;

const listeners = new Set<() => void>();
let interacting = false;
let idleTimeoutId: number | null = null;
let interactionListenerCount = 0;

const demoInteractionEvents = [
  "focusin",
  "keydown",
  "pointerdown",
  "pointermove",
  "touchmove",
  "wheel",
] as const;

const demoInteractionOptions = { capture: true, passive: true } as const;

function emitDemoInteractionChange() {
  for (const listener of listeners) {
    listener();
  }
}

function setDemoInteracting(next: boolean) {
  if (interacting === next) return;
  interacting = next;
  emitDemoInteractionChange();
}

function markDemoInteraction() {
  setDemoInteracting(true);
  if (idleTimeoutId !== null) {
    window.clearTimeout(idleTimeoutId);
  }
  idleTimeoutId = window.setTimeout(() => {
    idleTimeoutId = null;
    setDemoInteracting(false);
  }, DEMO_INTERACTION_IDLE_MS);
}

function subscribeToDemoInteraction(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getDemoInteractionSnapshot() {
  return interacting;
}

export function isEmbeddedFrame(): boolean {
  if (typeof window === "undefined") return false;

  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function useDemoInteractionPause(): boolean {
  useEffect(() => {
    if (!isEmbeddedFrame()) return;

    interactionListenerCount += 1;
    if (interactionListenerCount === 1) {
      for (const eventName of demoInteractionEvents) {
        window.addEventListener(eventName, markDemoInteraction, demoInteractionOptions);
      }
    }

    return () => {
      interactionListenerCount = Math.max(0, interactionListenerCount - 1);
      if (interactionListenerCount > 0) return;

      for (const eventName of demoInteractionEvents) {
        window.removeEventListener(eventName, markDemoInteraction, demoInteractionOptions);
      }
      if (idleTimeoutId !== null) {
        window.clearTimeout(idleTimeoutId);
        idleTimeoutId = null;
      }
      setDemoInteracting(false);
    };
  }, []);

  return useSyncExternalStore(
    subscribeToDemoInteraction,
    getDemoInteractionSnapshot,
    () => false,
  );
}
