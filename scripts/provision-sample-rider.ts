import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { loadEnvConfig } from "@next/env";

import { getRuntimeDatabaseUrl } from "../src/server/database-url";
import {
  createPrismaSampleRiderProvisioner,
  provisionSampleRider,
  SampleRiderProvisioningError,
  type PrismaSampleRiderProvisioner,
  type SampleRiderManifest,
} from "../src/server/member-profiles/sample-rider";

type CliEnvironment = Record<string, string | undefined>;

export interface SampleRiderCliOptions {
  argv?: string[];
  environment?: CliEnvironment;
  write?: (line: string) => void;
  createProvisioner?: (databaseUrl: string) => Promise<PrismaSampleRiderProvisioner>;
}

function parseArguments(argv: string[], environment: CliEnvironment) {
  const confirmedProduction =
    argv.includes("--confirm-production") ||
    environment.npm_config_confirm_production?.trim().toLowerCase() === "true";
  const manifestIndex = argv.indexOf("--manifest");
  const inlineManifest = argv.find((argument) => argument.startsWith("--manifest="))?.slice(11);
  const manifestPath = (
    manifestIndex >= 0
      ? argv[manifestIndex + 1]
      : inlineManifest ?? environment.npm_config_manifest
  )?.trim();
  if (!manifestPath) throw new SampleRiderProvisioningError("ASSET_UNAVAILABLE");
  return { confirmedProduction, manifestPath };
}

export async function runSampleRiderCli(options: SampleRiderCliOptions = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  const environment = options.environment ?? process.env;
  const write = options.write ?? console.log;
  const { confirmedProduction, manifestPath } = parseArguments(argv, environment);
  if (!confirmedProduction) {
    throw new SampleRiderProvisioningError("PRODUCTION_CONFIRMATION_REQUIRED");
  }
  if (!environment.TAMBIKE_SAMPLE_RIDER_PASSWORD?.trim()) {
    throw new SampleRiderProvisioningError("PASSWORD_REQUIRED");
  }

  let manifest: SampleRiderManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as SampleRiderManifest;
  } catch {
    throw new SampleRiderProvisioningError("ASSET_UNAVAILABLE");
  }
  const databaseUrl = getRuntimeDatabaseUrl(environment);
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");

  const provisioner = await (options.createProvisioner ?? (async (url) => createPrismaSampleRiderProvisioner(url)))(databaseUrl);
  try {
    const result = await provisionSampleRider({
      confirmedProduction,
      password: environment.TAMBIKE_SAMPLE_RIDER_PASSWORD,
      manifest,
    }, provisioner.dependencies);
    write(JSON.stringify(result));
    return result;
  } finally {
    await provisioner.close();
  }
}

async function main() {
  loadEnvConfig(process.cwd());
  try {
    await runSampleRiderCli();
  } catch (error) {
    const code = error instanceof SampleRiderProvisioningError ? error.code : "SAMPLE_RIDER_PROVISIONING_FAILED";
    console.error(code);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
