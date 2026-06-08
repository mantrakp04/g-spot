type FocusHandler = () => void;

const handlers = new Map<string, FocusHandler>();

export function registerSurfaceFocus(tabId: string | undefined, handler: FocusHandler) {
  if (!tabId) return () => {};
  handlers.set(tabId, handler);
  return () => {
    if (handlers.get(tabId) === handler) {
      handlers.delete(tabId);
    }
  };
}

export function focusSurface(tabId: string | undefined | null) {
  if (!tabId) return;
  const handler = handlers.get(tabId);
  if (!handler) return;
  window.requestAnimationFrame(handler);
}
