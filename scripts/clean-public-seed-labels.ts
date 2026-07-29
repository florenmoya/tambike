import { pathToFileURL } from "node:url";

import { loadEnvConfig } from "@next/env";

import {
  buildPublicSeedLabelCleanupPlan,
  createPrismaPublicSeedLabelCleanup,
  describePublicSeedDatabaseTarget,
  type PublicSeedLabelCleanupPlan,
  type PublicSeedLabelCleanupStore,
} from "../src/server/maintenance/public-seed-label-cleanup";

export type { PublicSeedLabelCleanupStore };

type CliEnvironment = Record<string, string | undefined>;

export interface PublicSeedLabelCleanupReceipt extends PublicSeedLabelCleanupPlan {
  mode: "preview" | "apply";
  target: {
    host: string;
    database: string;
  };
}

export interface PublicSeedLabelCleanupCliOptions {
  argv?: string[];
  environment?: CliEnvironment;
  write?: (line: string) => void;
  createStore?: (
    databaseUrl: string,
  ) => PublicSeedLabelCleanupStore | Promise<PublicSeedLabelCleanupStore>;
}

export async function runPublicSeedLabelCleanupCli(
  options: PublicSeedLabelCleanupCliOptions = {},
): Promise<PublicSeedLabelCleanupReceipt> {
  const argv = options.argv ?? process.argv.slice(2);
  const environment = options.environment ?? process.env;
  const databaseUrl = environment.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");

  const mode = argv.includes("--apply") ? "apply" : "preview";
  const target = describePublicSeedDatabaseTarget(databaseUrl);
  const store = await (
    options.createStore ?? createPrismaPublicSeedLabelCleanup
  )(databaseUrl);
  try {
    const plan = buildPublicSeedLabelCleanupPlan(await store.inspect());
    if (mode === "apply") {
      await store.apply(plan);
    }
    const receipt: PublicSeedLabelCleanupReceipt = {
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
    await runPublicSeedLabelCleanupCli();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "PUBLIC_SEED_LABEL_CLEANUP_FAILED",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
