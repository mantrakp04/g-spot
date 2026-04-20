import { describe, expect, it } from "vitest";

import {
  getScopedSyncResumeState,
  resolveSyncStartPlan,
  threadHasInboxLabel,
} from "../gmail-sync";

describe("resolveSyncStartPlan", () => {
  it("resumes paused syncs when auto is used", () => {
    const plan = resolveSyncStartPlan("auto", {
      account: {
        lastFullSyncAt: null,
        lastIncrementalSyncAt: null,
        needsFullResync: false,
      },
      syncState: {
        failedThreads: 1,
        fetchedThreads: 4,
        mode: "full",
        processableThreads: 4,
        processedThreads: 3,
        status: "paused",
        totalThreads: 12,
      },
    });

    expect(plan).toMatchObject({
      mode: "full",
      scopeStrategy: "full",
      updatesAccountCheckpoint: true,
      bootstrapProgress: {
        totalThreads: 12,
        fetchedThreads: 4,
        processableThreads: 4,
        processedThreads: 3,
        failedThreads: 1,
      },
    });
  });

  it("does not treat a seeded history id like a completed sync", () => {
    const plan = resolveSyncStartPlan("auto", {
      account: {
        lastFullSyncAt: null,
        lastIncrementalSyncAt: null,
        needsFullResync: false,
      },
      syncState: null,
    });

    expect(plan.mode).toBe("full");
    expect(plan.scopeStrategy).toBe("full");
  });

  it("uses incremental sync after a successful sync", () => {
    const plan = resolveSyncStartPlan("auto", {
      account: {
        lastFullSyncAt: "2026-04-16T00:00:00.000Z",
        lastIncrementalSyncAt: null,
        needsFullResync: false,
      },
      syncState: null,
    });

    expect(plan.mode).toBe("incremental");
    expect(plan.scopeStrategy).toBe("incremental");
  });

  it("keeps retry_failed focused on unresolved failures once the sync is no longer paused", () => {
    const plan = resolveSyncStartPlan("retry_failed", {
      account: {
        lastFullSyncAt: "2026-04-16T00:00:00.000Z",
        lastIncrementalSyncAt: null,
        needsFullResync: false,
      },
      syncState: {
        failedThreads: 3,
        fetchedThreads: 12,
        mode: "full",
        processableThreads: 12,
        processedThreads: 9,
        status: "completed",
        totalThreads: 12,
      },
    });

    expect(plan).toMatchObject({
      mode: "full",
      scopeStrategy: "failed_only",
      updatesAccountCheckpoint: false,
      bootstrapProgress: {
        totalThreads: 3,
        fetchedThreads: 0,
        processableThreads: 0,
        processedThreads: 0,
        failedThreads: 3,
      },
    });
  });
});

describe("getScopedSyncResumeState", () => {
  it("only counts fetched inbox threads inside the current sync scope", () => {
    const state = getScopedSyncResumeState(
      ["thread-2", "thread-3", "thread-4"],
      new Set(["thread-1", "thread-2", "thread-3"]),
      new Set(["thread-2", "thread-3"]),
      ["thread-3", "thread-9"],
    );

    expect(state.totalThreads).toBe(3);
    expect(state.fetchedInScope.size).toBe(2);
    expect(state.processableThreads).toBe(2);
    expect(state.processedThreads).toBe(1);
    expect(state.unprocessedInScope).toEqual(["thread-3"]);
    expect(state.toFetch).toEqual(["thread-4"]);
  });

  it("treats non-inbox fetched threads as outside the process universe", () => {
    const state = getScopedSyncResumeState(
      ["thread-1", "thread-2", "thread-3"],
      new Set(["thread-1", "thread-2", "thread-3"]),
      new Set(["thread-2"]),
      [],
    );

    expect(state.fetchedInScope.size).toBe(3);
    expect(state.processableThreads).toBe(1);
    expect(state.processedThreads).toBe(1);
    expect(state.toFetch).toEqual([]);
  });

  it("does not let out-of-scope unprocessed threads drive processed negative", () => {
    const state = getScopedSyncResumeState(
      ["thread-7"],
      new Set(),
      new Set(),
      ["thread-2", "thread-3"],
    );

    expect(state.fetchedInScope.size).toBe(0);
    expect(state.processableThreads).toBe(0);
    expect(state.processedThreads).toBe(0);
    expect(state.unprocessedInScope).toEqual([]);
    expect(state.toFetch).toEqual(["thread-7"]);
  });
});

describe("threadHasInboxLabel", () => {
  it("only treats inbox-labeled threads as extractable", () => {
    expect(threadHasInboxLabel(["INBOX", "UNREAD"])).toBe(true);
    expect(threadHasInboxLabel(["CATEGORY_UPDATES", "UNREAD"])).toBe(false);
  });
});
