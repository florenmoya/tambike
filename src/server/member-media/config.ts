export interface MemberMediaConfig {
  region: string;
  roleArn: string;
  bucketName: string;
}

type MemberMediaEnvironment = Record<string, string | undefined>;

function requiredEnvironmentValue(
  env: MemberMediaEnvironment,
  name: "AWS_REGION" | "AWS_ROLE_ARN" | "S3_BUCKET_NAME",
) {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`MEMBER_MEDIA_CONFIG: ${name} is required`);
  }
  return value;
}

export function loadMemberMediaConfig(
  env: MemberMediaEnvironment = process.env,
): MemberMediaConfig {
  const region = requiredEnvironmentValue(env, "AWS_REGION");
  const roleArn = requiredEnvironmentValue(env, "AWS_ROLE_ARN");
  const bucketName = requiredEnvironmentValue(env, "S3_BUCKET_NAME");
  const isProduction =
    env.VERCEL_ENV?.trim().toLowerCase() === "production" ||
    env.NODE_ENV?.trim().toLowerCase() === "production";

  if (isProduction && region !== "ap-southeast-1") {
    throw new Error(
      "MEMBER_MEDIA_CONFIG: production AWS_REGION must be ap-southeast-1",
    );
  }

  return { region, roleArn, bucketName };
}
