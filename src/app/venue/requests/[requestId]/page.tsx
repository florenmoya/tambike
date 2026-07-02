import { venueApproval } from "@/features/tambike-demo/data";
import { TambikeScreen } from "@/features/tambike-demo/tambike-screen";

export function generateStaticParams() {
  return [{ requestId: venueApproval.id }];
}

export default async function Page({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  return <TambikeScreen view="venue-request" id={requestId} />;
}
