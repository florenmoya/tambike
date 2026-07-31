# Production sample raffle provisioning

This command provisions or refreshes exactly two sample campaigns on the published host event
**Tambike at Cafe Classico** (`tambike-cafe-classico`):

- `HJC C10 FOP Helmet Raffle` — completed, with one published and fulfilled winner
- `Weekend Rider Gear Raffle` — open, with no snapshot, draw, award, or winner

When the exact lifecycle already matches, the job is idempotent. When the exact
legacy sample lifecycle exists with stale public presentation, the protected
job keeps those historical campaigns as hidden archived records and creates
the replacement pair. Prize media is attached while the replacement campaigns
are drafts, before any entrant history makes their presentation immutable. Any
partial or conflicting lifecycle fails closed.

## Requirements

Refreshing the exact existing lifecycle requires these linked Vercel production
variables. Never paste or print their values:

```text
DATABASE_URL or SUPABASE_DATABASE_URL
DIRECT_URL
AWS_REGION
AWS_ROLE_ARN
S3_BUCKET_NAME
CRON_SECRET
```

The protected production job uses short-lived sessions for only the exact
existing organizer, approved administrator, and dedicated sample rider. Those
sessions are removed before the job closes. The standalone CLI instead
requires:

```text
GIVEAWAY_DRAW_ENCRYPTION_KEY
TAMBIKE_SAMPLE_RAFFLE_ORGANIZER_PASSWORD
TAMBIKE_SAMPLE_RAFFLE_ADMIN_PASSWORD
TAMBIKE_SAMPLE_RAFFLE_WINNER_PASSWORD
```

Install and verify the Vercel CLI. Database inspection uses the repository's
installed `pg` dependency, so it does not require a separate database CLI:

```powershell
npm i -g vercel
vercel --version
```

The refresh request runs inside the deployed Vercel function, where the media
upload receives a short-lived `VERCEL_OIDC_TOKEN`. Do not create or store
persistent AWS credentials. The protected refresh endpoint only accepts the
exact production cron authorization and one-purpose confirmation header.

## Prize photo sources

The provisioner downloads these source images only when the exact prize pool has
no managed image, normalizes them to WebP, and stores them under Tambike's
private giveaway-prize namespace:

- HJC C10 FOP Full-Face Helmet — HJC Helmets,
  [official HJC C10 FOP product page](https://hjchelmets.us/products/c10-fop),
  managed media ID `sample-raffle-hjc-c10-fop-photo-v1`
- Weekend Rider Gear Package — Labskiii,
  [Pexels photo 15625079](https://www.pexels.com/photo/man-wearing-a-safety-helmet-15625079/),
  managed media ID `sample-raffle-gear-photo-v1`

The public event page serves the resulting `GiveawayPrizeImage` records through
Tambike. It never hotlinks either source.

## Preflight, execution, postflight, and guaranteed cleanup

Run the following block from the repository root in a clean PowerShell. It:

1. refuses to overwrite a local production environment file;
2. pulls production configuration before any database command;
3. loads `DIRECT_URL` without displaying it and passes it to the read-only Node
   inspection process through the environment rather than the command line;
4. fails closed unless the target campaigns are absent or have the exact
   replaceable lifecycle;
5. calls the protected production replacement function, which receives short-lived
   Vercel OIDC;
6. proves the exact lifecycle, public copy, winner alias, and managed media; and
7. removes the temporary file and process-level database variables even when a
   preflight, provision, or postflight command fails.

```powershell
$temporaryEnvFile = Join-Path (Get-Location) '.env.production.local'
$requiredCleanShellNames = @(
  'DATABASE_URL',
  'SUPABASE_DATABASE_URL',
  'DIRECT_URL',
  'CRON_SECRET',
  'GIVEAWAY_DRAW_ENCRYPTION_KEY',
  'TAMBIKE_SAMPLE_RAFFLE_ORGANIZER_PASSWORD',
  'TAMBIKE_SAMPLE_RAFFLE_ADMIN_PASSWORD',
  'TAMBIKE_SAMPLE_RAFFLE_WINNER_PASSWORD',
  'TAMBIKE_SAMPLE_RAFFLE_INSPECTION_SQL'
)
$preExistingNames = $requiredCleanShellNames |
  Where-Object { Test-Path -LiteralPath "Env:$_" }
if ($preExistingNames.Count -gt 0) {
  throw "Start a clean PowerShell; these variable names are already set: $($preExistingNames -join ', ')"
}
if (Test-Path -LiteralPath $temporaryEnvFile) {
  throw '.env.production.local already exists; confirm its ownership before moving or removing it.'
}

function Invoke-PostgresRow([string] $Sql) {
  $env:TAMBIKE_SAMPLE_RAFFLE_INSPECTION_SQL = $Sql
  try {
    $json = & node --input-type=module -e "import pg from 'pg'; const { Client } = pg; const client = new Client({ connectionString: process.env.DIRECT_URL }); try { await client.connect(); const result = await client.query(process.env.TAMBIKE_SAMPLE_RAFFLE_INSPECTION_SQL); process.stdout.write(JSON.stringify(result.rows[0] ?? null)); } catch { process.stderr.write('READ_ONLY_DATABASE_INSPECTION_FAILED'); process.exitCode = 1; } finally { await client.end().catch(() => {}); }"
    if ($LASTEXITCODE -ne 0) {
      throw 'Read-only database inspection failed.'
    }
    return (($json -join "`n") | ConvertFrom-Json)
  } finally {
    Remove-Item -LiteralPath 'Env:TAMBIKE_SAMPLE_RAFFLE_INSPECTION_SQL' -ErrorAction SilentlyContinue
  }
}

