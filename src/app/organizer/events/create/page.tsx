import { OrganizerConsole } from "@/features/organizer/organizer-console";
import { loadRejectedEventCopySource } from "@/server/organizer/event-submission-actions";

export default async function Page(
  props: PageProps<"/organizer/events/create">,
) {
  const searchParams = await props.searchParams;
  const copyId =
    typeof searchParams.copy === "string" && searchParams.copy.length <= 200
      ? searchParams.copy
      : undefined;
  const copyDefaults = copyId
    ? await loadRejectedEventCopySource(copyId)
    : undefined;

  return (
    <OrganizerConsole
      section="create"
      copyDefaults={copyDefaults ?? undefined}
    />
  );
}
