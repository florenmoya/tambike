import { adminApproval } from "@/features/tambike-demo/data";
import { AdminConsole } from "@/features/admin/admin-console";

export function generateStaticParams() {
  return [{ reviewId: adminApproval.id }];
}

export default async function Page({ params }: { params: Promise<{ reviewId: string }> }) {
  const { reviewId } = await params;
  return <AdminConsole section="events" reviewId={reviewId} />;
}
