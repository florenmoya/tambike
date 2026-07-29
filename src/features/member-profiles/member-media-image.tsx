import Image, { type ImageProps } from "next/image";

export function MemberMediaImage({ alt, ...props }: ImageProps) {
  return <Image {...props} alt={alt} unoptimized />;
}
