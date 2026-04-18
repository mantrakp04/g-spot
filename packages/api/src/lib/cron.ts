type CronHandler = () => void | Promise<void>;

export interface ManagedCronJob {
  cron: string;
  ref(): ManagedCronJob;
  stop(): ManagedCronJob;
  unref(): ManagedCronJob;
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

  const nextRunAt = Bun.cron.parse(cron, Date.now());
  if (!nextRunAt) {
    throw new Error(`[${name}] Invalid cron expression: ${cron}`);
  }

  let activeTimeout: ReturnType<typeof setTimeout> | null = null;
  let keepAlive = true;
  let stopped = false;

  const scheduleNextRun = () => {
    if (stopped) return;

    const nextScheduledAt = Bun.cron.parse(cron, Date.now());
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
