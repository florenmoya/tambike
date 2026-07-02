import { TambikeScreen } from "@/features/tambike-demo/tambike-screen";

interface EventsPageProps {
  searchParams?: Promise<{
    type?: string | string[];
  }>;
}

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Page({ searchParams }: EventsPageProps) {
  const params = await searchParams;

  return <TambikeScreen view="events" eventQuery={{ type: firstParam(params?.type) }} />;
}
