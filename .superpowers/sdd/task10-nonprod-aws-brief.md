# Task 10 release fix: deployable bounded non-production AWS smoke stack

## Context

Task 10 requires a non-production AWS deployment and real S3 smoke before the production stack. The checked-in production template grants only `tmp/*` and `media/*`, while the smoke tool writes only inside `smoke/<base>/<run>/{tmp,media}/*` and refuses production-looking resources. Current Vercel behavior was verified locally: the PowerShell-splatted `vercel env run` command injects an unquoted OIDC token into the spawned smoke process with exact subject `owner:florens-projects-aee3ca73:project:tambike:environment:development`; it does not write a dotenv token file.

## Required implementation

Follow test-driven development: first add/extend a server contract test that fails because the bounded non-production template/guide does not exist, run it and record the failure, then implement the minimum fix and rerun it.

1. Add a separate CloudFormation template for the real smoke gate, preferably `infra/aws/tambike-member-media-smoke.yaml`.
2. It must be deployed in `ap-southeast-1` under a stack name containing `nonprod`, `smoke`, or `test`, and its generated bucket and role names must also contain one of those markers so `validateSmokeConfiguration` accepts them.
3. Parameters must include exact `VercelTeamSlug`, `VercelProjectName`, `ExistingOidcProviderArn`, a safe smoke base prefix, and an exact smoke run ID matching a 14-digit timestamp plus RFC 4122 UUID. An exact HTTPS allowed origin parameter may be included for CORS parity.
4. The role trust must use the exact team OIDC provider, exact audience, and exact development subject only: `owner:<team>:project:<project>:environment:development`. No project or environment wildcard.
5. The role policy must allow only `s3:PutObject`, `s3:GetObject`, and `s3:DeleteObject` on exactly these run-bounded resources:
   - `<bucket>/smoke/<base>/<run>/tmp/*`
   - `<bucket>/smoke/<base>/<run>/media/*`
   It must not grant `ListBucket`, bucket-wide wildcards, production `tmp/*`/`media/*`, or any other AWS action.
6. The bucket must remain private with all public-access blocks, bucket-owner enforcement, SSE-S3, versioning, and short-lived noncurrent/temp smoke lifecycle behavior. Use `DeletionPolicy: Delete` for the disposable non-production bucket only if CloudFormation can clean it after the smoke; otherwise document exact safe cleanup and retain behavior. Do not weaken the existing production template.
7. Outputs must include the test bucket name and test role ARN for `MEMBER_MEDIA_SMOKE_BUCKET_NAME` and `MEMBER_MEDIA_SMOKE_ROLE_ARN`.
8. Update `docs/deployment/member-media-aws-oidc.md` with an exact PowerShell workflow that:
   - generates the run ID once;
   - validates and deploys a dedicated `tambike-member-media-nonprod` stack using the new template and the verified existing team OIDC provider when present;
   - obtains a short-lived local development `VERCEL_OIDC_TOKEN` only through the verified PowerShell-splatted command `$VercelArgs = @('env', 'run', '--environment', 'preview', '--project', 'tambike', '--', 'npm', 'run', 'smoke:member-media-s3'); & vercel @VercelArgs`, without printing the token or writing/reading a dotenv token file; do not use `vercel env pull` for this smoke;
   - runs `npm run smoke:member-media-s3` with the exact stack outputs, `smoke/member-media` prefix, and confirmation phrase;
   - proves a raw S3 object URL is inaccessible;
   - deletes only the disposable smoke stack after the smoke and documents how to empty only that dedicated test bucket if stack deletion requires it.
9. Extend infrastructure contract tests to prove all constraints above and that the production template remains production-only.
10. Run the focused infrastructure/smoke tests plus `git diff --check`. Commit the fix with a narrow message. Do not deploy AWS, change Vercel, modify databases, merge, or push.

## Global constraints

- Preserve the existing production template and its production-only role policy.
- No static AWS keys; Vercel OIDC only.
- Exact team `florens-projects-aee3ca73`, project `tambike`, region `ap-southeast-1` are deployment values, not hardcoded template defaults.
- Never expose or log the OIDC token.
- Keep all changes scoped to the non-production smoke IaC/docs/tests gap.

## Report contract

Write the complete report to `.superpowers/sdd/task10-nonprod-aws-report.md`: files changed, red test command/output, green test command/output, commit hash, self-review, and any concerns. Return only status, commit, one-line test summary, and concerns to the controller.
