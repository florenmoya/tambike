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
const exactConfirmation = "cafe-classico-replace-v1";
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

function safeInternalFailureMessage(value: unknown) {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]+$/.test(value)
    ? value
    : undefined;
}

function safeRefreshFailureDiagnostic(error: unknown) {
  const errorRecord =
    typeof error === "object" && error !== null
      ? error
      : undefined;
  const name =
    error instanceof Error ? error.name : undefined;
  const message =
    error instanceof Error
      ? safeInternalFailureMessage(error.message)
      : undefined;
  const cause =
    errorRecord &&
    "cause" in errorRecord &&
    typeof errorRecord.cause === "object" &&
    errorRecord.cause !== null
      ? errorRecord.cause
      : undefined;
  const errorCode =
    errorRecord && "code" in errorRecord
      ? safeDiagnosticToken(errorRecord.code)
      : undefined;
  const meta =
    errorRecord &&
    "meta" in errorRecord &&
    typeof errorRecord.meta === "object" &&
    errorRecord.meta !== null
      ? errorRecord.meta
      : undefined;
  const metaCode =
    meta && "code" in meta
      ? safeDiagnosticToken(meta.code)
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
    ...(message ? { message } : {}),
    ...(errorCode ? { errorCode } : {}),
    ...(metaCode ? { metaCode } : {}),
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
    { trustedExistingActorSessions: true },
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
        replaceExisting: true,
        trustedProductionJob: true,
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
