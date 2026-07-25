# Tambike Private Member Media CloudFront Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve authorized Tambike member-media bytes through a dedicated signed CloudFront distribution backed by the existing private S3 bucket.

**Architecture:** `/media/{mediaId}` remains the stable authorization boundary. After resolving the opaque media ID and applying the existing viewer/profile rules, the route redirects to a five-minute CloudFront signed URL for the private S3 object; absent CDN configuration, it retains the current direct S3 stream. CloudFormation adds a dedicated OAC-backed distribution, trusted key group, cache policy, and exact-source bucket policy without changing the unrelated heatmap distribution.

**Tech Stack:** Next.js 16.2 Route Handlers, TypeScript, Vitest, `@aws-sdk/cloudfront-signer` 3.1095.0, AWS CloudFormation, Amazon CloudFront, private Amazon S3, Vercel production environment variables.

## Global Constraints

- Work directly on `main`; never create an AI/Codex branch or worktree.
- Keep the S3 bucket private and retain its public-access block.
- Preserve every current profile visibility, roster, owner, administrator, publication, and suspension rule.
- Never serialize storage keys through member DTOs, server actions, JSON bodies, logs, or errors.
- Never commit, print, or persist the CloudFront private key inside the repository.
- Use Node.js Route Handlers; do not add Edge runtime declarations.
- Keep direct private streaming as the rollback path when all CDN variables are absent.
- Treat a partial CDN configuration as an operational failure, never as an authorization bypass.
- Leave the unrelated heatmap CloudFront distribution unchanged.

---

### Task 1: Add validated CloudFront signing configuration

**Files:**
- Create: `src/server/member-media/cloudfront.ts`
- Modify: `.env.example`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/server/member-media-cloudfront.test.ts`

**Interfaces:**
- Produces: `loadMemberMediaCloudFrontConfig(env?): MemberMediaCloudFrontConfig | null`
- Produces: `createMemberMediaCloudFrontUrl(storageKey, config, dependencies?): string`
- Consumes later: `src/app/media/[mediaId]/route.ts`

- [ ] **Step 1: Install the pinned signer dependency**

Run:

```powershell
npm install @aws-sdk/cloudfront-signer@3.1095.0
```

Expected: `package.json` and `package-lock.json` include the exact direct dependency.

- [ ] **Step 2: Write failing configuration and signing tests**

Create tests that prove:

```ts
expect(loadMemberMediaCloudFrontConfig({})).toBeNull();

expect(() => loadMemberMediaCloudFrontConfig({
  MEMBER_MEDIA_CLOUDFRONT_DOMAIN: "cdn.example.test",
})).toThrow("MEMBER_MEDIA_CLOUDFRONT_CONFIG");

const config = loadMemberMediaCloudFrontConfig({
  MEMBER_MEDIA_CLOUDFRONT_DOMAIN: "d111111abcdef8.cloudfront.net",
  MEMBER_MEDIA_CLOUDFRONT_PUBLIC_KEY_ID: "K1234567890",
  MEMBER_MEDIA_CLOUDFRONT_PRIVATE_KEY_BASE64:
    Buffer.from("-----BEGIN PRIVATE KEY-----\nprivate\n-----END PRIVATE KEY-----").toString("base64"),
  MEMBER_MEDIA_CLOUDFRONT_URL_TTL_SECONDS: "300",
});

expect(createMemberMediaCloudFrontUrl(
  "media/users/user 1/avatar/media.webp",
  config!,
  {
    now: () => new Date("2026-07-25T00:00:00.000Z"),
    sign: (input) => JSON.stringify(input),
  },
)).toContain("media/users/user%201/avatar/media.webp");
```

Also reject domains with schemes, paths, whitespace, or non-CloudFront hostnames; malformed base64; non-PEM values; and TTLs outside `60..900`.

- [ ] **Step 3: Run the tests and verify RED**

Run:

```powershell
npx vitest run tests/server/member-media-cloudfront.test.ts
```

Expected: FAIL because `src/server/member-media/cloudfront.ts` does not exist.

- [ ] **Step 4: Implement minimal validated signing**

Implement:

```ts
export interface MemberMediaCloudFrontConfig {
  domain: string;
  publicKeyId: string;
  privateKey: string;
  ttlSeconds: number;
}

export function loadMemberMediaCloudFrontConfig(
  env: Record<string, string | undefined> = process.env,
): MemberMediaCloudFrontConfig | null;

