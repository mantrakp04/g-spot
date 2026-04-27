import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";

import { knownNoteTitlesFacet } from "./wikilinks";

/**
 * Triggered by `[[` — suggests note titles from the known-titles facet. The
 * inserted text is just the title; no closing `]]` is added so users can
 * keep typing or close manually (matches Obsidian's behavior with auto-pair
 * disabled).
 */
function wikilinkSource(context: CompletionContext): CompletionResult | null {
  const before = context.state.sliceDoc(
    Math.max(0, context.pos - 200),
    context.pos,
  );
  const m = /\[\[([^\[\]\n|]*)$/.exec(before);
  if (!m) return null;
  const titles = context.state.facet(knownNoteTitlesFacet);
  const query = m[1].toLowerCase();
  const options = Array.from(titles)
    .filter((t) => t.toLowerCase().includes(query))
    .slice(0, 50)
    .map((title) => ({ label: title, type: "text" }));
  return {
    from: context.pos - m[1].length,
    to: context.pos,
    options,
    validFor: /^[^\[\]\n|]*$/,
  };
}

export const noteAutocompletion = autocompletion({
  override: [wikilinkSource],
  closeOnBlur: true,
  activateOnTyping: true,
});
