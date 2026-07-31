import { pathToFileURL } from "node:url";

import { loadEnvConfig } from "@next/env";

import { SAMPLE_RAFFLE_PHOTO_SOURCES } from "../src/server/giveaways/sample-raffle-presentation";
import { loadMemberMediaConfig } from "../src/server/member-media/config";
import { normalizeMemberImage } from "../src/server/member-media/image-normalizer";
import { createS3MemberMediaStore } from "../src/server/member-media/s3-store";
import type { MemberMediaStore } from "../src/server/member-media/store";
import {
  buildSampleRaffleBrandingPlan,
  createPrismaSampleRaffleBrandingStore,
  type SampleRaffleBrandingPlan,
  type SampleRaffleBrandingStore,
} from "../src/server/maintenance/sample-raffle-branding-cleanup";
import { describePublicSeedDatabaseTarget } from "../src/server/maintenance/public-seed-label-cleanup";

type CliEnvironment = Record<string, string | undefined>;
type BrandingMediaStore = Pick<MemberMediaStore, "putObject" | "deleteObject">;

export interface SampleRaffleBrandingCleanupReceipt
  extends SampleRaffleBrandingPlan {
  mode: "preview" | "apply";
  target: {
    host: string;
    database: string;
  };
  officialProductSource: string;
}

export interface SampleRaffleBrandingCleanupCliOptions {
  argv?: string[];
  environment?: CliEnvironment;
  write?: (line: string) => void;
  createStore?: (
    databaseUrl: string,
  ) => SampleRaffleBrandingStore | Promise<SampleRaffleBrandingStore>;
  createMediaStore?: (environment: CliEnvironment) => BrandingMediaStore;
  fetchPhoto?: (url: string) => Promise<Response>;
  normalizePhoto?: typeof normalizeMemberImage;
}

function planHasChanges(plan: SampleRaffleBrandingPlan) {
  return Boolean(
    plan.winnerUpdate ||
      plan.giveawayUpdate ||
      plan.awardUpdate ||
      plan.prizePoolUpdate ||
      plan.prizeItemUpdate ||
      plan.mechanicsUpdate ||
      plan.imageUpdate,
  );
}

async function prepareOfficialImage(
  dependencies: Pick<
    Required<SampleRaffleBrandingCleanupCliOptions>,
    "fetchPhoto" | "normalizePhoto"
  >,
) {
  const response = await dependencies.fetchPhoto(
    SAMPLE_RAFFLE_PHOTO_SOURCES.completed.downloadUrl,
  );
  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    !response.ok ||
    (contentType !== "image/jpeg" &&
      contentType !== "image/png" &&
      contentType !== "image/webp")
  ) {
    throw new Error("SAMPLE_RAFFLE_BRANDING_PHOTO_INVALID");
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length === 0) {
    throw new Error("SAMPLE_RAFFLE_BRANDING_PHOTO_INVALID");
  }
  const normalized = await dependencies.normalizePhoto({
    body,
    claimedMimeType: contentType,
    purpose: "motorcycle-photo",
  });
  if (normalized.mimeType !== "image/webp") {
    throw new Error("SAMPLE_RAFFLE_BRANDING_PHOTO_INVALID");
  }
  return normalized;
}

export async function runSampleRaffleBrandingCleanupCli(
  options: SampleRaffleBrandingCleanupCliOptions = {},
): Promise<SampleRaffleBrandingCleanupReceipt> {
  const argv = options.argv ?? process.argv.slice(2);
  const environment = options.environment ?? process.env;
  const databaseUrl = environment.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");

  const mode = argv.includes("--apply") ? "apply" : "preview";
  const target = describePublicSeedDatabaseTarget(databaseUrl);
  const store = await (
    options.createStore ?? createPrismaSampleRaffleBrandingStore
  )(databaseUrl);
  try {
    const plan = buildSampleRaffleBrandingPlan(await store.inspect());
    if (mode === "apply" && plan.conflicts.length > 0) {
      throw new Error("SAMPLE_RAFFLE_BRANDING_CONFLICT");
    }

    if (mode === "apply" && planHasChanges(plan)) {
      if (plan.imageUpdate) {
        const normalized = await prepareOfficialImage({
          fetchPhoto: options.fetchPhoto ?? fetch,
          normalizePhoto: options.normalizePhoto ?? normalizeMemberImage,
        });
        const mediaStore = (
          options.createMediaStore ??
          ((env) =>
            createS3MemberMediaStore(loadMemberMediaConfig(env)))
        )(environment);
        await mediaStore.putObject({
          key: plan.imageUpdate.to.storageKey,
          body: normalized.bytes,
          mimeType: normalized.mimeType,
        });
        try {
          await store.apply(plan, {
            mimeType: normalized.mimeType,
            width: normalized.width,
            height: normalized.height,
          });
        } catch (error) {
          await mediaStore
            .deleteObject(plan.imageUpdate.to.storageKey)
            .catch(() => undefined);
          throw error;
        }
        await mediaStore.deleteObject(plan.imageUpdate.from.storageKey);
      } else {
        await store.apply(plan);
      }
    }

    const receipt: SampleRaffleBrandingCleanupReceipt = {
      mode,
      target,
      officialProductSource:
        SAMPLE_RAFFLE_PHOTO_SOURCES.completed.pageUrl,
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
    await runSampleRaffleBrandingCleanupCli();
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "SAMPLE_RAFFLE_BRANDING_CLEANUP_FAILED",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
