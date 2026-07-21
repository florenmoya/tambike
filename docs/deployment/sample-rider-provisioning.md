# Production sample rider provisioning

This command is intentionally separate from the general Prisma seed. Run it only after the production infrastructure, migration, generated sample images, and release checks are complete.

## Windows npm 10 command

On this workstation, npm 10 consumes unknown named options after its first `--` as `npm_config_*` environment variables. Tambike never accepts production confirmation from environment variables, so the shorter planned spelling fails closed with `PRODUCTION_CONFIRMATION_REQUIRED`:

```powershell
npm run provision:sample-rider -- --confirm-production --manifest .codex/generated/sample-rider/manifest.json
```

Use explicit npm argument sentinels so the child process receives the literal confirmation and manifest tokens:

```powershell
$env:TAMBIKE_SAMPLE_RIDER_PASSWORD = Read-Host "Sample rider password"
$env:DIRECT_URL = Read-Host "Direct PostgreSQL URL"
npm run provision:sample-rider -- -- --confirm-production -- --manifest .codex/generated/sample-rider/manifest.json
```

The direct `tsx` alternative also preserves both tokens:

```powershell
$env:TAMBIKE_SAMPLE_RIDER_PASSWORD = Read-Host "Sample rider password"
$env:DIRECT_URL = Read-Host "Direct PostgreSQL URL"
npx tsx --conditions=react-server scripts/provision-sample-rider.ts --confirm-production --manifest .codex/generated/sample-rider/manifest.json
```

`DATABASE_URL` remains the application runtime connection. `DIRECT_URL` is separately required for the whole-operation PostgreSQL advisory lock and must be a direct, session-persistent PostgreSQL connection. The command rejects missing or malformed values and known transaction-pool indicators, including PgBouncer flags, pooler hostnames, transaction pool mode, and port `6543`. Never substitute the runtime/PgBouncer URL for `DIRECT_URL`.

Do not store the password or direct URL in the manifest, shell history, or repository. The password must not be added to Vercel. If the deployment already manages `DIRECT_URL` as a protected server-side secret, retrieve it through the approved secret workflow; otherwise provide it only to this process. Remove both values from the current shell after the two required idempotency runs:

```powershell
Remove-Item Env:TAMBIKE_SAMPLE_RIDER_PASSWORD
Remove-Item Env:DIRECT_URL
```

## Expected output

The command emits one JSON object containing only the stable profile slug, event ID, and exact entity counts:

```json
{"slug":"mika-santos-sample-rider","eventId":"tambike-cafe-classico","riders":1,"motorcycles":1,"avatars":1,"motorcyclePhotos":5,"rsvps":1,"passes":1}
```

It never prints the password, hash, database URL, storage keys, signed URLs, bucket, or AWS configuration. Failures print one stable code. Any failure after mutation triggers snapshot compensation before the cross-process advisory lock is released.

Compensation restores the captured database and media state, and tracks every temporary and generated final object key so an object written before a persistence error is not orphaned. Each restore, object cleanup, advisory unlock, and connection-close step is tried at most three times; later recovery steps still run if an earlier step fails. If any recovery step remains unsuccessful, the only public error is `PROVISION_COMPENSATION_FAILED`. Treat that code as requiring an operator audit before retrying: verify the sample rider rows and the sample rider's `tmp/users/...` and `media/users/...` objects against the pre-run snapshot. Internal aggregate errors retain the primary failure and all failed recovery attempts for trusted logs, but the CLI never prints their messages or object keys.
