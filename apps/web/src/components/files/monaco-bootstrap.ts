import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

// Vite worker bundling — keeps Monaco fully offline-capable inside Electrobun.
// Without this, @monaco-editor/react tries to load workers from a CDN.
declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment;
  }
}

if (typeof window !== "undefined" && !window.MonacoEnvironment) {
  window.MonacoEnvironment = {
    getWorker(_workerId, label) {
      switch (label) {
        case "json":
          return new jsonWorker();
        case "css":
        case "scss":
        case "less":
          return new cssWorker();
        case "html":
        case "handlebars":
        case "razor":
          return new htmlWorker();
        case "typescript":
        case "javascript":
          return new tsWorker();
        default:
          return new editorWorker();
      }
    },
  };
  // Use the bundled monaco — don't hit a CDN.
  loader.config({ monaco });

  const fastDiagnostics = {
    noSemanticValidation: true,
    noSyntaxValidation: true,
  };
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(
    fastDiagnostics,
  );
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(
    fastDiagnostics,
  );
  monaco.languages.typescript.typescriptDefaults.setEagerModelSync(false);
  monaco.languages.typescript.javascriptDefaults.setEagerModelSync(false);
}

if (
  typeof window !== "undefined" &&
  !monaco.languages.getLanguages().some((language) => language.id === "diff")
) {
  monaco.languages.register({ id: "diff" });
  monaco.languages.setMonarchTokensProvider("diff", {
    tokenizer: {
      root: [
        [/^diff --git.*$/, "diff.header"],
        [/^index .*$/, "diff.meta"],
        [/^@@.*@@/, "diff.range"],
        [/^\+\+\+.*$/, "diff.meta"],
        [/^---.*$/, "diff.meta"],
        [/^\+.*/, "diff.inserted"],
        [/^-.*/, "diff.deleted"],
      ],
    },
  });
}

export { monaco };
