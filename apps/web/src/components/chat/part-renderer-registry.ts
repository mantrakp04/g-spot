import type { ReactNode } from "react";

import type { UIMessagePart } from "@/lib/chat-ui";

export type PartRenderContext = {
  /** Stable key for things like file dialogs, accordions. */
  id: string;
  accordionId: string;
  isActive: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When true, text parts use the streaming-friendly incremental renderer. */
  incrementalTextParts: boolean;
  /** When false, reasoning + tool parts return null. */
  renderAuxiliaryParts: boolean;
};

export type PartRenderer<P extends UIMessagePart = UIMessagePart> = (
  part: P,
  ctx: PartRenderContext,
) => ReactNode;

type RegistryEntry = {
  match: (part: UIMessagePart) => boolean;
  render: PartRenderer;
};

const registry: RegistryEntry[] = [];

/**
 * Register a renderer for parts matching `match`. First registered match wins,
 * so register specific predicates before fallbacks.
 */
export function registerPartRenderer<P extends UIMessagePart>(
  match: (part: UIMessagePart) => part is P,
  render: PartRenderer<P>,
): void;
export function registerPartRenderer(
  match: (part: UIMessagePart) => boolean,
  render: PartRenderer,
): void;
export function registerPartRenderer(
  match: (part: UIMessagePart) => boolean,
  render: PartRenderer,
) {
  registry.push({ match, render });
}

export function renderPart(
  part: UIMessagePart,
  ctx: PartRenderContext,
): ReactNode {
  for (const entry of registry) {
    if (entry.match(part)) return entry.render(part, ctx);
  }
  return null;
}
