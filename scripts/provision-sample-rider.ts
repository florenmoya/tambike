import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { loadEnvConfig } from "@next/env";

import { getRuntimeDatabaseUrl } from "../src/server/database-url";
import {
  createPrismaSampleRiderProvisioner,
  provisionSampleRider,
  SampleRiderProvisioningError,
  SampleRiderRecoveryError,
  toSampleRiderCliErrorCode,
  validateDirectSampleRiderLockUrl,
  type PrismaSampleRiderProvisioner,
  type SampleRiderManifest,
} from "../src/server/member-profiles/sample-rider";

type CliEnvironment = Record<string, string | undefined>;

export interface SampleRiderCliOptions {
  argv?: string[];
  environment?: CliEnvironment;
  write?: (line: string) => void;
  createProvisioner?: (
    runtimeDatabaseUrl: string,
    directLockDatabaseUrl: string,
  ) => Promise<PrismaSampleRiderProvisioner>;
  provision?: typeof provisionSampleRider;
}

function parseArguments(argv: string[]) {
  const confirmedProduction = argv.includes("--confirm-production");
  if (!confirmedProduction) {
    throw new SampleRiderProvisioningError("PRODUCTION_CONFIRMATION_REQUIRED");
  }
  const manifestIndex = argv.indexOf("--manifest");
  const inlineManifest = argv.find((argument) => argument.startsWith("--manifest="))?.slice(11);
  const manifestPath = (
    manifestIndex >= 0
      ? argv[manifestIndex + 1]
      : inlineManifest
  )?.trim();
  if (!manifestPath) throw new SampleRiderProvisioningError("ASSET_UNAVAILABLE");
  return { confirmedProduction, manifestPath };
}

export async function runSampleRiderCli(options: SampleRiderCliOptions = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  const environment = options.environment ?? process.env;
  const write = options.write ?? console.log;
  const { confirmedProduction, manifestPath } = parseArguments(argv);
  if (!environment.TAMBIKE_SAMPLE_RIDER_PASSWORD?.trim()) {
    throw new SampleRiderProvisioningError("PASSWORD_REQUIRED");
  }
  const directLockDatabaseUrl = validateDirectSampleRiderLockUrl(environment.DIRECT_URL);

  let manifest: SampleRiderManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as SampleRiderManifest;
  } catch {
    throw new SampleRiderProvisioningError("ASSET_UNAVAILABLE");
  }
  const databaseUrl = getRuntimeDatabaseUrl(environment);
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");

  const provisioner = await (
    options.createProvisioner ??
    (async (runtimeUrl, directUrl) => createPrismaSampleRiderProvisioner(runtimeUrl, directUrl))
  )(databaseUrl, directLockDatabaseUrl);
  let result: Awaited<ReturnType<typeof provisionSampleRider>> | undefined;
  let operationFailure: unknown | null = null;
  try {
    result = await (options.provision ?? provisionSampleRider)({
      confirmedProduction,
      password: environment.TAMBIKE_SAMPLE_RIDER_PASSWORD,
      manifest,
    }, provisioner.dependencies);
  } catch (error) {
    operationFailure = error;
  }
  let closeFailure: unknown | null = null;
  try {
    await provisioner.close();
  } catch (error) {
    closeFailure = error;
  }
  if (closeFailure !== null) {
    throw new SampleRiderRecoveryError(operationFailure, [closeFailure]);
  }
  if (operationFailure !== null) throw operationFailure;
  if (!result) throw new SampleRiderProvisioningError("INVARIANT_FAILED");
  write(JSON.stringify(result));
  return result;
}

async function main() {
  loadEnvConfig(process.cwd());
  try {
    await runSampleRiderCli();
  } catch (error) {
    const code = toSampleRiderCliErrorCode(error);
    console.error(code);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
