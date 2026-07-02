import { adminApproval } from "@/features/tambike-demo/data";
import { TambikeScreen } from "@/features/tambike-demo/tambike-screen";

export function generateStaticParams() {
  return [{ reviewId: adminApproval.id }];
}

export default async function Page({ params }: { params: Promise<{ reviewId: string }> }) {
  const { reviewId } = await params;
  return <TambikeScreen view="admin-event-review" id={reviewId} />;
}
