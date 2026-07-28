import {
  createPrismaSampleRaffleProvisioner,
  productionSampleRaffleManifest,
  provisionSampleRaffles,
  type SampleRaffleProvisioningReceipt,
} from "@/server/giveaways/sample-raffles";
import { hasExactGiveawayCronAuthorization } from "@/server/giveaway-route-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const confirmationHeader = "x-tambike-sample-raffle-refresh";
const exactConfirmation = "cafe-classico-public-v1";
const noStoreHeaders = {
  "Cache-Control": "no-store",
};

interface SampleRafflePresentationRefreshDependencies {
  cronSecret?: string;
  refresh(): Promise<SampleRaffleProvisioningReceipt>;
}

function safeRefreshFailureCode(error: unknown) {
  const name =
    error instanceof Error ? error.name : undefined;
  return name && /^[A-Za-z][A-Za-z0-9]*$/.test(name)
    ? name
    : "UnknownError";
}

async function refreshProductionSampleRafflePresentation() {
  const runtimeDatabaseUrl =
    process.env.DATABASE_URL?.trim() ||
    process.env.SUPABASE_DATABASE_URL?.trim();
  const directDatabaseUrl = process.env.DIRECT_URL?.trim();
  const provisioner = await createPrismaSampleRaffleProvisioner(
    runtimeDatabaseUrl ?? "",
    directDatabaseUrl ?? "",
    productionSampleRaffleManifest,
  );
  try {
    return await provisionSampleRaffles(
      {
        confirmedProduction: true,
        drawEncryptionKeyPresent: Boolean(
          process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY?.trim(),
        ),
        databaseTargetPresent: Boolean(runtimeDatabaseUrl),
        directLockPresent: Boolean(directDatabaseUrl),
      },
      provisioner.dependencies,
      productionSampleRaffleManifest,
    );
  } finally {
    await provisioner.close();
  }
}

export function createSampleRafflePresentationRefreshHandler(
  dependencies: SampleRafflePresentationRefreshDependencies,
) {
  return async function sampleRafflePresentationRefreshHandler(
    request: Request,
  ) {
    if (
      !hasExactGiveawayCronAuthorization(
        request.headers,
        dependencies.cronSecret,
      )
    ) {
      return Response.json(
        { error: "FORBIDDEN" },
        { status: 403, headers: noStoreHeaders },
      );
    }
    if (request.headers.get(confirmationHeader) !== exactConfirmation) {
      return Response.json(
        { error: "CONFIRMATION_REQUIRED" },
        { status: 400, headers: noStoreHeaders },
      );
    }

    try {
      const receipt = await dependencies.refresh();
      return Response.json(receipt, { headers: noStoreHeaders });
    } catch (error) {
      console.error("Sample raffle presentation refresh failed", {
        code: safeRefreshFailureCode(error),
      });
      return Response.json(
        { error: "REFRESH_FAILED" },
        { status: 500, headers: noStoreHeaders },
      );
    }
  };
}

export const POST = createSampleRafflePresentationRefreshHandler({
  cronSecret: process.env.CRON_SECRET,
  refresh: refreshProductionSampleRafflePresentation,
});