$sampleStateSql = @'
WITH target_campaigns AS (
  SELECT
    g."title",
    g."status"::text AS status,
    g."complianceStatus"::text AS compliance_status,
    (SELECT COUNT(*) FROM "GiveawaySnapshot" s
      WHERE s."giveawayId" = g."id") AS snapshot_count,
    (SELECT COUNT(*) FROM "GiveawayDraw" d
      WHERE d."giveawayId" = g."id") AS draw_count,
    (SELECT COUNT(*) FROM "GiveawayDraw" d
      WHERE d."giveawayId" = g."id" AND d."status" = 'published') AS published_draw_count,
    (SELECT COUNT(*) FROM "GiveawayAward" a
      WHERE a."giveawayId" = g."id") AS award_count,
    (SELECT COUNT(*) FROM "GiveawayAward" a
      WHERE a."giveawayId" = g."id" AND a."isCurrent" = TRUE) AS current_award_count,
    (SELECT COUNT(*) FROM "GiveawayAward" a
      WHERE a."giveawayId" = g."id" AND a."isCurrent" = TRUE
        AND a."status" = 'fulfilled') AS fulfilled_current_award_count,
    (SELECT COUNT(*)
      FROM "GiveawayAward" a
      JOIN "User" u ON u."id" = a."winnerUserId"
      WHERE a."giveawayId" = g."id"
        AND a."isCurrent" = TRUE
        AND a."publicWinnerAlias" IS NOT NULL
        AND a."winnerAliasOptedInAt" IS NOT NULL
        AND a."winnerAliasRevokedAt" IS NULL
        AND u."email" = 'raffle.winner.sample@tambike.ph'
    ) AS exact_published_winner_count,
    (SELECT a."publicWinnerAlias"
      FROM "GiveawayAward" a
      JOIN "User" u ON u."id" = a."winnerUserId"
      WHERE a."giveawayId" = g."id"
        AND a."isCurrent" = TRUE
        AND a."winnerAliasOptedInAt" IS NOT NULL
        AND a."winnerAliasRevokedAt" IS NULL
        AND u."email" = 'raffle.winner.sample@tambike.ph'
      LIMIT 1
    ) AS public_winner_alias,
    (SELECT mv."mechanics"
      FROM "GiveawayMechanicsVersion" mv
      WHERE mv."giveawayId" = g."id"
      ORDER BY mv."version" DESC
      LIMIT 1
    ) AS mechanics,
    (SELECT mv."terms"
      FROM "GiveawayMechanicsVersion" mv
      WHERE mv."giveawayId" = g."id"
      ORDER BY mv."version" DESC
      LIMIT 1
    ) AS terms,
    (SELECT mv."sponsorDisclosure"
      FROM "GiveawayMechanicsVersion" mv
      WHERE mv."giveawayId" = g."id"
      ORDER BY mv."version" DESC
      LIMIT 1
    ) AS sponsor_disclosure,
    (SELECT p."publicTitle"
      FROM "GiveawayPrizePool" p
      WHERE p."giveawayId" = g."id"
      ORDER BY p."position"
      LIMIT 1
    ) AS public_title,
    (SELECT p."publicDescription"
      FROM "GiveawayPrizePool" p
      WHERE p."giveawayId" = g."id"
      ORDER BY p."position"
      LIMIT 1
    ) AS public_description,
    (SELECT i."mediaId"
      FROM "GiveawayPrizePool" p
      JOIN "GiveawayPrizeImage" i ON i."prizePoolId" = p."id"
      WHERE p."giveawayId" = g."id"
      ORDER BY p."position"
      LIMIT 1
    ) AS public_image_media_id
  FROM "EventGiveaway" g
  WHERE g."eventId" = 'tambike-cafe-classico'
    AND g."title" IN (
      'HJC C10 FOP Helmet Raffle',
      'Weekend Rider Gear Raffle'
    )
),
summary AS (
  SELECT
    COUNT(*) AS target_campaign_count,
    COUNT(*) FILTER (
      WHERE "title" = 'HJC C10 FOP Helmet Raffle'
        AND status = 'completed'
        AND compliance_status = 'approved'
        AND snapshot_count = 1
        AND draw_count = 1
        AND published_draw_count = 1
        AND current_award_count = 1
        AND fulfilled_current_award_count = 1
        AND exact_published_winner_count = 1
    ) AS exact_completed_count,
    COUNT(*) FILTER (
      WHERE "title" = 'Weekend Rider Gear Raffle'
        AND status = 'open'
        AND compliance_status = 'approved'
        AND snapshot_count = 0
        AND draw_count = 0
        AND published_draw_count = 0
        AND award_count = 0
        AND current_award_count = 0
        AND fulfilled_current_award_count = 0
        AND exact_published_winner_count = 0
    ) AS exact_ongoing_count,
    COUNT(*) FILTER (
      WHERE "title" = 'HJC C10 FOP Helmet Raffle'
        AND status = 'completed'
        AND compliance_status = 'approved'
        AND public_winner_alias = 'Gabriel Cruz'
        AND mechanics = 'One eligible rider was selected from valid entries.'
        AND terms = 'The winner receives one HJC C10 FOP Full-Face Helmet. The organizer will contact the winner with claiming instructions.'
        AND sponsor_disclosure = 'HJC is not affiliated with or endorsing this event.'
        AND public_title = 'HJC C10 FOP Full-Face Helmet'
        AND public_description = 'A branded full-face helmet for everyday road riding.'
        AND public_image_media_id IS NOT NULL
    ) AS exact_completed_presentation_count,
    COUNT(*) FILTER (
      WHERE "title" = 'Weekend Rider Gear Raffle'
        AND status = 'open'
        AND compliance_status = 'approved'
        AND mechanics = 'Registered event riders may enter once while the raffle is open.'
        AND terms = 'One winner will receive the Weekend Rider Gear Package. The organizer will announce and contact the winner after the draw.'
        AND public_title = 'Weekend Rider Gear Package'
        AND public_description = 'Helmet, riding gloves, and Tambike gear for your next ride.'
        AND public_image_media_id IS NOT NULL
    ) AS exact_ongoing_presentation_count
  FROM target_campaigns
)
SELECT
  target_campaign_count,
  exact_completed_count,
  exact_ongoing_count,
  exact_completed_presentation_count,
  exact_ongoing_presentation_count,
  (
    target_campaign_count = 0
    OR (
      target_campaign_count = 2
      AND exact_completed_count = 1
      AND exact_ongoing_count = 1
    )
  ) AS safe_to_run
