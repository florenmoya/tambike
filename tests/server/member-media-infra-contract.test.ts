import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { validateSmokeConfiguration } from "../../scripts/smoke-member-media-s3";

const root = resolve(import.meta.dirname, "../..");

function source(path: string) {
  return readFileSync(resolve(root, path), "utf8");
}

describe("private member media infrastructure contract", () => {
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
    expect(template).toMatch(/CorsConfiguration:[\s\S]*AllowedOrigins:[\s\S]*!Ref AllowedOrigin/);
    expect(template).toMatch(/AllowedMethods:\s*\r?\n\s*- POST/);
    expect(template).not.toMatch(/AllowedMethods:[\s\S]{0,120}- (?:GET|PUT|DELETE)/);
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
    expect(guide).not.toMatch(/AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/);
  });

  test("ships a destructive-safe real-flow smoke command", () => {
    const script = source("scripts/smoke-member-media-s3.ts");
    const manifest = JSON.parse(source("package.json")) as { scripts?: Record<string, string> };

    expect(manifest.scripts?.["smoke:member-media-s3"]).toBe("tsx scripts/smoke-member-media-s3.ts");
    expect(script).toContain("createS3MemberMediaStore");
    expect(script).toContain("createMemberMediaLifecycleService");
    expect(script).toContain("sharp");
    expect(script).toContain("fetch(presigned.url");
    expect(script).toContain("metadata()");
    expect(script).toContain("image/webp");
    expect(script).toContain("512");
    expect(script).toContain("smoke/");
    expect(script).toContain("deletedKeys");
    expect(script).not.toMatch(/ListObjects|DeleteObjectsCommand|rm\s+-rf/);
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
