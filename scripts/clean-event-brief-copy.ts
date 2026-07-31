import { pathToFileURL } from "node:url";

import { loadEnvConfig } from "@next/env";

import {
  buildEventBriefCopyCleanupPlan,
  createPrismaEventBriefCopyCleanup,
  describeEventBriefDatabaseTarget,
  type EventBriefCopyCleanupPlan,
  type EventBriefCopyCleanupStore,
} from "../src/server/maintenance/event-brief-copy-cleanup";

export type { EventBriefCopyCleanupStore };

type CliEnvironment = Record<string, string | undefined>;

export interface EventBriefCopyCleanupReceipt
  extends EventBriefCopyCleanupPlan {
  mode: "preview" | "apply";
  target: {
    host: string;
    database: string;
  };
}

export interface EventBriefCopyCleanupCliOptions {
  argv?: string[];
  environment?: CliEnvironment;
  write?: (line: string) => void;
  createStore?: (
    databaseUrl: string,
  ) => EventBriefCopyCleanupStore | Promise<EventBriefCopyCleanupStore>;
}

export async function runEventBriefCopyCleanupCli(
  options: EventBriefCopyCleanupCliOptions = {},
): Promise<EventBriefCopyCleanupReceipt> {
  const argv = options.argv ?? process.argv.slice(2);
  const environment = options.environment ?? process.env;
  const databaseUrl = environment.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");

  const mode = argv.includes("--apply") ? "apply" : "preview";
  const target = describeEventBriefDatabaseTarget(databaseUrl);
  const store = await (
    options.createStore ?? createPrismaEventBriefCopyCleanup
  )(databaseUrl);

  try {
    const plan = buildEventBriefCopyCleanupPlan(await store.inspect());
    if (mode === "apply") {
      await store.apply(plan);
    }
    const receipt: EventBriefCopyCleanupReceipt = {
      mode,
      target,
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
    await runEventBriefCopyCleanupCli();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "EVENT_BRIEF_COPY_CLEANUP_FAILED",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