FROM summary;
'@

try {
  vercel env pull .env.production.local --environment=production
  if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $temporaryEnvFile)) {
    throw 'Production environment pull failed.'
  }

  $env:DIRECT_URL = (& node --input-type=module -e "import nextEnv from '@next/env'; const { loadEnvConfig } = nextEnv; loadEnvConfig(process.cwd(), false); process.stdout.write(process.env.DIRECT_URL ?? '');")
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($env:DIRECT_URL)) {
    throw 'DIRECT_URL was not loaded from the temporary production environment.'
  }

  $databaseIdentity = Invoke-PostgresRow @'
SELECT
  current_database() AS database_name,
  current_user AS database_user;
'@
  if (
    [string]::IsNullOrWhiteSpace($databaseIdentity.database_name) -or
    [string]::IsNullOrWhiteSpace($databaseIdentity.database_user)
  ) {
    throw 'Production database identity could not be confirmed.'
  }
  $hostEventState = Invoke-PostgresRow @'
SELECT COUNT(*) AS host_event_count
FROM "Event"
WHERE "id" = 'tambike-cafe-classico'
  AND "status" = 'PUBLISHED';
'@
  if ([int]$hostEventState.host_event_count -ne 1) {
    throw 'The exact published host event was not found.'
  }

  $preflightState = Invoke-PostgresRow $sampleStateSql
  $preflightIsEmpty = (
    [int]$preflightState.target_campaign_count -eq 0 -and
    [int]$preflightState.exact_completed_count -eq 0 -and
    [int]$preflightState.exact_ongoing_count -eq 0 -and
    $preflightState.safe_to_run -eq $true
  )
  $preflightIsRefreshable = (
    [int]$preflightState.target_campaign_count -eq 2 -and
    [int]$preflightState.exact_completed_count -eq 1 -and
    [int]$preflightState.exact_ongoing_count -eq 1 -and
    $preflightState.safe_to_run -eq $true
  )
  if (!$preflightIsEmpty -and !$preflightIsRefreshable) {
    throw 'Sample raffle state is partial or conflicting; no write was attempted.'
  }

  $refreshReceiptJson = & node --input-type=module -e "import nextEnv from '@next/env'; const { loadEnvConfig } = nextEnv; loadEnvConfig(process.cwd(), false); const secret = process.env.CRON_SECRET?.trim(); if (!secret) { process.stderr.write('CRON_AUTHORIZATION_REQUIRED'); process.exit(1); } const response = await fetch('https://tambike.bayanko.ph/api/jobs/sample-raffle-presentation', { method: 'POST', headers: { Authorization: 'Bearer ' + secret, 'x-tambike-sample-raffle-refresh': 'cafe-classico-replace-v1' } }); const body = await response.text(); if (!response.ok) { process.stderr.write('SAMPLE_RAFFLE_REFRESH_FAILED'); process.exit(1); } process.stdout.write(body);"
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($refreshReceiptJson -join "`n"))) {
    throw 'Sample raffle refresh failed.'
  }
  $refreshReceipt = (($refreshReceiptJson -join "`n") | ConvertFrom-Json)

  $postflightState = Invoke-PostgresRow $sampleStateSql
  if (
    [int]$postflightState.target_campaign_count -ne 2 -or
    [int]$postflightState.exact_completed_count -ne 1 -or
    [int]$postflightState.exact_ongoing_count -ne 1 -or
    [int]$postflightState.exact_completed_presentation_count -ne 1 -or
    [int]$postflightState.exact_ongoing_presentation_count -ne 1 -or
    $postflightState.safe_to_run -ne $true
  ) {
    throw 'Postflight did not prove the exact final sample raffle invariants.'
  }

  $publicPrizeInspectionScript = @'
