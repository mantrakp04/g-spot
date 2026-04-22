import type { ReactNode } from "react";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";

import { pierreWorkerFactory } from "@/lib/pierre-worker";

export function DiffsProvider({ children }: { children: ReactNode }) {
  return (
    <WorkerPoolContextProvider
      poolOptions={{ workerFactory: pierreWorkerFactory }}
      highlighterOptions={{
        theme: { dark: "pierre-dark", light: "pierre-light" },
        langs: [
          "typescript",
          "tsx",
          "javascript",
          "jsx",
          "json",
          "css",
          "html",
          "markdown",
          "python",
          "go",
          "rust",
          "shell",
          "yaml",
          "sql",
        ],
      }}
    >
      {children}
    </WorkerPoolContextProvider>
  );
}
