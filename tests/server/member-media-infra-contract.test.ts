import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { validateSmokeConfiguration } from "../../scripts/smoke-member-media-s3";

const root = resolve(import.meta.dirname, "../..");

function source(path: string) {
  return readFileSync(resolve(root, path), "utf8");
}

describe("private member media infrastructure contract", () => {
  test("documents an executable splatted Vercel command that injects the smoke token without printing it", () => {
    const guide = source("docs/deployment/member-media-aws-oidc.md");
    const vercelArgs = "@('env', 'run', '--environment', 'preview', '--project', 'tambike', '--', 'npm', 'run', 'smoke:member-media-s3')";

    expect(guide).toContain(`$VercelArgs = ${vercelArgs}`);
    expect(guide).toContain("& vercel @VercelArgs");
    expect(guide).not.toContain("vercel env pull --environment=preview");
    expect(guide).not.toContain("$env:VERCEL_OIDC_TOKEN =");

    const command = [
      `$VercelArgs = ${vercelArgs}`,
      '[Console]::Write(($VercelArgs -join "|"))',
    ].join("; ");
    const renderedArgs = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
      encoding: "utf8",
    }).trim();
    expect(renderedArgs).toBe("env|run|--environment|preview|--project|tambike|--|npm|run|smoke:member-media-s3");
  });

  test("ships a disposable non-production smoke stack with exact development OIDC and run-bounded access", () => {
    const template = source("infra/aws/tambike-member-media-smoke.yaml");
    const productionTemplate = source("infra/aws/tambike-member-media.yaml");
    const guide = source("docs/deployment/member-media-aws-oidc.md");

    expect(template).toMatch(/\n  Bucket:[\s\S]*DeletionPolicy: Retain[\s\S]*UpdateReplacePolicy: Retain/);
    expect(template).toContain("VercelTeamSlug:");
    expect(template).toContain("VercelProjectName:");
    expect(template).toContain("ExistingOidcProviderArn:");
    expect(template).toContain("SmokeBasePrefix:");
    expect(template).toContain("SmokeRunId:");
    expect(template).toContain("^[0-9]{14}-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$");
    expect(template).toContain("owner:${VercelTeamSlug}:project:${VercelProjectName}:environment:development");
    expect(template).not.toContain("environment:production");
    expect(template).not.toContain("environment:preview");
    expect(template).not.toContain("project:*");
    expect(template).toContain("Value: !Ref AWS::StackName");
    expect(template).toContain("tb-nonprod-${SmokeRunId}");
    expect(template).not.toMatch(/^\s*BucketName:/m);
    expect(template).toMatch(/VercelOidcProvider:[\s\S]*DeletionPolicy: Retain[\s\S]*UpdateReplacePolicy: Retain/);
    expect(template).toContain("s3:PutObject");
    expect(template).toContain("s3:GetObject");
    expect(template).toContain("s3:DeleteObject");
    expect(template).not.toContain("s3:ListBucket");
    const smokeActions = [...template.matchAll(/^\s+- (s3:[A-Za-z*]+)\s*$/gm)].map((match) => match[1]);
    expect(new Set(smokeActions)).toEqual(new Set([
      "s3:PutObject",
      "s3:GetObject",
      "s3:DeleteObject",
    ]));
    expect(template).not.toMatch(/^\s*- s3:\*\s*$/m);
    expect(template).not.toMatch(/^\s*Action:\s*["']?\*["']?\s*$/m);
    expect(template).toContain("/smoke/${SmokeBasePrefix}/${SmokeRunId}/tmp/*");
    expect(template).toContain("/smoke/${SmokeBasePrefix}/${SmokeRunId}/media/*");
    expect(template).not.toContain("${Bucket.Arn}/tmp/*");
    expect(template).not.toContain("${Bucket.Arn}/media/*");
    expect(template).not.toContain("${Bucket.Arn}/*");
    expect(template).toMatch(/Outputs:[\s\S]*SmokeBucketName:[\s\S]*Value: !Ref Bucket/);
    expect(template).toMatch(/SmokeRoleArn:[\s\S]*Value: !GetAtt SmokeVercelMemberMediaRole\.Arn/);
    for (const setting of [
      "BlockPublicAcls: true",
      "IgnorePublicAcls: true",
      "BlockPublicPolicy: true",
      "RestrictPublicBuckets: true",
      "ObjectOwnership: BucketOwnerEnforced",
      "SSEAlgorithm: AES256",
      "Status: Enabled",
      "NoncurrentVersionExpiration:",
    ]) {
      expect(template).toContain(setting);
    }
    expect(template).toContain("Prefix: !Sub smoke/${SmokeBasePrefix}/${SmokeRunId}/tmp/");
    expect(template).toContain("Prefix: smoke/");
    const smokeTrust = template.slice(
      template.indexOf("AssumeRolePolicyDocument:"),
      template.indexOf("      Policies:"),
    );
    expect(smokeTrust).toContain("oidc.vercel.com/${VercelTeamSlug}:aud");
    expect(smokeTrust).not.toContain("!Ref ExistingOidcProviderArn");
    const smokeRole = template.slice(
      template.indexOf("SmokeVercelMemberMediaRole:"),
      template.indexOf("Outputs:"),
    );
    expect(smokeRole).toMatch(/OidcProviderArn:[\s\S]*!If[\s\S]*!Ref VercelOidcProvider[\s\S]*oidc-provider\/oidc\.vercel\.com\/\$\{VercelTeamSlug\}/);
    expect(guide).toContain("tambike-member-media-nonprod");
    expect(guide).toContain("vercel env run");
    expect(guide).toContain("VERCEL_OIDC_TOKEN");
    expect(guide).toContain("MEMBER_MEDIA_SMOKE_BUCKET_NAME");
    expect(guide).toContain("MEMBER_MEDIA_SMOKE_ROLE_ARN");
    expect(guide).toContain("smoke/member-media");
    expect(guide).toContain("I_UNDERSTAND_THIS_USES_A_TEST_BUCKET");
    const smokeScript = source("scripts/smoke-member-media-s3.ts");
    expect(smokeScript).toContain("requireAnonymousRawObjectDenied");
    expect(smokeScript).toContain("rawS3ObjectUrl");
    expect(guide).toContain("aws cloudformation delete-stack");
    expect(guide).toContain("aws s3 rm \"s3://$SmokeBucketName\" --recursive");
    expect(guide).toContain("retained Vercel OIDC provider");
    expect(guide).toContain("retained smoke bucket");
    expect(guide).toContain("ExistingOidcProviderArn=$SmokeOidcProviderArn");
    expect(guide).toContain("& vercel @VercelArgs");
    expect(guide).toContain("describe-stack-resources");
    expect(guide).toContain("SmokeRunId");
    expect(guide).toContain("output-less failed-create recovery");
    expect(guide).toContain("LogicalResourceId=='Bucket'");
    expect(guide).toContain("raw anonymous request against the exact finalized object");
    expect(productionTemplate).not.toContain("environment:development");
    expect(productionTemplate).not.toContain("nonprod");
    expect(productionTemplate).toContain("!Sub ${MemberMediaBucket.Arn}/tmp/*");
    expect(productionTemplate).toContain("!Sub ${MemberMediaBucket.Arn}/media/*");
  });

  test("uses a short bucket logical ID so the generated nonprod name preserves its delimiter-bounded safety marker", () => {
    const template = source("infra/aws/tambike-member-media-smoke.yaml");

    expect(template).toMatch(/^  Bucket:\s*$/m);
    expect(template).not.toContain("SmokeMemberMediaBucket:");
    expect(template).toContain("${Bucket.Arn}/smoke/${SmokeBasePrefix}/${SmokeRunId}/tmp/*");
    expect(template).toContain("${Bucket.Arn}/smoke/${SmokeBasePrefix}/${SmokeRunId}/media/*");
  });

  test("defines a region-independent, private, encrypted, versioned bucket", () => {
    const template = source("infra/aws/tambike-member-media.yaml");

    expect(template).not.toMatch(/^\s*Region\s*:/m);
    expect(template).not.toContain("ap-southeast-1");
    expect(template).toContain("Type: AWS::S3::Bucket");
    for (const setting of [
      "BlockPublicAcls: true",
      "IgnorePublicAcls: true",
      "BlockPublicPolicy: true",
      "RestrictPublicBuckets: true",
      "SSEAlgorithm: AES256",
      "Status: Enabled",
    ]) {
      expect(template).toContain(setting);
    }
    expect(template).toMatch(/LifecycleConfiguration:[\s\S]*Prefix: tmp\/[\s\S]*ExpirationInDays: 1/);
    expect(template).toMatch(
      /Id: ExpireNoncurrentMemberMedia[\s\S]*Prefix: media\/[\s\S]*NoncurrentVersionExpiration:[\s\S]*NoncurrentDays: 30/,
    );
    expect(template).toMatch(
      /Id: RemoveExpiredMemberMediaDeleteMarkers[\s\S]*Prefix: media\/[\s\S]*ExpiredObjectDeleteMarker: true/,
    );
    const cors = template.slice(
      template.indexOf("      CorsConfiguration:"),
      template.indexOf("      Tags:", template.indexOf("      CorsConfiguration:")),
    );
    expect(cors).toMatch(/AllowedOrigins:[\s\S]*!Ref AllowedOrigin/);
    expect(cors).toMatch(/AllowedMethods:\s*\r?\n\s*- POST/);
    expect(cors).not.toMatch(/AllowedMethods:[\s\S]{0,120}- (?:GET|PUT|DELETE)/);
  });

  test("defines a dedicated signed CloudFront distribution with exact private S3 access", () => {
    const template = source("infra/aws/tambike-member-media.yaml");

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
    expect(template).toContain("CloudFrontPublicKeyEncoded:");
    expect(template).toContain("OriginAccessControlOriginType: s3");
    expect(template).toContain("SigningBehavior: always");
    expect(template).toContain("SigningProtocol: sigv4");
    expect(template).toContain("DomainName: !GetAtt MemberMediaBucket.RegionalDomainName");
    expect(template).toContain('OriginAccessIdentity: ""');
    expect(template).toContain("TrustedKeyGroups:");
    expect(template).toContain("ViewerProtocolPolicy: redirect-to-https");
    expect(template).toContain("PriceClass: PriceClass_200");
    expect(template).toContain("HttpVersion: http2and3");
    expect(template).toContain("MinTTL: 60");
    expect(template).toContain("DefaultTTL: 86400");
    expect(template).toContain("MaxTTL: 31536000");
    expect(template).toMatch(/AllowedMethods:\s*\r?\n\s*- GET\s*\r?\n\s*- HEAD/);
    expect(template).toMatch(/CachedMethods:\s*\r?\n\s*- GET\s*\r?\n\s*- HEAD/);

    const bucketPolicy = template.slice(
      template.indexOf("MemberMediaBucketPolicy:"),
      template.indexOf("Outputs:"),
    );
    expect(bucketPolicy).toContain("Service: cloudfront.amazonaws.com");
    expect(bucketPolicy).toContain("Action: s3:GetObject");
    expect(bucketPolicy).toContain("Resource: !Sub ${MemberMediaBucket.Arn}/media/*");
    expect(bucketPolicy).toContain("AWS:SourceArn");
    expect(bucketPolicy).toContain(
      "arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${MemberMediaDistribution}",
    );
    expect(bucketPolicy).not.toContain("${MemberMediaBucket.Arn}/*");
    expect(template).not.toContain("btccc-heatmaps");

    for (const output of [
      "MemberMediaDistributionId:",
      "MemberMediaDistributionDomainName:",
      "MemberMediaCloudFrontPublicKeyId:",
      "MemberMediaCloudFrontKeyGroupId:",
    ]) {
      expect(template).toContain(output);
    }
  });

  test("documents guarded CloudFront deployment, verification, rollback, and key rotation", () => {
    const guide = source("docs/deployment/member-media-aws-oidc.md");

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
  });

  test("places expired delete-marker cleanup directly on its dedicated lifecycle rule", () => {
    const template = source("infra/aws/tambike-member-media.yaml");
    const ruleStart = template.indexOf("          - Id: RemoveExpiredMemberMediaDeleteMarkers");
    const ruleEnd = template.indexOf("      CorsConfiguration:", ruleStart);
    const rule = template.slice(ruleStart, ruleEnd);

    expect(ruleStart).toBeGreaterThanOrEqual(0);
    expect(ruleEnd).toBeGreaterThan(ruleStart);
    expect(rule).toMatch(/^\s{12}Status: Enabled$/m);
    expect(rule).toMatch(/^\s{12}Prefix: media\/$/m);
    expect(rule).toMatch(/^\s{12}ExpiredObjectDeleteMarker: true$/m);
    expect(rule).not.toMatch(/^\s{12}Expiration:\s*$/m);
  });

  test("uses a Java-compatible exact HTTPS origin pattern", () => {
    const template = source("infra/aws/tambike-member-media.yaml");
    const allowedOrigin = template.match(
      /AllowedOrigin:[\s\S]*?AllowedPattern: '([^'\r\n]+)'/,
    )?.[1];
    expect(allowedOrigin).toBeDefined();
    expect(allowedOrigin).not.toMatch(/\[:space:\]|\(\?<[=!]|\\p\{/);

    const pattern = new RegExp(allowedOrigin!);
    for (const origin of [
      "https://tambike.ph",
      "https://app.tambike.ph",
      "https://app.tambike.ph:8443",
    ]) {
      expect(pattern.test(origin), origin).toBe(true);
    }
    for (const origin of [
      "http://tambike.ph",
      "https:// tambike.ph",
      "https://tambike.ph/path",
      "https://tambike.ph?preview=1",
      "https://tambike.ph/#fragment",
      "https://.tambike.ph",
      "https://tambike.ph.",
      "https://tambike.ph:99999",
      "tambike.ph",
    ]) {
      expect(pattern.test(origin), origin).toBe(false);
    }
  });

  test("binds Vercel team-mode OIDC to exact production claims and bounded opt-in preview", () => {
    const template = source("infra/aws/tambike-member-media.yaml");

    for (const parameter of [
      "VercelTeamSlug:",
      "VercelProjectName:",
      "AllowedOrigin:",
      "ExistingOidcProviderArn:",
      "EnablePreviewAccess:",
    ]) {
      expect(template).toContain(parameter);
    }
    expect(template).toContain("Type: AWS::IAM::OIDCProvider");
    expect(template).toContain("https://oidc.vercel.com/${VercelTeamSlug}");
    expect(template).toContain("https://vercel.com/${VercelTeamSlug}");
    expect(template).toContain("sts:AssumeRoleWithWebIdentity");
    expect(template).toContain("owner:${VercelTeamSlug}:project:${VercelProjectName}:environment:production");
    expect(template).toContain("owner:${VercelTeamSlug}:project:${VercelProjectName}:environment:preview");
    expect(template).not.toContain("project:*");
    expect(template).toMatch(/EnablePreviewAccess:[\s\S]*Default: "false"[\s\S]*AllowedValues:[\s\S]*- "false"[\s\S]*- "true"/);
  });

  test("ships a separate development-only role with read-only access to existing media objects", () => {
    const template = source("infra/aws/tambike-member-media-local-read.yaml");

    expect(template).toContain("Type: AWS::IAM::Role");
    expect(template).not.toContain("AWS::S3::Bucket");
    expect(template).not.toContain("AWS::CloudFront");
    expect(template).toContain("ExistingBucketName:");
    expect(template).toContain("ExistingOidcProviderArn:");
    expect(template).toContain("owner:${VercelTeamSlug}:project:${VercelProjectName}:environment:development");
    expect(template).not.toContain("environment:production");
    expect(template).not.toContain("environment:preview");
    expect(template).not.toContain("project:*");
    expect(template).toContain("sts:AssumeRoleWithWebIdentity");
    expect(template).toContain("s3:GetObject");
    expect(template).toContain("arn:${AWS::Partition}:s3:::${ExistingBucketName}/media/*");
    expect(template).not.toContain("s3:PutObject");
    expect(template).not.toContain("s3:DeleteObject");
    expect(template).not.toContain("s3:ListBucket");
    expect(template).not.toMatch(/^\s*Action:\s*["']?\*["']?\s*$/m);
    expect(template).not.toMatch(/^\s*- [a-z0-9-]+:\*\s*$/mi);
    expect(template).toMatch(/DevelopmentReadRoleArn:[\s\S]*Value: !GetAtt DevelopmentReadRole\.Arn/);
  });

  test("derives the trusted provider principal from the current account and exact team issuer", () => {
    const template = source("infra/aws/tambike-member-media.yaml");
    const trust = template.slice(
      template.indexOf("AssumeRolePolicyDocument:"),
      template.indexOf("      Policies:"),
    );

    expect(trust).toContain(
      "arn:${AWS::Partition}:iam::${AWS::AccountId}:oidc-provider/oidc.vercel.com/${VercelTeamSlug}",
    );
    expect(trust).not.toContain("!Ref ExistingOidcProviderArn");
    expect(trust).not.toMatch(/OidcProviderArn:\s*!If/);
  });

  test("grants only the object operations used by presign, finalize, fetch, and cleanup", () => {
    const template = source("infra/aws/tambike-member-media.yaml");
    const actions = [...template.matchAll(/^\s+- (s3:[A-Za-z*]+)\s*$/gm)].map((match) => match[1]);

    expect(new Set(actions)).toEqual(new Set([
      "s3:PutObject",
      "s3:GetObject",
      "s3:DeleteObject",
    ]));
    expect(template).not.toMatch(/^\s*Action:\s*["']?\*["']?\s*$/m);
    expect(template).not.toMatch(/^\s*- [a-z0-9-]+:\*\s*$/mi);
    expect(template).toContain("!Sub ${MemberMediaBucket.Arn}/tmp/*");
    expect(template).toContain("!Sub ${MemberMediaBucket.Arn}/media/*");
    expect(template).not.toContain("s3:ListBucket");
  });

  test("exports deployment values and documents guarded Vercel, AWS, and rollback operations", () => {
    const template = source("infra/aws/tambike-member-media.yaml");
    const guide = source("docs/deployment/member-media-aws-oidc.md");

    expect(template).toMatch(/Outputs:[\s\S]*BucketName:[\s\S]*Value: !Ref MemberMediaBucket/);
    expect(template).toMatch(/VercelRoleArn:[\s\S]*Value: !GetAtt VercelMemberMediaRole\.Arn/);
    for (const value of [
      "AWS_REGION=ap-southeast-1",
      "AWS_ROLE_ARN",
      "S3_BUCKET_NAME",
      "vercel whoami",
      "npm i -g vercel",
      "vercel --version",
      ".vercel/project.json",
      "vercel project inspect",
      "aws cloudformation deploy",
      "aws cloudformation describe-stack-events",
      "aws cloudformation rollback-stack",
      "vercel env add",
    ]) {
      expect(guide).toContain(value);
    }
    expect(guide).toContain("team issuer");
    expect(guide).toContain("Do not run `vercel link`");
    expect(guide).toContain("oidc-provider/oidc.vercel.com/$VercelTeamSlug");
    expect(guide).toContain("SMOKE_REFUSED");
    expect(guide).toContain("smoke/<base>/<run>/tmp/*");
    expect(guide).toContain("smoke/<base>/<run>/media/*");
    for (const action of ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]) {
      expect(guide).toContain(action);
    }
    expect(guide).not.toMatch(/AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/);
    expect(guide).toContain("30 days");
    expect(guide).toContain("durable cleanup intent");
    expect(guide).toContain("bounded batch");
  });

  test("ships a destructive-safe real-flow smoke command", () => {
    const script = source("scripts/smoke-member-media-s3.ts");
    const manifest = JSON.parse(source("package.json")) as { scripts?: Record<string, string> };

    expect(manifest.scripts?.["smoke:member-media-s3"]).toBe("tsx scripts/smoke-member-media-s3.ts");
    expect(script).toContain("createS3MemberMediaStore");
    expect(script).toContain("createMemberMediaLifecycleService");
    expect(script).toContain("sharp");
    expect(script).toContain("fetcher(presigned.url");
    expect(script).toContain("metadata()");
    expect(script).toContain("image/webp");
    expect(script).toContain("512");
    expect(script).toContain("smoke/");
    expect(script).toContain("MEMBER_MEDIA_SMOKE_RUN_ID");
    expect(script).toContain("deletedKeys");
    expect(script).not.toMatch(/ListObjects|DeleteObjectsCommand|rm\s+-rf/);
  });

  test("accepts only a predeclared exact run id shape for a prebounded test-role policy", () => {
    const base = {
      AWS_REGION: "ap-southeast-1",
      MEMBER_MEDIA_SMOKE_BUCKET_NAME: "tambike-member-media-smoke",
      MEMBER_MEDIA_SMOKE_ROLE_ARN: "arn:aws:iam::123456789012:role/tambike-member-media-test",
      MEMBER_MEDIA_SMOKE_PREFIX: "smoke/member-media",
      MEMBER_MEDIA_SMOKE_CONFIRM: "I_UNDERSTAND_THIS_USES_A_TEST_BUCKET",
      VERCEL_OIDC_TOKEN: "short-lived-test-token",
    };
    const runId = "20260722050000-7c86a8fb-0bbf-4d6d-8d23-09ccf0cf9db5";
    expect(validateSmokeConfiguration({ ...base, MEMBER_MEDIA_SMOKE_RUN_ID: runId })).toMatchObject({
      runId,
    });
    for (const invalid of ["run", "../run", "production-run", "20260722/run", "20260722050000-"]) {
      expect(() => validateSmokeConfiguration({
        ...base,
        MEMBER_MEDIA_SMOKE_RUN_ID: invalid,
      })).toThrow("SMOKE_REFUSED");
    }
  });

  test("requires an explicit test role, test bucket, OIDC token, and confirmation", () => {
    const valid = {
      AWS_REGION: "ap-southeast-1",
      MEMBER_MEDIA_SMOKE_BUCKET_NAME: "tambike-member-media-smoke",
      MEMBER_MEDIA_SMOKE_ROLE_ARN: "arn:aws:iam::123456789012:role/tambike-member-media-test",
      MEMBER_MEDIA_SMOKE_PREFIX: "smoke/member-media",
      MEMBER_MEDIA_SMOKE_CONFIRM: "I_UNDERSTAND_THIS_USES_A_TEST_BUCKET",
      VERCEL_OIDC_TOKEN: "short-lived-test-token",
    };

    expect(validateSmokeConfiguration(valid)).toEqual({
      region: "ap-southeast-1",
      bucketName: "tambike-member-media-smoke",
      roleArn: "arn:aws:iam::123456789012:role/tambike-member-media-test",
      basePrefix: "smoke/member-media",
    });
    for (const name of Object.keys(valid)) {
      expect(() => validateSmokeConfiguration({ ...valid, [name]: "" })).toThrow("SMOKE_REFUSED");
    }
    expect(() => validateSmokeConfiguration({
      ...valid,
      MEMBER_MEDIA_SMOKE_BUCKET_NAME: "tambike-member-media-production",
    })).toThrow("test, smoke, or nonprod");
    expect(() => validateSmokeConfiguration({
      ...valid,
      MEMBER_MEDIA_SMOKE_ROLE_ARN: "arn:aws:iam::123456789012:role/tambike-member-media-production",
    })).toThrow("test, smoke, or nonprod");
  });

  test.each([
    "tmp/",
    "media/",
    "production/sample",
    "smoke/production",
    "smoke/sample/mika",
    "smoke/../media",
    "smoke//media",
  ])("refuses dangerous or production-looking prefix %s", (prefix) => {
    expect(() => validateSmokeConfiguration({
      AWS_REGION: "ap-southeast-1",
      MEMBER_MEDIA_SMOKE_BUCKET_NAME: "tambike-member-media-smoke",
      MEMBER_MEDIA_SMOKE_ROLE_ARN: "arn:aws:iam::123456789012:role/tambike-member-media-test",
      MEMBER_MEDIA_SMOKE_PREFIX: prefix,
      MEMBER_MEDIA_SMOKE_CONFIRM: "I_UNDERSTAND_THIS_USES_A_TEST_BUCKET",
      VERCEL_OIDC_TOKEN: "short-lived-test-token",
    })).toThrow("SMOKE_REFUSED");
  });
});
