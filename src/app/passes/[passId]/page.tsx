import { demoEvents } from "@/features/tambike-demo/data";
import { TambikeScreen } from "@/features/tambike-demo/tambike-screen";

export function generateStaticParams() {
  return demoEvents.map((event) => ({ passId: `pass-${event.id}` }));
}

export default async function Page({ params }: { params: Promise<{ passId: string }> }) {
  const { passId } = await params;
  return <TambikeScreen view="pass-detail" id={passId} />;
}
