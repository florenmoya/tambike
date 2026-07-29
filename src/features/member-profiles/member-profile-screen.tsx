import Link from "next/link";

import { RiderGarageView } from "./rider-garage-view";
import type { MemberProfileView } from "./types";

export function MemberProfileScreen({ profile }: { profile: MemberProfileView }) {
  return (
    <section className="garage-profile-page" aria-label={`${profile.displayName} rider garage`}>
      <div className="garage-profile-shell">
        <Link className="garage-profile-back" href="/events">
          Tambike / Rider garages
        </Link>
        <RiderGarageView profile={profile} prioritizeMedia />
      </div>
    </section>
  );
}
