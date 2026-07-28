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

function safeDiagnosticToken(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_]+$/.test(value)
    ? value
    : undefined;
}

function safeRefreshFailureDiagnostic(error: unknown) {
  const name =
    error instanceof Error ? error.name : undefined;
  const cause =
    typeof error === "object" &&
    error !== null &&
    "cause" in error &&
    typeof error.cause === "object" &&
    error.cause !== null
      ? error.cause
      : undefined;
  const causeKind =
    cause && "kind" in cause
      ? safeDiagnosticToken(cause.kind)
      : undefined;
  const causeCode =
    cause && "code" in cause
      ? safeDiagnosticToken(cause.code)
      : undefined;
  return {
    code: safeDiagnosticToken(name) ?? "UnknownError",
    ...(causeKind ? { causeKind } : {}),
    ...(causeCode ? { causeCode } : {}),
  };
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
        ...safeRefreshFailureDiagnostic(error),
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
