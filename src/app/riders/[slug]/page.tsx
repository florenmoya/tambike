import { notFound } from "next/navigation";

import { MemberProfileScreen } from "@/features/member-profiles/member-profile-screen";
import { TambikeAppShell } from "@/features/tambike-demo/tambike-screen";
import { getMemberProfileAction } from "@/server/actions";

async function loadProfileOrNotFound(slug: string) {
  try {
    return await getMemberProfileAction(slug);
  } catch {
    notFound();
  }
}

export default async function RiderProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const profile = await loadProfileOrNotFound(slug);

  return (
    <TambikeAppShell>
      <MemberProfileScreen profile={profile} />
    </TambikeAppShell>
  );
}
