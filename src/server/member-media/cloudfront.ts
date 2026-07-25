import {
  getSignedUrl,
  type CloudfrontSignInputWithParameters,
} from "@aws-sdk/cloudfront-signer";

export interface MemberMediaCloudFrontConfig {
  domain: string;
  publicKeyId: string;
  privateKey: string;
  ttlSeconds: number;
}

type MemberMediaCloudFrontEnvironment = Record<string, string | undefined>;

const configNames = [
  "MEMBER_MEDIA_CLOUDFRONT_DOMAIN",
  "MEMBER_MEDIA_CLOUDFRONT_PUBLIC_KEY_ID",
  "MEMBER_MEDIA_CLOUDFRONT_PRIVATE_KEY_BASE64",
] as const;

function invalidConfig(): never {
  throw new Error("MEMBER_MEDIA_CLOUDFRONT_CONFIG");
}

function decodePrivateKey(value: string) {
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    invalidConfig();
  }
  const privateKey = Buffer.from(value, "base64").toString("utf8");
  if (Buffer.from(privateKey, "utf8").toString("base64") !== value) {
    invalidConfig();
  }
  const match = privateKey.match(
    /^-----BEGIN (PRIVATE KEY|RSA PRIVATE KEY)-----\r?\n[\s\S]+\r?\n-----END \1-----$/,
  );
  if (!match) invalidConfig();
  return privateKey;
}

export function loadMemberMediaCloudFrontConfig(
  env: MemberMediaCloudFrontEnvironment = process.env,
): MemberMediaCloudFrontConfig | null {
  const configuredValues = configNames.map((name) => env[name]?.trim() ?? "");
  const rawTtl = env.MEMBER_MEDIA_CLOUDFRONT_URL_TTL_SECONDS?.trim() ?? "";
  if (configuredValues.every((value) => !value) && !rawTtl) return null;
  if (configuredValues.some((value) => !value)) invalidConfig();

  const [domain, publicKeyId, privateKeyBase64] = configuredValues;
  if (
    !domain ||
    !/^[a-z0-9-]+\.cloudfront\.net$/.test(domain) ||
    !publicKeyId ||
    !/^[A-Z0-9]{5,128}$/.test(publicKeyId) ||
    !privateKeyBase64
  ) {
    invalidConfig();
  }

  const ttlSeconds = rawTtl ? Number(rawTtl) : 300;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 900) {
    invalidConfig();
  }

  return {
    domain,
    publicKeyId,
    privateKey: decodePrivateKey(privateKeyBase64),
    ttlSeconds,
  };
}

function encodedStoragePath(storageKey: string) {
  const segments = storageKey.split("/");
  if (
    segments.length !== 5 ||
    segments[0] !== "media" ||
    segments[1] !== "users" ||
    !segments[2] ||
    !["avatar", "motorcycles"].includes(segments[3] ?? "") ||
    !segments[4]?.endsWith(".webp") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("MEMBER_MEDIA_CLOUDFRONT_PATH");
  }
  return segments.map(encodeURIComponent).join("/");
}

export function createMemberMediaCloudFrontUrl(
  storageKey: string,
  config: MemberMediaCloudFrontConfig,
  dependencies: {
    now?: () => Date;
    sign?: (input: CloudfrontSignInputWithParameters) => string;
  } = {},
): string {
  const now = dependencies.now ?? (() => new Date());
  const sign = dependencies.sign ?? getSignedUrl;
  const url = `https://${config.domain}/${encodedStoragePath(storageKey)}`;
  const dateLessThan = new Date(
    now().getTime() + config.ttlSeconds * 1_000,
  ).toISOString();

  return sign({
    url,
    keyPairId: config.publicKeyId,
    privateKey: config.privateKey,
    dateLessThan,
    algorithm: "SHA256",
  });
}
