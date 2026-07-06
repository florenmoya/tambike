import { TambikeScreen } from "@/features/tambike-demo/tambike-screen";

interface EventsPageProps {
  searchParams?: Promise<{
    q?: string | string[];
    type?: string | string[];
  }>;
}

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Page({ searchParams }: EventsPageProps) {
  const params = await searchParams;

  return <TambikeScreen view="events" eventQuery={{ q: firstParam(params?.q), type: firstParam(params?.type) }} />;
}
