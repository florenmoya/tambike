# Production sample raffle provisioning

This command provisions exactly two sample campaigns on the published host event
**Tambike at Cafe Classico** (`tambike-cafe-classico`):

- `Cafe Classico Helmet Raffle` — completed, with one published and fulfilled sample winner
- `Weekend Rider Gear Raffle` — open, with no snapshot, draw, award, or winner

The command is idempotent only when both campaigns already satisfy the complete
final invariants. Any partial or conflicting sample campaign fails closed.

## Requirements

The linked Vercel production environment must contain these variable names.
Never paste or print their values:

```text
DATABASE_URL or SUPABASE_DATABASE_URL
DIRECT_URL
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

## Preflight, execution, postflight, and guaranteed cleanup

Run the following block from the repository root in a clean PowerShell. It:

1. refuses to overwrite a local production environment file;
2. pulls production configuration before any database command;
3. loads `DIRECT_URL` without displaying it and passes it to the read-only Node
   inspection process through the environment rather than the command line;
4. fails closed unless the target campaigns are absent or already exactly final;
5. runs the production-confirmed command;
6. proves the exact final relational state; and
7. removes the temporary file and process-level database variables even when a
   preflight, provision, or postflight command fails.

```powershell
$temporaryEnvFile = Join-Path (Get-Location) '.env.production.local'
$requiredCleanShellNames = @(
  'DATABASE_URL',
  'SUPABASE_DATABASE_URL',
  'DIRECT_URL',
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
        AND a."publicWinnerAlias" = 'Raffle Sample Rider'
        AND a."winnerAliasOptedInAt" IS NOT NULL
        AND a."winnerAliasRevokedAt" IS NULL
        AND u."email" = 'raffle.winner.sample@tambike.ph'
    ) AS exact_published_winner_count
  FROM "EventGiveaway" g
  WHERE g."eventId" = 'tambike-cafe-classico'
    AND g."title" IN (
      'Cafe Classico Helmet Raffle',
      'Weekend Rider Gear Raffle'
    )
),
summary AS (
  SELECT
    COUNT(*) AS target_campaign_count,
    COUNT(*) FILTER (
      WHERE "title" = 'Cafe Classico Helmet Raffle'
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
    ) AS exact_ongoing_count
  FROM target_campaigns
)
SELECT
  target_campaign_count,
  exact_completed_count,
  exact_ongoing_count,
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
  $preflightIsFinal = (
    [int]$preflightState.target_campaign_count -eq 2 -and
    [int]$preflightState.exact_completed_count -eq 1 -and
    [int]$preflightState.exact_ongoing_count -eq 1 -and
    $preflightState.safe_to_run -eq $true
  )
  if (!$preflightIsEmpty -and !$preflightIsFinal) {
    throw 'Sample raffle state is partial or conflicting; no write was attempted.'
  }

  npm run provision:sample-raffles -- -- --confirm-production
  if ($LASTEXITCODE -ne 0) {
    throw 'Sample raffle provisioning failed.'
  }

  $postflightState = Invoke-PostgresRow $sampleStateSql
  if (
    [int]$postflightState.target_campaign_count -ne 2 -or
    [int]$postflightState.exact_completed_count -ne 1 -or
    [int]$postflightState.exact_ongoing_count -ne 1 -or
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
      ({ giveaway }) => giveaway.title === 'Cafe Classico Helmet Raffle',
    );
    const ongoing = publicGiveaways.find(
      ({ giveaway }) => giveaway.title === 'Weekend Rider Gear Raffle',
    );

    return {
      completedPublicPrize:
        completed?.giveaway.prizePools[0]?.presentation.title,
      ongoingPublicPrize:
        ongoing?.giveaway.prizePools[0]?.presentation.title,
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
    $publicPrizeInspection.completedPublicPrize -ne 'Cafe Classico Helmet' -or
    $publicPrizeInspection.ongoingPublicPrize -ne 'Weekend Rider Gear Package' -or
    $publicPrizeInspection.publicDtoOmitsInternalFields -ne $true
  ) {
    throw 'Public prize presentation verification failed.'
  }

  Write-Output "completed public prize: $($publicPrizeInspection.completedPublicPrize)"
  Write-Output "ongoing public prize: $($publicPrizeInspection.ongoingPublicPrize)"
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
  completed and ongoing pair already exists, so the
  command may perform its idempotent confirmation.

Every other result is partial or conflicting and stops before the write command.
Postflight accepts only the exact second state.

The final two output lines are read-only checks of the two revealed production
samples:

```text
completed public prize: Cafe Classico Helmet
ongoing public prize: Weekend Rider Gear Package
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

The provisioner command emits one JSON receipt. The enclosing runbook then emits
the two read-only public-contract lines above. Neither output contains
credentials, connection strings, sessions, claim payloads, or encryption keys.
Example receipt without live IDs:

```json
{
  "eventId": "<event-id>",
  "completed": {
    "giveawayId": "<completed-giveaway-id>",
    "title": "Cafe Classico Helmet Raffle",
    "state": "completed",
    "winnerCount": 1,
    "winnerAlias": "Raffle Sample Rider"
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
