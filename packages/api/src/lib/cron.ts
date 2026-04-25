type CronHandler = () => void | Promise<void>;

type BunCronLike = {
  cron?: {
    parse?: (cron: string, base: number) => number | Date | null | undefined;
  };
};

export interface ManagedCronJob {
  cron: string;
  ref(): ManagedCronJob;
  stop(): ManagedCronJob;
  unref(): ManagedCronJob;
}

function parseSimpleCron(cron: string, base: number): number | null {
  if (cron === "@hourly" || cron === "0 * * * *") {
    const next = new Date(base);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next.getTime();
  }

  if (cron === "@daily" || cron === "0 0 * * *") {
    const next = new Date(base);
    next.setHours(0, 0, 0, 0);
    next.setDate(next.getDate() + 1);
    return next.getTime();
  }

  const everyMinutes = cron.match(/^\*\/(\d+) \* \* \* \*$/);
  if (everyMinutes) {
    const minutes = Number(everyMinutes[1]);
    if (!Number.isInteger(minutes) || minutes <= 0) return null;
    return base + minutes * 60 * 1000;
  }

  return null;
}

function parseNextRunAt(cron: string, base: number): number | null {
  const bunCronParse = (globalThis.Bun as BunCronLike | undefined)?.cron?.parse;
  const parsed = bunCronParse?.(cron, base);
  if (parsed instanceof Date) return parsed.getTime();
  if (typeof parsed === "number") return parsed;
  return parseSimpleCron(cron, base);
}

export function createCronJob(options: {
  cron: string;
  name: string;
  runOnStart?: boolean;
  handler: CronHandler;
}): ManagedCronJob {
  const { cron, name, runOnStart = false, handler } = options;

  const safeHandler = async () => {
    try {
      await handler();
    } catch (error) {
      console.error(`[${name}] Cron job failed:`, error);
    }
  };

  const nextRunAt = parseNextRunAt(cron, Date.now());
  if (!nextRunAt) {
    throw new Error(`[${name}] Invalid cron expression: ${cron}`);
  }

  let activeTimeout: ReturnType<typeof setTimeout> | null = null;
  let keepAlive = true;
  let stopped = false;

  const scheduleNextRun = () => {
    if (stopped) return;

    const nextScheduledAt = parseNextRunAt(cron, Date.now());
    if (!nextScheduledAt) {
      throw new Error(`[${name}] Invalid cron expression: ${cron}`);
    }

    activeTimeout = setTimeout(() => {
      activeTimeout = null;
      void safeHandler().finally(() => {
        scheduleNextRun();
      });
    }, Math.max(0, Number(nextScheduledAt) - Date.now()));

    if (!keepAlive) {
      activeTimeout.unref();
    }
  };

  const job: ManagedCronJob = {
    cron,
    ref() {
      keepAlive = true;
      activeTimeout?.ref();
      return job;
    },
    stop() {
      stopped = true;
      if (activeTimeout) {
        clearTimeout(activeTimeout);
        activeTimeout = null;
      }
      return job;
    },
    unref() {
      keepAlive = false;
      activeTimeout?.unref();
      return job;
    },
  };

  scheduleNextRun();

  if (runOnStart) {
    void safeHandler();
  }

  return job;
}