export function createMemberMediaCloudFrontUrl(
  storageKey: string,
  config: MemberMediaCloudFrontConfig,
  dependencies?: {
    now?: () => Date;
    sign?: typeof getSignedUrl;
  },
): string;
```

Encode each storage-key path segment independently, use `https://${domain}/...`, pass the configured public key ID and decoded PEM to `getSignedUrl`, and set `dateLessThan` to `now + ttlSeconds`.

- [ ] **Step 5: Document only variable names and safe placeholders**

Add to `.env.example`:

```dotenv
MEMBER_MEDIA_CLOUDFRONT_DOMAIN=""
MEMBER_MEDIA_CLOUDFRONT_PUBLIC_KEY_ID=""
MEMBER_MEDIA_CLOUDFRONT_PRIVATE_KEY_BASE64=""
MEMBER_MEDIA_CLOUDFRONT_URL_TTL_SECONDS="300"
```

- [ ] **Step 6: Run targeted tests and commit**

Run:

```powershell
npx vitest run tests/server/member-media-cloudfront.test.ts
git diff --check
git add package.json package-lock.json .env.example src/server/member-media/cloudfront.ts tests/server/member-media-cloudfront.test.ts
git commit -m "feat: sign private member media CDN URLs"
```

Expected: PASS and a focused commit.

---

### Task 2: Redirect authorized media requests while preserving direct fallback

**Files:**
- Modify: `src/server/backend.ts`
- Modify: `src/server/prisma-backend.ts`
- Modify: `src/app/media/[mediaId]/route.ts`
- Modify: `tests/server/member-media-route-contract.test.ts`
- Modify: `tests/server/member-media-service.test.ts`

**Interfaces:**
- Produces on both backends: `authorizeMemberMedia(sessionToken, mediaId): Promise<AuthorizedMemberMediaDescriptor>`
- Consumes: `loadMemberMediaCloudFrontConfig` and `createMemberMediaCloudFrontUrl`
- Preserves: `getMemberMedia(sessionToken, mediaId): Promise<MemberMediaDelivery>`

- [ ] **Step 1: Write failing backend authorization tests**

Add tests that call `authorizeMemberMedia` directly and prove:

```ts
await expect(
  backend.authorizeMemberMedia(authorizedSession, mediaId),
).resolves.toMatchObject({
  storageKey: expect.stringContaining("media/"),
  mimeType: "image/webp",
});

await expect(
  backend.authorizeMemberMedia(unauthorizedSession, privateMediaId),
).rejects.toMatchObject({ code: "NOT_FOUND" });
```

Verify the method does not call the S3 store.

- [ ] **Step 2: Write failing Route Handler redirect tests**

Extend the handler dependency seam so tests can inject `createCdnUrl`.

Prove an authorized CDN path:

```ts
const response = await handler(
  new Request("https://tambike.test/media/media-1"),
  { params: Promise.resolve({ mediaId: "media-1" }) },
);

expect(response.status).toBe(307);
expect(response.headers.get("Location")).toMatch(
  /^https:\/\/d111111abcdef8\.cloudfront\.net\//,
);
expect(response.headers.get("Cache-Control")).toBe("private, no-store");
expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
```

Keep the existing direct byte-stream test for `createCdnUrl: () => null`. Add signing-failure and unauthorized tests that both return the same private `404`.

- [ ] **Step 3: Run tests and verify RED**

Run:

```powershell
npx vitest run tests/server/member-media-service.test.ts tests/server/member-media-route-contract.test.ts
```

Expected: FAIL because the authorization method and redirect seam are missing.

- [ ] **Step 4: Extract authorization without weakening policy**

In both in-memory and Prisma backends:

```ts
async authorizeMemberMedia(
  sessionToken: string | undefined,
  mediaId: string,
): Promise<AuthorizedMemberMediaDescriptor> {
  return this.resolveMemberMediaDescriptor(sessionToken, mediaId);
}

async getMemberMedia(sessionToken: string | undefined, mediaId: string) {
  const descriptor = await this.authorizeMemberMedia(sessionToken, mediaId);
  return this.memberMedia.read(descriptor);
}
```

The in-memory resolver may remain synchronous internally; the public method stays asynchronous for backend parity.

- [ ] **Step 5: Implement temporary redirect plus direct fallback**

The delivery handler must:

1. read the session,
2. load the backend,
3. load CDN configuration lazily,
4. authorize and sign only when complete CDN configuration exists,
5. return native `Response` status `307` with `Location`, `private, no-store`, and `Referrer-Policy: no-referrer`,
6. otherwise call the unchanged direct streaming method,
7. catch all failures and return the existing hidden `404`.

Do not use `redirect()` inside the `try` block because Next.js implements it by throwing.

- [ ] **Step 6: Run targeted and domain tests, then commit**

