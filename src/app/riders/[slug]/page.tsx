import { notFound } from "next/navigation";

import { MemberProfileScreen } from "@/features/member-profiles/member-profile-screen";
import type { MemberProfileView } from "@/features/member-profiles/types";
import { TambikeAppShell } from "@/features/tambike-demo/tambike-screen";
import { getMemberProfileAction } from "@/server/actions";
import { BackendError } from "@/server/backend";

export async function loadRiderProfile(
  slug: string,
  getProfile: (slug: string) => Promise<MemberProfileView> = getMemberProfileAction,
  showNotFound: () => never = () => notFound(),
) {
  try {
    return await getProfile(slug);
  } catch (error) {
    if (error instanceof BackendError && error.code === "NOT_FOUND") {
      return showNotFound();
    }
    throw error;
  }
}

export default async function RiderProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const profile = await loadRiderProfile(slug);

  return (
    <TambikeAppShell>
      <MemberProfileScreen profile={profile} />
    </TambikeAppShell>
  );
}
