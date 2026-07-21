import type { MemberImageMimeType } from "./types";

export type MemberMediaBody = Uint8Array | AsyncIterable<Uint8Array>;

export interface CreatePresignedPostInput {
  key: string;
  mimeType: MemberImageMimeType;
  expiresInSeconds: number;
  minimumBytes: number;
  maximumBytes: number;
}

export interface PresignedPostFields {
  url: string;
  fields: Record<string, string>;
}

export interface StoredMemberMediaObject {
  body: MemberMediaBody;
  contentType?: string;
  contentLength?: number;
}

export interface PutMemberMediaObjectInput {
  key: string;
  body: Uint8Array;
  mimeType: MemberImageMimeType;
}

export interface MemberMediaStore {
  createPresignedPost(input: CreatePresignedPostInput): Promise<PresignedPostFields>;
  getObject(key: string): Promise<StoredMemberMediaObject>;
  putObject(input: PutMemberMediaObjectInput): Promise<void>;
  deleteObject(key: string): Promise<void>;
}
