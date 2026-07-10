import { AdminConsole } from "@/features/admin/admin-console";

export default async function Page({ params }: { params: Promise<{ organizerId: string }> }) {
  const { organizerId } = await params;
  return <AdminConsole section="organizers" organizerId={organizerId} />;
}