import { PrismaTambikeBackend } from './src/server/prisma-backend.ts';

async function inspectPublicPrizes() {
  const backend = PrismaTambikeBackend.create(process.env.DIRECT_URL);
  try {
    const publicGiveaways = await backend.listPublicGiveawaysForEvent(
      'tambike-cafe-classico',
    );
    const completed = publicGiveaways.find(
      ({ giveaway }) => giveaway.title === 'HJC C10 FOP Helmet Raffle',
    );
    const ongoing = publicGiveaways.find(
      ({ giveaway }) => giveaway.title === 'Weekend Rider Gear Raffle',
    );

    return {
      completedPublicPrize:
        completed?.giveaway.prizePools[0]?.presentation.title,
      completedPublicDescription:
        completed?.giveaway.prizePools[0]?.presentation.description,
      completedPublicImage:
        completed?.giveaway.prizePools[0]?.presentation.image?.mediaId,
      completedWinnerAlias: completed?.results[0]?.winnerAlias,
      ongoingPublicPrize:
        ongoing?.giveaway.prizePools[0]?.presentation.title,
      ongoingPublicDescription:
        ongoing?.giveaway.prizePools[0]?.presentation.description,
      ongoingPublicImage:
        ongoing?.giveaway.prizePools[0]?.presentation.image?.mediaId,
      publicCopyHasNoDemoLanguage: [completed, ongoing].every(
        (entry) =>
          entry !== undefined &&
          !/\b(?:sample|demo)\b/i.test(
            `${entry.giveaway.mechanics} ${entry.giveaway.terms}`,
          ),
      ),
      publicDtoOmitsInternalFields: [completed, ongoing].every(
        (entry) =>
          entry !== undefined &&
          entry.giveaway.prizePools.every(
            (pool) => !('title' in pool) && !('items' in pool),
          ),
      ),
    };
  } finally {
    await backend.disconnect();
  }
}

inspectPublicPrizes()
  .then((inspection) => process.stdout.write(JSON.stringify(inspection)))
  .catch(() => {
    process.stderr.write('READ_ONLY_PUBLIC_PRIZE_INSPECTION_FAILED');
    process.exitCode = 1;
  });
