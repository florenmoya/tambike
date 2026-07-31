import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function RiderProfileNotFound() {
  return (
    <main className="garage-profile-page">
      <section className="garage-profile-not-found">
        <span>Profile</span>
        <h1>This profile is not available</h1>
        <p>This profile may be private, members-only, unpublished, or no longer at this address.</p>
        <Button asChild><Link href="/events">Explore events</Link></Button>
      </section>
    </main>
  );
}
