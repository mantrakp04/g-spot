import WorkerUrl from "@pierre/diffs/worker/worker.js?worker&url";

export function pierreWorkerFactory(): Worker {
  return new Worker(WorkerUrl, { type: "module" });
}