'@
  $publicPrizeInspectionScript = $publicPrizeInspectionScript -replace '\r?\n', ' '
  $publicPrizeInspectionJson = & npx tsx --conditions=react-server -e $publicPrizeInspectionScript
  if ($LASTEXITCODE -ne 0) {
    throw 'Read-only public prize inspection failed.'
  }
  $publicPrizeInspection = (($publicPrizeInspectionJson -join "`n") | ConvertFrom-Json)
  if (
    $publicPrizeInspection.completedPublicPrize -ne 'HJC C10 FOP Full-Face Helmet' -or
    $publicPrizeInspection.completedPublicDescription -ne 'A branded full-face helmet for everyday road riding.' -or
    [string]::IsNullOrWhiteSpace($publicPrizeInspection.completedPublicImage) -or
    $publicPrizeInspection.completedWinnerAlias -ne 'Gabriel Cruz' -or
    $publicPrizeInspection.ongoingPublicPrize -ne 'Weekend Rider Gear Package' -or
    $publicPrizeInspection.ongoingPublicDescription -ne 'Helmet, riding gloves, and Tambike gear for your next ride.' -or
    [string]::IsNullOrWhiteSpace($publicPrizeInspection.ongoingPublicImage) -or
    $publicPrizeInspection.publicCopyHasNoDemoLanguage -ne $true -or
    $publicPrizeInspection.publicDtoOmitsInternalFields -ne $true
  ) {
    throw 'Public prize presentation verification failed.'
  }

  Write-Output "completed public prize: $($publicPrizeInspection.completedPublicPrize)"
  Write-Output "completed public image: $($publicPrizeInspection.completedPublicImage)"
  Write-Output "completed winner: $($publicPrizeInspection.completedWinnerAlias)"
  Write-Output "ongoing public prize: $($publicPrizeInspection.ongoingPublicPrize)"
  Write-Output "ongoing public image: $($publicPrizeInspection.ongoingPublicImage)"
} finally {
  try {
    if (Test-Path -LiteralPath $temporaryEnvFile) {
      Remove-Item -LiteralPath $temporaryEnvFile -Force -ErrorAction Stop
    }
  } finally {
    Remove-Item -LiteralPath 'Env:DIRECT_URL' -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath 'Env:TAMBIKE_SAMPLE_RAFFLE_INSPECTION_SQL' -ErrorAction SilentlyContinue
  }
}

if (Test-Path -LiteralPath $temporaryEnvFile) {
  throw 'Temporary production environment cleanup failed.'
}
```

The allowed preflight states are:

- target `0`, exact completed `0`, exact ongoing `0`, safe `true` — neither
  target campaign exists, so provisioning may start.
- target `2`, exact completed `1`, exact ongoing `1`, safe `true` — the exact
  completed and ongoing lifecycle already exists. A final presentation returns
  unchanged; a stale presentation is archived and replaced without mutating
  its entrant, draw, award, or audit history.

Every other result is partial or conflicting and stops before the write command.
Postflight additionally requires completed presentation `1` and ongoing
presentation `1`.

The final output lines are read-only checks of the two revealed production
raffles:

```text
completed public prize: HJC C10 FOP Full-Face Helmet
completed public image: sample-raffle-hjc-c10-fop-photo-v1
completed winner: Gabriel Cruz
ongoing public prize: Weekend Rider Gear Package
ongoing public image: sample-raffle-gear-photo-v1
```

These revealed samples cannot prove surprise-prize redaction. That contract is
covered by
`tests/prisma-integration/sample-raffle-provisioner.integration.test.ts`, which
creates a disposable surprise raffle through the production backend, publishes
it, and reads it through `listPublicGiveawaysForEvent`. The test requires the
exact `{ disclosure: "surprise", title: "Surprise prize" }` presentation, no
description or image, no internal pool/item fields, and no serialized sentinel
internal or hidden public copy.

## Safe receipt

The protected refresh endpoint emits one JSON receipt. The enclosing runbook then emits
the two read-only public-contract lines above. Neither output contains
credentials, connection strings, sessions, claim payloads, or encryption keys.
Example receipt without live IDs:

```json
{
  "eventId": "<event-id>",
  "completed": {
    "giveawayId": "<completed-giveaway-id>",
    "title": "HJC C10 FOP Helmet Raffle",
    "state": "completed",
    "winnerCount": 1,
    "winnerAlias": "Gabriel Cruz"
  },
  "ongoing": {
    "giveawayId": "<ongoing-giveaway-id>",
    "title": "Weekend Rider Gear Raffle",
    "state": "open",
    "winnerCount": 0
  },
  "changed": true
}
```

Cleanup or deletion of provisioned raffle data requires separate user approval
and is not part of this runbook.