Run:

```powershell
npx vitest run tests/server/member-media-cloudfront.test.ts tests/server/member-media-service.test.ts tests/server/member-media-route-contract.test.ts tests/server/member-profile-domain.test.ts tests/server/event-roster-domain.test.ts
git diff --check
git add src/server/backend.ts src/server/prisma-backend.ts src/app/media/[mediaId]/route.ts tests/server/member-media-route-contract.test.ts tests/server/member-media-service.test.ts
git commit -m "feat: redirect authorized media through CloudFront"
```

Expected: all listed suites pass.

---

### Task 3: Define the dedicated private CloudFront distribution

**Files:**
- Modify: `infra/aws/tambike-member-media.yaml`
- Modify: `tests/server/member-media-infra-contract.test.ts`

**Interfaces:**
- Consumes: existing `MemberMediaBucket`
- Produces outputs: `MemberMediaDistributionId`, `MemberMediaDistributionDomainName`, `MemberMediaCloudFrontPublicKeyId`, `MemberMediaCloudFrontKeyGroupId`

- [ ] **Step 1: Write failing infrastructure contract tests**

Require these resource types and boundaries:

```ts
for (const resource of [
  "AWS::CloudFront::OriginAccessControl",
  "AWS::CloudFront::PublicKey",
  "AWS::CloudFront::KeyGroup",
  "AWS::CloudFront::CachePolicy",
  "AWS::CloudFront::Distribution",
  "AWS::S3::BucketPolicy",
]) {
  expect(template).toContain(`Type: ${resource}`);
}

expect(template).toContain("PriceClass: PriceClass_200");
expect(template).toContain("ViewerProtocolPolicy: redirect-to-https");
expect(template).toContain("TrustedKeyGroups:");
expect(template).toContain("Service: cloudfront.amazonaws.com");
expect(template).toContain("AWS:SourceArn");
expect(template).toContain("${MemberMediaBucket.Arn}/media/*");
expect(template).not.toContain("btccc-heatmaps");
```

Also require minimum/default/maximum TTL values `60`, `86400`, and `31536000`, and outputs for distribution domain, distribution ID, public key ID, and key group ID.

- [ ] **Step 2: Run the infra test and verify RED**

Run:

```powershell
npx vitest run tests/server/member-media-infra-contract.test.ts
```

Expected: FAIL because the CloudFront resources do not exist.

- [ ] **Step 3: Add CloudFormation parameters and resources**

Add a `CloudFrontPublicKeyEncoded` string parameter and resources equivalent to:

```yaml
MemberMediaOriginAccessControl:
  Type: AWS::CloudFront::OriginAccessControl

MemberMediaCloudFrontPublicKey:
  Type: AWS::CloudFront::PublicKey

MemberMediaCloudFrontKeyGroup:
  Type: AWS::CloudFront::KeyGroup

MemberMediaCloudFrontCachePolicy:
  Type: AWS::CloudFront::CachePolicy

MemberMediaDistribution:
  Type: AWS::CloudFront::Distribution

MemberMediaBucketPolicy:
  Type: AWS::S3::BucketPolicy
```

Use the bucket regional domain, `S3OriginConfig.OriginAccessIdentity: ""`, OAC signing `always` with `sigv4`, trusted key group restriction, `GET`/`HEAD` only, no forwarded cookies/headers/query strings, compression, HTTP/2 and HTTP/3, IPv6, and `PriceClass_200`.

Restrict the bucket policy to:

```yaml
Principal:
  Service: cloudfront.amazonaws.com
Action: s3:GetObject
Resource: !Sub ${MemberMediaBucket.Arn}/media/*
Condition:
  StringEquals:
    AWS:SourceArn: !Sub arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${MemberMediaDistribution}
```

- [ ] **Step 4: Run contract and CloudFormation validation**

Run:

```powershell
npx vitest run tests/server/member-media-infra-contract.test.ts
aws cloudformation validate-template `
  --profile aws-management `
  --region ap-southeast-1 `
  --template-body file://infra/aws/tambike-member-media.yaml
