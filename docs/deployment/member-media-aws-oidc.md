# Tambike Member Media on AWS with Vercel OIDC

This stack creates a private S3 bucket and a least-privilege IAM role for Tambike's Vercel Functions. Vercel exchanges its OIDC token for short-lived AWS credentials; do not create or store persistent AWS access keys.

The template is region-independent. Deploy the stack itself in Singapore and set the application value exactly to `AWS_REGION=ap-southeast-1`.

Official references:

- [Vercel OIDC for AWS](https://vercel.com/docs/oidc/aws)
- [Vercel OIDC token claims](https://vercel.com/docs/oidc/reference)
- [AWS CloudFormation S3 bucket reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-s3-bucket.html)
- [AWS CloudFormation IAM OIDC provider reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-iam-oidcprovider.html)
- [AWS CloudFront Origin Access Control](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)
- [AWS CloudFront signed URLs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-signed-urls.html)

## Preconditions and identity checks

Use Vercel's **team issuer** mode for the exact team that owns Tambike. The issuer is `https://oidc.vercel.com/<team-slug>`, the audience is `https://vercel.com/<team-slug>`, and the production subject is `owner:<team-slug>:project:<project-name>:environment:production`.

Install the required Vercel CLI and record the version before any identity or project check:

```powershell
npm i -g vercel
vercel --version
```

This checkout can be intentionally unlinked. Inspect it before any Vercel command:

```powershell
Test-Path .vercel/project.json
if (Test-Path .vercel/project.json) { Get-Content -Raw .vercel/project.json }
vercel whoami
vercel teams ls
vercel project inspect <expected-project-name> --scope <expected-team-slug>
```

Confirm all of these before continuing:

1. `vercel whoami` is authenticated as the intended account.
2. The selected team slug exactly matches `VercelTeamSlug`.
3. `.vercel/project.json`, if present, identifies the expected Tambike project.
4. `vercel project inspect` reports the exact `VercelProjectName` in that team.
5. The project's Security settings use team issuer mode.

Do not run `vercel link`, `vercel env pull`, `vercel env run`, or another project-scoped command from an unlinked checkout merely to discover values. Those commands can create or change local linkage. Link only as a separate, explicitly approved operation after the expected team and project are known.

## Validate and deploy the CloudFormation stack

Use a dedicated AWS account or role with permission to manage this stack. Confirm the caller and region first:

```powershell
aws sts get-caller-identity
aws configure get region
aws cloudformation validate-template `
  --region ap-southeast-1 `
  --template-body file://infra/aws/tambike-member-media.yaml
```

If the AWS account already has the team's Vercel OIDC provider, obtain its exact ARN and pass `ExistingOidcProviderArn`. Otherwise leave it empty and this stack creates `https://oidc.vercel.com/<team-slug>`. An AWS account can have only one OIDC provider for a given issuer URL. The parameter only selects create-versus-existing behavior; it is never used as the role principal.

Before using an existing provider, prove that its ARN equals the exact current partition, account, and team-derived ARN:

```powershell
$VercelTeamSlug = "<exact-team-slug>"
$ExistingOidcProviderArn = "<provider-arn-from-iam>"
$Caller = aws sts get-caller-identity | ConvertFrom-Json
$Partition = ($Caller.Arn -split ":")[1]
$ExpectedOidcProviderArn = "arn:${Partition}:iam::$($Caller.Account):oidc-provider/oidc.vercel.com/$VercelTeamSlug"
if ($ExistingOidcProviderArn -ne $ExpectedOidcProviderArn) {
  throw "SMOKE_REFUSED: existing provider ARN does not match the current account and exact Vercel team issuer"
}
aws iam get-open-id-connect-provider --open-id-connect-provider-arn $ExpectedOidcProviderArn
```

The final command must report the URL `oidc.vercel.com/<exact-team-slug>` and audience `https://vercel.com/<exact-team-slug>`. A mismatched parameter cannot change the stack's derived IAM principal; deployment fails safely if the exact provider does not exist.

Generate a dedicated RSA 2048 CloudFront signing key in a unique operating-system temporary directory outside the repository. Do not print, paste into source control, or place the private key in the checkout:

```powershell
$CdnKeyDir = Join-Path ([IO.Path]::GetTempPath()) ("tambike-cloudfront-" + [guid]::NewGuid().ToString())
$null = New-Item -ItemType Directory -Path $CdnKeyDir
$CdnPrivateKeyPath = Join-Path $CdnKeyDir "private.pem"
$CdnPublicKeyPath = Join-Path $CdnKeyDir "public.pem"

& openssl genrsa -out $CdnPrivateKeyPath 2048
if ($LASTEXITCODE -ne 0) { throw "CloudFront private-key generation failed" }
& openssl rsa -pubout -in $CdnPrivateKeyPath -out $CdnPublicKeyPath
if ($LASTEXITCODE -ne 0) { throw "CloudFront public-key derivation failed" }

$CloudFrontPublicKeyEncoded = Get-Content -Raw -LiteralPath $CdnPublicKeyPath
if (
  $CloudFrontPublicKeyEncoded -notmatch "-----BEGIN PUBLIC KEY-----" -or
  -not (Test-Path -LiteralPath $CdnPrivateKeyPath)
) {
  throw "CloudFront key files are incomplete"
}
```

`CloudFrontPublicKeyEncoded` is the public PEM only. It is safe to pass to CloudFormation. The private PEM remains only in the temporary directory until it is encoded directly for the Vercel production secret below.

Create or update the production stack with exact values. After the non-production gate below has created the provider, always pass its retained exact ARN; this prevents a duplicate provider from being created:

```powershell
aws cloudformation deploy `
  --region ap-southeast-1 `
  --stack-name tambike-member-media `
  --template-file infra/aws/tambike-member-media.yaml `
  --capabilities CAPABILITY_IAM `
  --parameter-overrides `
    VercelTeamSlug=<exact-team-slug> `
    VercelProjectName=<exact-project-name> `
    AllowedOrigin=https://<exact-tambike-origin> `
    ExistingOidcProviderArn=<retained-exact-provider-arn> `
    EnablePreviewAccess=false `
    CloudFrontPublicKeyEncoded="$CloudFrontPublicKeyEncoded" `
  --no-fail-on-empty-changeset
```

Do not leave `ExistingOidcProviderArn` empty after the non-production gate. The retained provider is team-owned infrastructure, while the disposable smoke stack owns only its test bucket and per-run role.

`EnablePreviewAccess=false` is the default and authorizes production only. Set it to `true` only after approving preview access for this exact project; the template adds only the exact `environment:preview` subject and never uses a project wildcard.

Read outputs and inspect the deployed policy before configuring the app:

```powershell
$StackOutputs = aws cloudformation describe-stacks `
  --region ap-southeast-1 `
  --stack-name tambike-member-media `
  --query "Stacks[0].Outputs" | ConvertFrom-Json
$MemberMediaDistributionDomainName = (
  $StackOutputs | Where-Object OutputKey -eq "MemberMediaDistributionDomainName"
).OutputValue
$MemberMediaCloudFrontPublicKeyId = (
  $StackOutputs | Where-Object OutputKey -eq "MemberMediaCloudFrontPublicKeyId"
).OutputValue
if (-not $MemberMediaDistributionDomainName -or -not $MemberMediaCloudFrontPublicKeyId) {
  throw "CloudFront outputs are incomplete"
}
aws iam get-role --role-name <role-name-from-stack-resources>
```

The dedicated distribution uses an Origin Access Control to sign S3 origin requests. Its trusted key group requires a Tambike signed URL from the application; the S3 bucket stays private and grants CloudFront only `s3:GetObject` under `media/*` for this exact distribution. The cache policy ignores signed query parameters in the cache key and keeps successful immutable WebP objects warm for one day by default.

The bucket is retained if the stack is deleted. It blocks public access, uses SSE-S3, enables versioning, expires `tmp/` objects after one day, and allows browser CORS POSTs only from `AllowedOrigin`.

Final `media/` objects remain private and versioned. When the application deletes or replaces one, S3 retains its noncurrent version for 30 days, then expires it; expired delete markers are removed separately. This bounded recovery window prevents versioning from retaining removed member bytes indefinitely without weakening public-access controls.

Application cleanup is backed by a durable cleanup intent. A final key is registered before its S3 write, and the metadata transaction atomically removes that provisional intent while enqueueing the temporary and replaced keys. Explicit removal also enqueues its key in the same transaction that clears metadata. Cleanup treats `NoSuchKey` as success and never lists S3 or derives deletion targets from bucket contents. Once a media mutation commits, an S3 cleanup failure remains queued and does not turn that successful user operation into an error.

The root `vercel.json` invokes `/api/jobs/member-media-cleanup` once daily at `03:00` UTC. Configure `CRON_SECRET` in the production Vercel environment; Vercel Cron sends it as the exact `Authorization: Bearer $CRON_SECRET` header. The dynamic Node.js route has no query-secret fallback and returns only batch, claim, deletion, and failure counts with `Cache-Control: no-store`.

Each worker invocation processes bounded batches: at most five batches of ten leased intents. Concurrent workers use claim tokens and `FOR UPDATE SKIP LOCKED`, while expired leases are reclaimable. A non-`NoSuchKey` failure increments the durable attempt count, releases its lease, and schedules deterministic exponential retry starting at one minute and capped at 24 hours. Moving failed rows forward prevents old poison entries from starving newer due cleanup. Provisional final-object intents become independently eligible after their 15-minute abandonment guard even if no rider performs another media mutation.

## Configure Vercel environments

Use only the CloudFormation outputs, the generated private key, and the pinned region:

```text
AWS_REGION=ap-southeast-1
AWS_ROLE_ARN=<VercelRoleArn output>
S3_BUCKET_NAME=<BucketName output>
MEMBER_MEDIA_CLOUDFRONT_DOMAIN=<MemberMediaDistributionDomainName output>
MEMBER_MEDIA_CLOUDFRONT_PUBLIC_KEY_ID=<MemberMediaCloudFrontPublicKeyId output>
MEMBER_MEDIA_CLOUDFRONT_PRIVATE_KEY_BASE64=<base64 private PEM, never print>
MEMBER_MEDIA_CLOUDFRONT_URL_TTL_SECONDS=300
```

After rechecking the linked project and scope, add each value to production with `vercel env add <NAME> production --scope <expected-team-slug>`. Use `vercel env ls --scope <expected-team-slug>` to verify names and targets. The values are configuration, not persistent AWS credentials; never add long-lived access keys.

Encode the private PEM in memory, pipe every value through standard input, and do not echo the private value or include it in shell history:

```powershell
$ExpectedVercelTeamSlug = "<expected-team-slug>"
$CdnPrivateKeyBase64 = [Convert]::ToBase64String(
  [IO.File]::ReadAllBytes($CdnPrivateKeyPath)
)

$MemberMediaDistributionDomainName |
  vercel env add MEMBER_MEDIA_CLOUDFRONT_DOMAIN production --scope $ExpectedVercelTeamSlug
$MemberMediaCloudFrontPublicKeyId |
  vercel env add MEMBER_MEDIA_CLOUDFRONT_PUBLIC_KEY_ID production --scope $ExpectedVercelTeamSlug
$CdnPrivateKeyBase64 |
  vercel env add MEMBER_MEDIA_CLOUDFRONT_PRIVATE_KEY_BASE64 production --scope $ExpectedVercelTeamSlug
"300" |
  vercel env add MEMBER_MEDIA_CLOUDFRONT_URL_TTL_SECONDS production --scope $ExpectedVercelTeamSlug

$CdnPrivateKeyBase64 = $null
vercel env ls --scope $ExpectedVercelTeamSlug
```

The application enables CloudFront only when all four values are valid. If they are absent, `/media/{mediaId}` keeps using the existing private S3 streaming path. A partial or malformed configuration fails closed with the same private `404` response as unauthorized media.

If preview access was explicitly enabled in the stack, add the same three AWS names to preview separately with `vercel env add <NAME> preview --scope <expected-team-slug>`. Do not add preview variables while the trust policy remains production-only.

## Verify signed delivery and caching

Wait for the CloudFront distribution and the new Vercel production deployment to report deployed and ready. An unsigned request directly to any path on `https://<MemberMediaDistributionDomainName>/media/...` must return `403`; a `200` means the private-content boundary is broken and the rollout must stop.

Use a member media ID that the test viewer is authorized to see, without logging its redirected query string:

1. Request `https://tambike.bayanko.ph/media/<authorized-media-id>` without following redirects. It must return `307`, `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, and a `Location` hosted by `MemberMediaDistributionDomainName`.
2. Follow that redirect without printing the signed URL. The image must return `200` and `Content-Type: image/webp`.
3. Repeat the authorized request and follow it again. The first CloudFront response may be `X-Cache: Miss from cloudfront`; the warm response must become `X-Cache: Hit from cloudfront` with a positive `Age`.
4. Test a private media ID as an unauthorized or signed-out viewer. The stable app route must remain `404` and must not disclose a CloudFront URL or S3 key.

Do not treat a fast browser render alone as proof. Record status, host, `X-Cache`, `Age`, content type, and transfer time while redacting the complete signed URL.

## Rollback and recovery

CloudFormation automatically attempts rollback after a failed create or update. Inspect events before retrying:

```powershell
aws cloudformation describe-stack-events `
  --region ap-southeast-1 `
  --stack-name tambike-member-media
```

If an update is stuck in `UPDATE_ROLLBACK_FAILED`, continue rollback after correcting the reported dependency:

```powershell
aws cloudformation continue-update-rollback `
  --region ap-southeast-1 `
  --stack-name tambike-member-media
```

For an explicitly requested rollback of an eligible stack operation, use:

```powershell
aws cloudformation rollback-stack `
  --region ap-southeast-1 `
  --stack-name tambike-member-media
```

Do not delete the retained bucket as part of stack recovery. Re-run `describe-stack-events`, verify the exact team/project trust conditions, then deploy the corrected template normally.

For an application-level CDN rollback, remove all four `MEMBER_MEDIA_CLOUDFRONT_*` production variables together and redeploy the last known-good application commit. The built-in direct S3 stream fallback then remains the authorized delivery path. Do not remove the CloudFront key group, public key, distribution, Origin Access Control, or bucket policy until that fallback has been verified in production; infrastructure removal is a separate approved stack change.

For key rotation, preserve overlap:

1. Generate a new key pair in a new unique temporary directory.
2. Add the new public key to the trusted key group while the old public key remains trusted.
3. Deploy the new `MEMBER_MEDIA_CLOUDFRONT_PUBLIC_KEY_ID` and `MEMBER_MEDIA_CLOUDFRONT_PRIVATE_KEY_BASE64`.
4. Verify new signed URLs and warm cache hits in production.
5. Wait at least the old five-minute signed URL lifetime plus CloudFront propagation.
6. Then remove the old public key from the key group.

Never replace and revoke the only trusted key in one step. A rotation requires a temporary two-key CloudFormation update so in-flight signed URLs remain valid.

After production verification succeeds and Vercel lists all four production variable names, erase only the exact generated temporary key directory. Validate that its resolved path is a uniquely named child of the operating-system temp directory before recursive deletion:

```powershell
$ResolvedCdnKeyDir = [IO.Path]::GetFullPath($CdnKeyDir)
$ResolvedTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$CdnKeyLeaf = Split-Path -Leaf $ResolvedCdnKeyDir
if (
  -not $ResolvedCdnKeyDir.StartsWith($ResolvedTempRoot, [StringComparison]::OrdinalIgnoreCase) -or
  -not $CdnKeyLeaf.StartsWith("tambike-cloudfront-", [StringComparison]::Ordinal)
) {
  throw "Refusing to remove an unverified CloudFront key directory"
}
Remove-Item -LiteralPath $ResolvedCdnKeyDir -Recurse -Force
```

The Vercel secret remains the active signing copy. A deleted private key cannot be recovered from CloudFront; generate a new pair and use the overlap procedure for future key rotation.

## Deploy and run the disposable non-production S3 smoke gate

This is the required gate before production. It deploys only `tambike-member-media-nonprod` in `ap-southeast-1`, creates a bucket and role whose names identify them as non-production, and binds that role to the exact Vercel development subject. Do not reuse a production bucket, role, prefix, or run ID.

Run this from the verified Tambike project context described above. Generate the run ID once, then use that same value for both the CloudFormation policy and the smoke process:

```powershell
$VercelTeamSlug = "florens-projects-aee3ca73"
$VercelProjectName = "tambike"
$SmokeStackName = "tambike-member-media-nonprod"
$SmokeBasePrefix = "member-media"
$SmokeRunId = "$(Get-Date -Format yyyyMMddHHmmss)-$([guid]::NewGuid().ToString())"
$Caller = aws sts get-caller-identity | ConvertFrom-Json
$Partition = ($Caller.Arn -split ":")[1]
$SmokeOidcProviderArn = "arn:${Partition}:iam::$($Caller.Account):oidc-provider/oidc.vercel.com/$VercelTeamSlug"

aws cloudformation validate-template `
  --region ap-southeast-1 `
  --template-body file://infra/aws/tambike-member-media-smoke.yaml

$ExistingOidcProviderArn = ""
aws iam get-open-id-connect-provider --open-id-connect-provider-arn $SmokeOidcProviderArn 2>$null
if ($LASTEXITCODE -eq 0) {
  $ExistingOidcProviderArn = $SmokeOidcProviderArn
  $Provider = aws iam get-open-id-connect-provider --open-id-connect-provider-arn $SmokeOidcProviderArn | ConvertFrom-Json
  if ($Provider.Url -ne "oidc.vercel.com/$VercelTeamSlug" -or $Provider.ClientIDList -notcontains "https://vercel.com/$VercelTeamSlug") {
    throw "SMOKE_REFUSED: existing provider is not the exact Tambike team OIDC provider"
  }
}

aws cloudformation deploy `
  --region ap-southeast-1 `
  --stack-name $SmokeStackName `
  --template-file infra/aws/tambike-member-media-smoke.yaml `
  --capabilities CAPABILITY_NAMED_IAM `
  --parameter-overrides `
    VercelTeamSlug=$VercelTeamSlug `
    VercelProjectName=$VercelProjectName `
    ExistingOidcProviderArn=$ExistingOidcProviderArn `
    SmokeBasePrefix=$SmokeBasePrefix `
    SmokeRunId=$SmokeRunId `
  --no-fail-on-empty-changeset

$SmokeOutputs = aws cloudformation describe-stacks `
  --region ap-southeast-1 `
  --stack-name $SmokeStackName `
  --query "Stacks[0].Outputs" | ConvertFrom-Json
$SmokeBucketName = ($SmokeOutputs | Where-Object OutputKey -eq "SmokeBucketName").OutputValue
$SmokeRoleArn = ($SmokeOutputs | Where-Object OutputKey -eq "SmokeRoleArn").OutputValue
$SmokeOidcProviderArn = ($SmokeOutputs | Where-Object OutputKey -eq "SmokeOidcProviderArn").OutputValue
if (-not $SmokeBucketName -or -not $SmokeRoleArn -or -not $SmokeOidcProviderArn) {
  throw "SMOKE_REFUSED: non-production stack did not return all smoke outputs"
}
```

When no provider exists, the smoke stack creates it with `DeletionPolicy: Retain`. The retained Vercel OIDC provider survives deletion of the disposable stack, and production must use `ExistingOidcProviderArn=$SmokeOidcProviderArn` as shown above. This ownership rule means smoke-stack deletion cannot remove a provider later reused by production.

Obtain the short-lived development token through Vercel without writing, decoding, or printing it. The splatted `vercel env run` invocation below has been verified to inject an unquoted `VERCEL_OIDC_TOKEN` with the exact development subject `owner:florens-projects-aee3ca73:project:tambike:environment:development`:

```powershell
$env:AWS_REGION = "ap-southeast-1"
$env:MEMBER_MEDIA_SMOKE_BUCKET_NAME = $SmokeBucketName
$env:MEMBER_MEDIA_SMOKE_ROLE_ARN = $SmokeRoleArn
$env:MEMBER_MEDIA_SMOKE_PREFIX = "smoke/member-media"
$env:MEMBER_MEDIA_SMOKE_RUN_ID = $SmokeRunId
$env:MEMBER_MEDIA_SMOKE_CONFIRM = "I_UNDERSTAND_THIS_USES_A_TEST_BUCKET"
$VercelArgs = @('env', 'run', '--environment', 'preview', '--project', 'tambike', '--', 'npm', 'run', 'smoke:member-media-s3')
& vercel @VercelArgs
```

The smoke script accepts only the exact timestamp-plus-RFC-4122-UUID run namespace. Its test role has only `s3:PutObject`, `s3:GetObject`, and `s3:DeleteObject` for `smoke/<base>/<run>/tmp/*` and `smoke/<base>/<run>/media/*`; it has no bucket listing, production `tmp/*` or `media/*`, or other AWS action. Before cleanup, the script sends a raw anonymous request against the exact finalized object it just stored and requires S3 to return `403`; a `200` or any other status fails the gate while exact-key cleanup still runs.

After the smoke, delete only the disposable stack. The smoke bucket is retained because a versioned bucket can retain previous object versions and delete markers after the script has cleaned its exact current keys; CloudFormation cannot safely empty those versions. The retained smoke bucket is still dedicated and disposable. If it needs removal after the stack is gone, empty only this output-derived dedicated test bucket and delete that bucket explicitly. Never substitute a production bucket name:

```powershell
aws cloudformation delete-stack --region ap-southeast-1 --stack-name $SmokeStackName
aws cloudformation wait stack-delete-complete --region ap-southeast-1 --stack-name $SmokeStackName

# The retained smoke bucket cleanup below is allowed only after confirming
# $SmokeBucketName came from SmokeBucketName above.
aws s3 rm "s3://$SmokeBucketName" --recursive
$VersionedObjects = aws s3api list-object-versions --bucket $SmokeBucketName | ConvertFrom-Json
$DeleteVersions = @($VersionedObjects.Versions) + @($VersionedObjects.DeleteMarkers) | ForEach-Object {
  @{ Key = $_.Key; VersionId = $_.VersionId }
}
if ($DeleteVersions.Count -gt 0) {
  $DeletePayload = @{ Objects = $DeleteVersions; Quiet = $true } | ConvertTo-Json -Compress
  aws s3api delete-objects --bucket $SmokeBucketName --delete $DeletePayload
}
aws s3api delete-bucket --bucket $SmokeBucketName --region ap-southeast-1
```

## Repeat runs and output-less failed-create recovery

The smoke bucket intentionally has no fixed `BucketName`. CloudFormation generates a unique physical name from the `tambike-member-media-nonprod` stack and short `Bucket` logical resource, preserving the delimiter-bounded `nonprod` marker that the smoke safety check requires. A completed stack deletion followed by a fresh `SmokeRunId` supports the next run without a global-name collision. Always use a new run ID and deploy the same `$SmokeStackName` only after the prior stack is deleted.

If create fails before stack outputs are available, do not guess a bucket name or scan the account. This output-less failed-create recovery is bounded by the same stack-derived `Bucket` physical ID and the exact `SmokeRunId` tag supplied to that failed deployment:

```powershell
$FailedBucketName = aws cloudformation describe-stack-resources `
  --region ap-southeast-1 `
  --stack-name $SmokeStackName `
  --query "StackResources[?LogicalResourceId=='Bucket'].PhysicalResourceId | [0]" `
  --output text
if ([string]::IsNullOrWhiteSpace($FailedBucketName) -or $FailedBucketName -eq "None") {
  throw "SMOKE_REFUSED: no stack-derived smoke bucket is available for recovery"
}
$FailedBucketTags = (aws s3api get-bucket-tagging --bucket $FailedBucketName | ConvertFrom-Json).TagSet
if (-not ($FailedBucketTags | Where-Object { $_.Key -eq "SmokeRunId" -and $_.Value -eq $SmokeRunId })) {
  throw "SMOKE_REFUSED: recovered bucket does not have the exact failed smoke run tag"
}
$SmokeBucketName = $FailedBucketName

# Only after both the logical resource and exact SmokeRunId tag checks above,
# run the retained smoke bucket cleanup block from the previous section.
```

Do not delete the retained Vercel OIDC provider with the smoke stack. Once production has adopted its exact ARN, treat it as shared team infrastructure and manage it only through an explicitly approved lifecycle change. The retained smoke bucket is not shared infrastructure: remove it only through the output-derived cleanup above.
