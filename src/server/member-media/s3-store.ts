import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  createPresignedPost as createAwsPresignedPost,
  type PresignedPostOptions,
} from "@aws-sdk/s3-presigned-post";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

import type { MemberMediaConfig } from "./config";
import type {
  MemberMediaBody,
  MemberMediaStore,
  PresignedPostFields,
} from "./store";

interface S3CommandClient {
  send(command: unknown): Promise<unknown>;
}

type S3Presigner = (
  client: S3CommandClient,
  options: PresignedPostOptions,
) => Promise<PresignedPostFields>;

interface S3StoreDependencies {
  client?: S3CommandClient;
  presign?: S3Presigner;
}

function isMemberMediaBody(value: unknown): value is MemberMediaBody {
  if (value instanceof Uint8Array) return true;
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === "function"
  );
}

export function createS3MemberMediaStore(
  config: MemberMediaConfig,
  dependencies: S3StoreDependencies = {},
): MemberMediaStore {
  const client =
    dependencies.client ??
    new S3Client({
      region: config.region,
      credentials: awsCredentialsProvider({ roleArn: config.roleArn }),
    });
  const presign: S3Presigner =
    dependencies.presign ??
    ((presignClient, options) =>
      createAwsPresignedPost(presignClient as S3Client, options));

  return {
    async createPresignedPost(input) {
      return presign(client, {
        Bucket: config.bucketName,
        Key: input.key,
        Fields: { "Content-Type": input.mimeType },
        Conditions: [
          ["eq", "$key", input.key],
          ["eq", "$Content-Type", input.mimeType],
          ["content-length-range", input.minimumBytes, input.maximumBytes],
        ],
        Expires: input.expiresInSeconds,
      });
    },

    async getObject(key) {
      const output = (await client.send(
        new GetObjectCommand({ Bucket: config.bucketName, Key: key }),
      )) as {
        Body?: unknown;
        ContentType?: string;
        ContentLength?: number;
      };
      if (!isMemberMediaBody(output.Body)) {
        throw new Error("MEMBER_MEDIA_UNAVAILABLE: S3 object body is missing");
      }
      return {
        body: output.Body,
        contentType: output.ContentType,
        contentLength: output.ContentLength,
      };
    },

    async putObject(input) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucketName,
          Key: input.key,
          Body: input.body,
          ContentType: input.mimeType,
          CacheControl: "private, no-store",
          ServerSideEncryption: "AES256",
        }),
      );
    },

    async deleteObject(key) {
      await client.send(
        new DeleteObjectCommand({ Bucket: config.bucketName, Key: key }),
      );
    },
  };
}