```

Expected: both succeed without applying AWS changes.

- [ ] **Step 5: Commit infrastructure**

Run:

```powershell
git diff --check
git add infra/aws/tambike-member-media.yaml tests/server/member-media-infra-contract.test.ts
git commit -m "infra: add private member media CloudFront"
```

---

### Task 4: Document guarded deployment, rollback, and key rotation

**Files:**
- Modify: `docs/deployment/member-media-aws-oidc.md`
- Modify: `tests/server/member-media-infra-contract.test.ts`

**Interfaces:**
- Consumes: CloudFormation outputs and the four server-only Vercel variables.
- Produces: repeatable operational procedure without exposing key material.

- [ ] **Step 1: Add failing documentation assertions**

Require the guide to include:

```ts
for (const value of [
  "CloudFrontPublicKeyEncoded",
  "MemberMediaDistributionDomainName",
  "MEMBER_MEDIA_CLOUDFRONT_DOMAIN",
  "MEMBER_MEDIA_CLOUDFRONT_PUBLIC_KEY_ID",
  "MEMBER_MEDIA_CLOUDFRONT_PRIVATE_KEY_BASE64",
  "MEMBER_MEDIA_CLOUDFRONT_URL_TTL_SECONDS",
  "Origin Access Control",
  "signed URL",
  "unsigned",
  "403",
  "key rotation",
]) {
  expect(guide).toContain(value);
}
```

- [ ] **Step 2: Run the infra test and verify RED**

Run:

```powershell
npx vitest run tests/server/member-media-infra-contract.test.ts
```

Expected: FAIL on missing deployment documentation.

- [ ] **Step 3: Add safe operational instructions**

Document:

- RSA 2048 key generation in a unique temporary directory outside the repository.
- Passing only the public key to CloudFormation.
- Base64-encoding the private PEM without printing it.
- Production-only Vercel environment configuration.
- Stack output verification.
- Unsigned `403`, signed `200`, and warm cache-hit checks.
- Environment-variable rollback to direct streaming.
- Key rotation by overlapping trusted public keys before replacing the Vercel private key.
- Validated deletion of only the temporary key directory after production verification.

- [ ] **Step 4: Run tests and commit**

Run:

```powershell
npx vitest run tests/server/member-media-infra-contract.test.ts
git diff --check
git add docs/deployment/member-media-aws-oidc.md tests/server/member-media-infra-contract.test.ts
git commit -m "docs: add member media CDN operations"
```

---

### Task 5: Run the complete pre-production gate

**Files:**
- Verify all files changed in Tasks 1–4.

**Interfaces:**
- Produces: a tested `main` commit set safe to deploy with CDN configuration absent.

- [ ] **Step 1: Run the full automated gate**

Run:

```powershell
npm run test:server
npm run lint
npm run build
git diff --check
git status --short --branch
```

Expected: all commands succeed and the worktree is clean.

- [ ] **Step 2: Confirm Git scope and AWS no-change state**

Run:

```powershell
git log --oneline origin/main..HEAD
aws cloudfront list-distributions `
  --profile aws-management `
  --query "DistributionList.Items[].{Id:Id,Comment:Comment,Origins:Origins.Items[].DomainName}" `
  --output json
```

Expected: only intentional Tambike commits are ahead; the pre-existing heatmap distribution is still the only deployed distribution before Task 6.

---

### Task 6: Provision CloudFront and configure production secrets

**Files:**
- Do not create tracked files.
- Create key material only in a unique validated temporary directory outside the repository.

**Interfaces:**
- Produces: deployed CloudFront distribution and production Vercel environment values.

- [ ] **Step 1: Reconfirm exact identities and stack state**

Run read-only checks:

```powershell
aws sts get-caller-identity --profile aws-management
aws cloudformation describe-stacks `
  --profile aws-management `
  --region ap-southeast-1 `
  --stack-name tambike-member-media
vercel whoami
Get-Content -Raw .vercel/project.json
```

Expected: AWS account `857558251626`, Vercel project `tambike`, and the existing production member-media stack.

- [ ] **Step 2: Generate an RSA key pair without displaying it**

Create a unique directory under the resolved Windows temporary directory, verify the resolved path remains inside that directory, generate RSA 2048 private/public PEM files, and record only non-secret file hashes and public-key metadata.

Do not write either PEM under `D:\Github\personal\tambike`.

- [ ] **Step 3: Validate and deploy the updated stack**

Read the public PEM into one PowerShell string and pass the existing exact parameters plus `CloudFrontPublicKeyEncoded=$PublicKeyPem` as a splatted argument array. The public key may be handled in memory; the private key must not enter the deployment arguments. Run:

```powershell
aws cloudformation validate-template `
  --profile aws-management `
  --region ap-southeast-1 `
  --template-body file://infra/aws/tambike-member-media.yaml

$DeployArgs = @(
  "cloudformation", "deploy",
  "--profile", "aws-management",
  "--region", "ap-southeast-1",
  "--stack-name", "tambike-member-media",
  "--template-file", "infra/aws/tambike-member-media.yaml",
  "--capabilities", "CAPABILITY_IAM",
  "--parameter-overrides",
  "VercelTeamSlug=florens-projects-aee3ca73",
  "VercelProjectName=tambike",
  "AllowedOrigin=https://tambike.bayanko.ph",
  "ExistingOidcProviderArn=arn:aws:iam::857558251626:oidc-provider/oidc.vercel.com/florens-projects-aee3ca73",
  "EnablePreviewAccess=false",
  "CloudFrontPublicKeyEncoded=$PublicKeyPem",
  "--no-fail-on-empty-changeset"
)
& aws @DeployArgs
```

