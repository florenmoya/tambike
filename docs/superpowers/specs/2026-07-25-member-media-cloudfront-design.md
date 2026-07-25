# Tambike Private Member Media CloudFront Design

## Goal

Deliver rider avatars and motorcycle photos through a dedicated Amazon CloudFront distribution while preserving Tambike's existing profile visibility, roster privacy, private S3 bucket, opaque application media IDs, and reversible production rollout.

## Current State

Tambike stores normalized WebP member media in the private Singapore S3 bucket created by `infra/aws/tambike-member-media.yaml`. Browser-facing DTOs contain only `/media/{mediaId}` URLs. Every request currently enters a Vercel route, resolves the opaque media ID through the database, applies profile and viewer authorization, reads the object from S3, and streams it with `Cache-Control: private, no-store`.

The production attendee roster currently requests 24 images for 12 visible riders. Live measurements showed every repeated request remained a Vercel cache miss. Representative 24 KB avatars took approximately 0.8 to 3.1 seconds, while 152 to 253 KB motorcycle images took approximately 2.3 to 2.5 seconds.

The AWS account's existing CloudFront distribution serves an unrelated heatmap bucket. It must not be modified or reused for Tambike member media.

## Selected Architecture

Create a dedicated CloudFront distribution in the existing `tambike-member-media` CloudFormation stack.

The distribution uses the existing private S3 bucket as its origin and an Origin Access Control that signs every S3 origin request. A bucket policy grants `cloudfront.amazonaws.com` read access only to finalized `media/*` objects and only when the request comes from this exact distribution. The existing S3 public-access block remains unchanged.

CloudFront viewer access is restricted by a trusted key group. Tambike owns the corresponding RSA 2048 private key outside the repository. The public key is supplied to CloudFormation and stored in a CloudFront key group; the base64-encoded private key is stored only as a production Vercel secret.

The existing `/media/{mediaId}` route remains the stable application URL:

1. Read the Tambike session cookie.
2. Resolve the opaque media ID and apply the current owner, administrator, public, members-only, private, published-profile, and suspended-user rules.
3. If CloudFront configuration is present, create a signed CloudFront URL for the authorized object's origin-relative path and return a temporary redirect.
4. If CloudFront configuration is absent, retain the current private S3 streaming behavior.
5. Collapse authorization, missing-object, and signing failures to the existing route-level `404` response.

Signed URLs expire after five minutes. The signed transport URL can contain the origin-relative object path because CloudFront must identify the S3 object, but Tambike must not serialize storage keys through member DTOs, server actions, JSON responses, logs, or error messages. The bucket name and raw S3 hostname remain hidden.

## CloudFront Caching

The distribution permits only `GET` and `HEAD`, redirects viewers to HTTPS, enables compression, and does not forward viewer cookies, query strings, or headers to S3.

Signed URL parameters are used for viewer authorization and are not part of the object cache identity. A dedicated cache policy uses:

- Minimum TTL: 60 seconds
- Default TTL: 86,400 seconds
- Maximum TTL: 31,536,000 seconds

The positive minimum TTL allows finalized immutable WebP bytes to be cached even though existing S3 objects were uploaded with private/no-store metadata. Tambike media replacement creates a new media ID and object path, so cached bytes are immutable and do not require invalidation. Deleted or replaced signed URLs expire within five minutes; CloudFront still requires a valid signature before serving cached bytes.

## Application Configuration

Add these server-only environment variables:

- `MEMBER_MEDIA_CLOUDFRONT_DOMAIN`: exact CloudFront distribution domain without a scheme or path
- `MEMBER_MEDIA_CLOUDFRONT_PUBLIC_KEY_ID`: CloudFront public key ID returned by the stack
- `MEMBER_MEDIA_CLOUDFRONT_PRIVATE_KEY_BASE64`: base64-encoded PKCS#8 or PKCS#1 PEM private key
- `MEMBER_MEDIA_CLOUDFRONT_URL_TTL_SECONDS`: optional integer, default `300`, allowed range `60` to `900`

Configuration parsing must reject schemes, paths, whitespace, malformed base64, non-PEM values, and out-of-range TTLs. If all CloudFront variables are absent, delivery falls back to direct private streaming. A partial configuration is an operational error and must never silently weaken access control.

