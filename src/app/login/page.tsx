import { TambikeScreen } from "@/features/tambike-demo/tambike-screen";

function safeNextHref(value: string | string[] | undefined) {
  const nextHref = Array.isArray(value) ? value[0] : value;
  if (!nextHref?.startsWith("/") || nextHref.startsWith("//")) {
    return undefined;
  }

  const pathname = nextHref.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  return pathname === "/login" ? undefined : nextHref;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  return <TambikeScreen view="login" nextHref={safeNextHref(params.next)} />;
}
