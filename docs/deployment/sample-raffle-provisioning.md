# Production sample raffle provisioning

This command provisions exactly two sample campaigns on the published host event
**Tambike at Cafe Classico** (`tambike-cafe-classico`):

- `Cafe Classico Helmet Raffle` — completed, with one published and fulfilled sample winner
- `Weekend Rider Gear Raffle` — open, with no snapshot, draw, award, or winner

The command is idempotent only when both campaigns already satisfy the complete
final invariants. Any partial or conflicting sample campaign fails closed.

## Read-only preflight

Run these queries against the direct production connection before loading
credentials or invoking the provisioner:

```powershell
psql $env:DIRECT_URL -v ON_ERROR_STOP=1 -c 'SELECT current_database(), current_user;'
psql $env:DIRECT_URL -v ON_ERROR_STOP=1 -c 'SELECT "id", "title", "status" FROM "Event" WHERE "id" = ''tambike-cafe-classico'';'
psql $env:DIRECT_URL -v ON_ERROR_STOP=1 -c 'SELECT "id", "eventId", "title", "status", "complianceStatus" FROM "EventGiveaway" WHERE "eventId" = ''tambike-cafe-classico'' AND "title" IN (''Cafe Classico Helmet Raffle'', ''Weekend Rider Gear Raffle'') ORDER BY "title";'
```

Confirm that the event exists and is `PUBLISHED`. The campaign query must return
either no rows or the already-complete exact pair; do not run the command against
a partial pair.

## Prepare the production environment

The command requires these variable names. Never paste their values into tickets,
chat, logs, or this runbook:

```text
DATABASE_URL or SUPABASE_DATABASE_URL
DIRECT_URL
GIVEAWAY_DRAW_ENCRYPTION_KEY
TAMBIKE_SAMPLE_RAFFLE_ORGANIZER_PASSWORD
TAMBIKE_SAMPLE_RAFFLE_ADMIN_PASSWORD
TAMBIKE_SAMPLE_RAFFLE_WINNER_PASSWORD
```

Install and verify the Vercel CLI:

```powershell
npm i -g vercel
vercel --version
```

Refuse to overwrite an existing local production environment file, then pull the
linked project's production variables:

```powershell
if (Test-Path -LiteralPath '.env.production.local') {
  throw '.env.production.local already exists; move or remove it only after confirming its ownership.'
}
vercel env pull .env.production.local --environment=production
```

Confirm only the required names are present. Do not print their values.

## Execute once

```powershell
npm run provision:sample-raffles -- -- --confirm-production
```

On success, stdout contains one JSON receipt and no credentials, connection
strings, sessions, claim payloads, or encryption keys. Example without live IDs:

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

Immediately remove the temporary environment file after the command exits:

```powershell
Remove-Item -LiteralPath '.env.production.local'
Test-Path -LiteralPath '.env.production.local'
```

The final command must return `False`.

## Read-only postflight

Repeat the preflight campaign query, then inspect only aggregate relational state:

```powershell
psql $env:DIRECT_URL -v ON_ERROR_STOP=1 -c 'SELECT g."title", g."status", g."complianceStatus", COUNT(DISTINCT d."id") AS "drawCount", COUNT(DISTINCT a."id") AS "awardCount" FROM "EventGiveaway" g LEFT JOIN "GiveawayDraw" d ON d."giveawayId" = g."id" LEFT JOIN "GiveawayAward" a ON a."giveawayId" = g."id" WHERE g."eventId" = ''tambike-cafe-classico'' AND g."title" IN (''Cafe Classico Helmet Raffle'', ''Weekend Rider Gear Raffle'') GROUP BY g."id", g."title", g."status", g."complianceStatus" ORDER BY g."title";'
```

Expected shape without live IDs:

```text
Cafe Classico Helmet Raffle | completed | approved | 1 | 1
Weekend Rider Gear Raffle   | open      | approved | 0 | 0
```

Cleanup or deletion requires separate user approval and is not part of this
runbook.
