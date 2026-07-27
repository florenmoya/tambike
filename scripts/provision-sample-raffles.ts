import { pathToFileURL } from "node:url";

import { loadEnvConfig } from "@next/env";

import {
  createPrismaSampleRaffleProvisioner,
  provisionSampleRaffles,
  SampleRaffleProvisioningError,
  productionSampleRaffleManifest,
  toSampleRaffleCliErrorCode,
  validateDirectSampleRaffleLockUrl,
  type PrismaSampleRaffleProvisioner,
} from "../src/server/giveaways/sample-raffles";

type CliEnvironment = Record<string, string | undefined>;

export interface SampleRaffleCliOptions {
  argv?: string[];
  environment?: CliEnvironment;
  write?: (line: string) => void;
  createProvisioner?: (
    runtimeDatabaseUrl: string,
    directDatabaseUrl: string,
    manifest: typeof productionSampleRaffleManifest,
  ) => PrismaSampleRaffleProvisioner | Promise<PrismaSampleRaffleProvisioner>;
  provision?: typeof provisionSampleRaffles;
}

function requireValue(
  value: string | undefined,
  code:
    | "DATABASE_TARGET_REQUIRED"
    | "ORGANIZER_CREDENTIAL_REQUIRED"
    | "ADMIN_CREDENTIAL_REQUIRED"
    | "WINNER_CREDENTIAL_REQUIRED"
    | "DRAW_ENCRYPTION_KEY_REQUIRED",
) {
  const trimmed = value?.trim();
  if (!trimmed) throw new SampleRaffleProvisioningError(code);
  return trimmed;
}

export async function runSampleRaffleCli(options: SampleRaffleCliOptions = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  if (!argv.includes("--confirm-production")) {
    throw new SampleRaffleProvisioningError("PRODUCTION_CONFIRMATION_REQUIRED");
  }

  const environment = options.environment ?? process.env;
  const runtimeDatabaseUrl = requireValue(
    environment.DATABASE_URL?.trim() || environment.SUPABASE_DATABASE_URL,
    "DATABASE_TARGET_REQUIRED",
  );
  const directDatabaseUrl = validateDirectSampleRaffleLockUrl(environment.DIRECT_URL);
  const organizerPassword = requireValue(
    environment.TAMBIKE_SAMPLE_RAFFLE_ORGANIZER_PASSWORD,
    "ORGANIZER_CREDENTIAL_REQUIRED",
  );
  const adminPassword = requireValue(
    environment.TAMBIKE_SAMPLE_RAFFLE_ADMIN_PASSWORD,
    "ADMIN_CREDENTIAL_REQUIRED",
  );
  const winnerPassword = requireValue(
    environment.TAMBIKE_SAMPLE_RAFFLE_WINNER_PASSWORD,
    "WINNER_CREDENTIAL_REQUIRED",
  );
  requireValue(environment.GIVEAWAY_DRAW_ENCRYPTION_KEY, "DRAW_ENCRYPTION_KEY_REQUIRED");

  const provisioner = await (
    options.createProvisioner ?? createPrismaSampleRaffleProvisioner
  )(runtimeDatabaseUrl, directDatabaseUrl, productionSampleRaffleManifest);
  try {
    const receipt = await (options.provision ?? provisionSampleRaffles)(
      {
        confirmedProduction: true,
        organizerPassword,
        adminPassword,
        winnerPassword,
        drawEncryptionKeyPresent: true,
        databaseTargetPresent: true,
        directLockPresent: true,
      },
      provisioner.dependencies,
      productionSampleRaffleManifest,
    );
    (options.write ?? console.log)(JSON.stringify(receipt));
    return receipt;
  } finally {
    await provisioner.close();
  }
}

async function main() {
  loadEnvConfig(process.cwd());
  try {
    await runSampleRaffleCli();
  } catch (error) {
    console.error(toSampleRaffleCliErrorCode(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
