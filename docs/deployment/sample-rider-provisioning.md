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
npm run provision:sample-rider -- -- --confirm-production -- --manifest .codex/generated/sample-rider/manifest.json
```

The direct `tsx` alternative also preserves both tokens:

```powershell
$env:TAMBIKE_SAMPLE_RIDER_PASSWORD = Read-Host "Sample rider password"
npx tsx --conditions=react-server scripts/provision-sample-rider.ts --confirm-production --manifest .codex/generated/sample-rider/manifest.json
```

Do not store the password in the manifest, shell history, repository, or Vercel environment. Remove it from the current shell after the two required idempotency runs.

## Expected output

The command emits one JSON object containing only the stable profile slug, event ID, and exact entity counts:

```json
{"slug":"mika-santos-sample-rider","eventId":"tambike-cafe-classico","riders":1,"motorcycles":1,"avatars":1,"motorcyclePhotos":5,"rsvps":1,"passes":1}
```

It never prints the password, hash, database URL, storage keys, signed URLs, bucket, or AWS configuration. Failures print one stable code. Any failure after mutation triggers snapshot compensation before the cross-process advisory lock is released.