Use `@aws-sdk/cloudfront-signer` for URL signing. No client-side variable or private key is introduced.

## Infrastructure as Code

Extend `infra/aws/tambike-member-media.yaml` with:

- A `CloudFrontPublicKeyEncoded` parameter.
- `AWS::CloudFront::OriginAccessControl`.
- `AWS::CloudFront::PublicKey`.
- `AWS::CloudFront::KeyGroup`.
- `AWS::CloudFront::CachePolicy`.
- `AWS::CloudFront::Distribution`.
- `AWS::S3::BucketPolicy` restricted by the distribution ARN and `media/*`.
- Outputs for distribution ID, distribution domain, public key ID, and key group ID.

The distribution stays on pay-as-you-go pricing and `PriceClass_200`. No CloudFront Function, Lambda@Edge function, WAF, access logging, alternate domain, Route 53 record, or ACM certificate is added in this rollout.

The deployment guide must document key generation without printing private material, CloudFormation validation and deployment, output inspection, Vercel secret configuration, rollback, and key rotation. The private key must never be committed, echoed, included in command output, or written under the repository.

## Error Handling and Rollback

An unavailable signer or partial CDN configuration returns the same hidden `404` route response and emits no secret or storage-key detail to the viewer.

Production rollback is application-first:

1. Remove the four CloudFront environment variables.
2. redeploy the already-tested application.
3. verify `/media/{mediaId}` has returned to direct private streaming.

The dedicated distribution can remain deployed while diagnosing an application rollback because it cannot read outside `media/*`, requires signed viewer requests, and cannot make the bucket public. CloudFormation rollback remains available for failed infrastructure updates. The retained S3 bucket must never be deleted as part of CDN rollback.

## Testing

### Unit and contract tests

- CloudFront configuration accepts a complete valid set and rejects partial or malformed values.
- Signed URL generation uses HTTPS, the configured domain and public key ID, the authorized storage path, and a bounded expiration.
- `/media/{mediaId}` keeps the direct-stream fallback when CDN configuration is absent.
- An authorized CDN request returns a temporary redirect with private/no-store response headers.
- Unauthorized, missing, and signing failures remain indistinguishable `404` responses.
- No storage key appears in member DTOs, server-action responses, or error bodies.
- CloudFormation defines a private OAC-backed S3 origin, trusted key group, bounded cache policy, exact-source bucket policy, and required outputs.

### Repository gates

- Targeted Vitest suites pass.
- Full server test suite passes.
- Lint passes.
- Production build passes.
- `git diff --check` passes.
- CloudFormation template validation passes in `ap-southeast-1`.

### Production verification

- The new distribution reports `Deployed`.
- The member-media bucket remains blocked from anonymous S3 access.
- An unsigned CloudFront object request returns `403`.
- An authenticated `/media/{mediaId}` request redirects to the dedicated CloudFront domain.
- The signed CloudFront response is `image/webp`.
- Repeating the signed request produces a CloudFront cache hit.
- The attendee page retains 15 Going, 12 visible riders, and 3 anonymous riders.
- Private and unpublished media remain unavailable to unauthorized viewers.
- Browser console and recent Vercel error logs remain clean.
- AWS Cost Explorer remains monitored; the rollout does not claim CloudFront is permanently free.

## Alternatives Considered

### Reuse the heatmap distribution

This would add a second origin and ordered path behavior to the existing distribution. It was rejected because unrelated applications would share cache, certificate, security, logging, deployment, and failure boundaries. A behavior-order mistake could route private Tambike content through the heatmap policy.

### Keep CloudFront fully opaque by using Vercel as its origin

CloudFront could cache responses from a secret Vercel origin route while viewer URLs expose only media IDs. This preserves complete storage-path opacity but leaves Vercel, database authorization, and S3 in the cold-cache path and makes first-load latency worse. It was rejected in favor of direct private S3 origin access with signed viewer URLs.

### Make S3 or CloudFront public

This would be simpler but breaks members-only, private, unpublished-profile, owner, and administrator access rules. It is not acceptable.