Expected: stack reaches `UPDATE_COMPLETE`; the unrelated distribution is unchanged.

- [ ] **Step 4: Inspect exact resources before application activation**

Verify:

```powershell
$Stack = aws cloudformation describe-stacks --profile aws-management --region ap-southeast-1 --stack-name tambike-member-media | ConvertFrom-Json
$Outputs = $Stack.Stacks[0].Outputs
$DistributionId = ($Outputs | Where-Object OutputKey -eq "MemberMediaDistributionId").OutputValue
$BucketName = ($Outputs | Where-Object OutputKey -eq "BucketName").OutputValue
aws cloudfront get-distribution --profile aws-management --id $DistributionId
aws s3api get-public-access-block --profile aws-management --bucket $BucketName
```

Expected: distribution `Deployed`, trusted key group enabled, S3 origin uses OAC, and all four public-access-block flags remain true.

- [ ] **Step 5: Add production-only Vercel variables**

Pipe values through standard input to `vercel env add`; never place the private key or its base64 form on a command line, in logs, or in shell history.

Add:

```text
MEMBER_MEDIA_CLOUDFRONT_DOMAIN
MEMBER_MEDIA_CLOUDFRONT_PUBLIC_KEY_ID
MEMBER_MEDIA_CLOUDFRONT_PRIVATE_KEY_BASE64
MEMBER_MEDIA_CLOUDFRONT_URL_TTL_SECONDS
```

Verify names and production targets with `vercel env ls`; do not print values.

---

### Task 7: Publish, deploy, and verify production

**Files:**
- No additional source changes unless verification identifies a reproducible defect.

**Interfaces:**
- Produces: synchronized `main`, READY Vercel production deployment, and live CDN evidence.

- [ ] **Step 1: Push verified `main`**

Run:

```powershell
git status --short --branch
git push origin main:main
git ls-remote --heads origin refs/heads/main
```

Expected: remote `main` matches local `HEAD`.

- [ ] **Step 2: Wait for the production deployment**

Inspect the deployment created from the pushed commit until it reaches `READY`. Confirm `tambike.bayanko.ph` aliases that deployment and scan recent error logs.

- [ ] **Step 3: Verify unsigned denial and authenticated redirect**

Check:

```text
Unsigned CloudFront object request -> 403
Authenticated /media/{mediaId} -> 307
Location host -> dedicated *.cloudfront.net
Signed response -> 200 image/webp
```

Never print the signed query string.

- [ ] **Step 4: Verify cache behavior without exposing the signed URL**

Request the same signed URL twice inside a process that reports only status, content type, byte count, timing, `Age`, and `X-Cache`.

Expected: the second request reports a CloudFront hit and is materially faster than the pre-change direct stream.

- [ ] **Step 5: Verify the real attendee page with the Codex browser**

Open:

```text
https://tambike.bayanko.ph/events/tambike-cafe-classico/attendees
```

Confirm:

- 15 Going, 12 visible riders, and 3 anonymous riders.
- All 24 expected images complete successfully.
- Image requests redirect to the dedicated CloudFront host.
- Private/unpublished identities remain absent.
- No horizontal overflow.
- No browser console errors or warnings.

- [ ] **Step 6: Run final operational checks**

Verify:

```powershell
$Deployment = vercel inspect tambike.bayanko.ph --format=json | ConvertFrom-Json
vercel logs $Deployment.id --level error --since 30m
aws ce get-cost-and-usage `
  --profile aws-management `
  --time-period Start=2026-07-01,End=2026-07-26 `
  --granularity MONTHLY `
  --metrics UnblendedCost `
  --filter '{"Dimensions":{"Key":"SERVICE","Values":["Amazon CloudFront"]}}'
git status --short --branch
```

Expected: no application errors, cost reported without claiming permanent free usage, and clean synchronized `main`.

- [ ] **Step 7: Remove temporary key files safely**

Resolve and verify the exact temporary key directory is still inside the Windows temporary root, then delete only that directory after the private key is confirmed in Vercel production and production media works. Report that the local temporary key copy was removed and is not recoverable from the repository.
