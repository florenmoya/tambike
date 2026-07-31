import { pathToFileURL } from "node:url";

import { loadEnvConfig } from "@next/env";

import {
  buildEventScheduleBackfillPlan,
  createPrismaEventScheduleBackfill,
  type EventScheduleBackfillPlan,
  type EventScheduleBackfillStore,
} from "../src/server/maintenance/event-schedule-backfill";

export interface EventScheduleBackfillReceipt
  extends EventScheduleBackfillPlan {
  mode: "preview" | "apply";
  environment?: string;
  target: {
    host: string;
    database: string;
  };
}

export interface EventScheduleBackfillCliOptions {
  argv?: string[];
  environment?: Record<string, string | undefined>;
  write?: (line: string) => void;
  createStore?: (
    databaseUrl: string,
  ) => EventScheduleBackfillStore | Promise<EventScheduleBackfillStore>;
}

function describeTarget(databaseUrl: string) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("DATABASE_URL_MUST_BE_POSTGRES");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!url.hostname || !database) {
    throw new Error("DATABASE_URL_TARGET_REQUIRED");
  }
  return { host: url.hostname, database };
}

export async function runEventScheduleBackfillCli(
  options: EventScheduleBackfillCliOptions = {},
): Promise<EventScheduleBackfillReceipt> {
  const argv = options.argv ?? process.argv.slice(2);
  const environmentVariables = options.environment ?? process.env;
  const databaseUrl = environmentVariables.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL_REQUIRED");
  }

  const mode = argv.includes("--apply") ? "apply" : "preview";
  const environment = argv
    .find((argument) => argument.startsWith("--environment="))
    ?.slice("--environment=".length)
    .trim();
  if (mode === "apply" && !environment) {
    throw new Error("EVENT_SCHEDULE_BACKFILL_ENVIRONMENT_REQUIRED");
  }

  const store = await (
    options.createStore ?? createPrismaEventScheduleBackfill
  )(databaseUrl);
  try {
    const plan = buildEventScheduleBackfillPlan(await store.inspect());
    if (mode === "apply") {
      await store.apply(plan);
    }
    const receipt: EventScheduleBackfillReceipt = {
      mode,
      ...(environment ? { environment } : {}),
      target: describeTarget(databaseUrl),
      ...plan,
    };
    (options.write ?? console.log)(JSON.stringify(receipt, null, 2));
    return receipt;
  } finally {
    await store.close();
  }
}

async function main() {
  loadEnvConfig(process.cwd());
  try {
    await runEventScheduleBackfillCli();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "EVENT_SCHEDULE_BACKFILL_FAILED",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
