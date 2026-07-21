# Tambike Member Media on AWS with Vercel OIDC

This stack creates a private S3 bucket and a least-privilege IAM role for Tambike's Vercel Functions. Vercel exchanges its OIDC token for short-lived AWS credentials; do not create or store persistent AWS access keys.

The template is region-independent. Deploy the stack itself in Singapore and set the application value exactly to `AWS_REGION=ap-southeast-1`.

Official references:

- [Vercel OIDC for AWS](https://vercel.com/docs/oidc/aws)
- [Vercel OIDC token claims](https://vercel.com/docs/oidc/reference)
- [AWS CloudFormation S3 bucket reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-s3-bucket.html)
- [AWS CloudFormation IAM OIDC provider reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-iam-oidcprovider.html)

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

Do not run `vercel link`, `vercel env pull`, or another project-scoped command from an unlinked checkout merely to discover values. Those commands can create or change local linkage. Link only as a separate, explicitly approved operation after the expected team and project are known.

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

Create or update the stack with exact values:

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
    EnablePreviewAccess=false `
  --no-fail-on-empty-changeset
```

That command leaves `ExistingOidcProviderArn` at its empty default and creates the provider. If the exact team issuer already exists, add `ExistingOidcProviderArn=<verified-provider-arn>` to `--parameter-overrides` instead.

`EnablePreviewAccess=false` is the default and authorizes production only. Set it to `true` only after approving preview access for this exact project; the template adds only the exact `environment:preview` subject and never uses a project wildcard.

Read outputs and inspect the deployed policy before configuring the app:

```powershell
aws cloudformation describe-stacks `
  --region ap-southeast-1 `
  --stack-name tambike-member-media `
  --query "Stacks[0].Outputs"
aws iam get-role --role-name <role-name-from-stack-resources>
```

The bucket is retained if the stack is deleted. It blocks public access, uses SSE-S3, enables versioning, expires `tmp/` objects after one day, and allows browser CORS POSTs only from `AllowedOrigin`.

## Configure Vercel environments

Use only the CloudFormation outputs and the pinned region:

```text
AWS_REGION=ap-southeast-1
AWS_ROLE_ARN=<VercelRoleArn output>
S3_BUCKET_NAME=<BucketName output>
```

After rechecking the linked project and scope, add each value to production with `vercel env add <NAME> production --scope <expected-team-slug>`. Use `vercel env ls --scope <expected-team-slug>` to verify names and targets. The values are configuration, not persistent AWS credentials; never add long-lived access keys.

If preview access was explicitly enabled in the stack, add the same three names to preview separately with `vercel env add <NAME> preview --scope <expected-team-slug>`. Do not add preview variables while the trust policy remains production-only.

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

## Real S3 smoke gate

The smoke command is intentionally unavailable through ambient production variables. It requires a dedicated bucket and role whose names identify them as `test`, `smoke`, or `nonprod`, plus a non-production prefix beginning with `smoke/`:

```powershell
$env:AWS_REGION = "ap-southeast-1"
$env:MEMBER_MEDIA_SMOKE_BUCKET_NAME = "<dedicated-test-bucket>"
$env:MEMBER_MEDIA_SMOKE_ROLE_ARN = "<dedicated-test-role-arn>"
$env:MEMBER_MEDIA_SMOKE_PREFIX = "smoke/member-media"
$env:MEMBER_MEDIA_SMOKE_RUN_ID = "$(Get-Date -Format yyyyMMddHHmmss)-$([guid]::NewGuid())"
$env:MEMBER_MEDIA_SMOKE_CONFIRM = "I_UNDERSTAND_THIS_USES_A_TEST_BUCKET"
npm run smoke:member-media-s3
```

The role must be assumable by the current test OIDC token. Run from an explicitly linked, verified test Vercel context (for example, through `vercel env run` only after the identity/link checks above), or supply a short-lived `VERCEL_OIDC_TOKEN` through an approved test workflow. `MEMBER_MEDIA_SMOKE_RUN_ID` predeclares the unique run namespace so the role policy can be bounded before execution; the command rejects any value that is not a 14-digit timestamp plus UUID. The script creates exact keys under the supplied `smoke/` prefix and run ID, exercises the real presigned POST and application normalization/read path, and deletes only those run-owned keys. It refuses production-looking buckets, roles, prefixes, and run IDs.

The dedicated test role must not reuse the production role policy. Give it only these object permissions, replacing the bucket, base, and run placeholders for the bounded smoke execution:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::<dedicated-test-bucket>/smoke/<base>/<run>/tmp/*",
        "arn:aws:s3:::<dedicated-test-bucket>/smoke/<base>/<run>/media/*"
      ]
    }
  ]
}
```

Replace `<run>` with the exact `MEMBER_MEDIA_SMOKE_RUN_ID` value before attaching the policy. Do not add `s3:ListBucket`, a bucket-wide object wildcard, another prefix, or any other S3 action. Prepare the bounded test policy for that exact run through the approved test workflow; never broaden it to production `tmp/*` or `media/*`.
