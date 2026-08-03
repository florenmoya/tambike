import { Input } from "@/components/ui/input";
import { EVENT_LOCATION_LIMITS } from "@/features/tambike-demo/event-location";
import type {
  CreateEventInput,
  EventType,
} from "@/features/tambike-demo/types";

const eventTypes: EventType[] = [
  "Tambike",
  "Bike Night",
  "Coffee Ride",
  "Club EB",
  "Brand Event",
  "Test Ride",
  "Charity Ride",
  "Track Day",
  "Endurance Ride",
  "Moto Expo",
  "Race",
];

export type EventEditorFieldsProps = {
  idPrefix: string;
  defaults?: Partial<CreateEventInput>;
  disabled?: boolean;
  fieldErrors?: Record<string, string[]>;
};

export function EventEditorFields({
  defaults,
  disabled = false,
  fieldErrors,
  idPrefix,
}: EventEditorFieldsProps) {
  const inputProps = (name: keyof CreateEventInput) => {
    const errors = fieldErrors?.[name];
    return {
      "aria-describedby": errors?.length ? `${idPrefix}-${name}-error` : undefined,
      "aria-invalid": errors?.length ? true : undefined,
      disabled,
      id: `${idPrefix}-${name}`,
      name,
    };
  };

  return (
    <>
      <EditorField
        error={fieldErrors?.title?.[0]}
        htmlFor={`${idPrefix}-title`}
        label="Event title"
      >
        <Input
          {...inputProps("title")}
          className="min-h-11"
          required
          maxLength={160}
          autoComplete="off"
          defaultValue={defaults?.title ?? ""}
          placeholder="Example: Quezon City Night Ride"
        />
      </EditorField>

      <EditorField
        error={fieldErrors?.type?.[0]}
        htmlFor={`${idPrefix}-type`}
        label="Event type"
      >
        <select
          {...inputProps("type")}
          className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          required
          autoComplete="off"
          defaultValue={defaults?.type ?? "Tambike"}
        >
          {eventTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </EditorField>

      <EditorField
        error={fieldErrors?.recurrence?.[0]}
        htmlFor={`${idPrefix}-recurrence`}
        label="Schedule"
      >
        <select
          {...inputProps("recurrence")}
          className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          required
          autoComplete="off"
          defaultValue={defaults?.recurrence ?? "NONE"}
        >
          <option value="NONE">One-time event</option>
        </select>
      </EditorField>

      <EditorField
        error={fieldErrors?.startDate?.[0]}
        htmlFor={`${idPrefix}-startDate`}
        label="Start date"
      >
        <Input
          {...inputProps("startDate")}
          className="min-h-11"
          type="date"
          required
          autoComplete="off"
          defaultValue={defaults?.startDate ?? ""}
        />
      </EditorField>
      <EditorField
        error={fieldErrors?.startTime?.[0]}
        htmlFor={`${idPrefix}-startTime`}
        label="Start time"
      >
        <Input
          {...inputProps("startTime")}
          className="min-h-11"
          type="time"
          required
          autoComplete="off"
          defaultValue={defaults?.startTime ?? ""}
        />
      </EditorField>
      <EditorField
        error={fieldErrors?.endDate?.[0]}
        htmlFor={`${idPrefix}-endDate`}
        label="End date"
      >
        <Input
          {...inputProps("endDate")}
          className="min-h-11"
          type="date"
          required
          autoComplete="off"
          defaultValue={defaults?.endDate ?? ""}
        />
      </EditorField>
      <EditorField
        error={fieldErrors?.endTime?.[0]}
        htmlFor={`${idPrefix}-endTime`}
        label="End time"
      >
        <Input
          {...inputProps("endTime")}
          className="min-h-11"
          type="time"
          required
          autoComplete="off"
          defaultValue={defaults?.endTime ?? ""}
        />
      </EditorField>
      <EditorField
        error={fieldErrors?.timeZone?.[0]}
        htmlFor={`${idPrefix}-timeZone`}
        label="Time zone"
      >
        <select
          {...inputProps("timeZone")}
          className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          required
          autoComplete="off"
          defaultValue={defaults?.timeZone ?? "Asia/Manila"}
        >
          <option value="Asia/Manila">Philippines (Asia/Manila)</option>
        </select>
      </EditorField>

      <EditorField
        error={fieldErrors?.locationName?.[0]}
        htmlFor={`${idPrefix}-locationName`}
        label="Location name"
      >
        <Input
          {...inputProps("locationName")}
          className="min-h-11"
          required
          maxLength={EVENT_LOCATION_LIMITS.name}
          autoComplete="off"
          defaultValue={defaults?.locationName ?? ""}
          placeholder="Example: Quezon Memorial Circle"
        />
      </EditorField>
      <EditorField
        error={fieldErrors?.locationAddress?.[0]}
        htmlFor={`${idPrefix}-locationAddress`}
        label="Location address"
      >
        <Input
          {...inputProps("locationAddress")}
          className="min-h-11"
          required
          maxLength={EVENT_LOCATION_LIMITS.address}
          autoComplete="off"
          defaultValue={defaults?.locationAddress ?? ""}
          placeholder="Example: Elliptical Road, Quezon City"
        />
      </EditorField>
      <EditorField
        error={fieldErrors?.locationMapLink?.[0]}
        htmlFor={`${idPrefix}-locationMapLink`}
        label="Map link"
      >
        <Input
          {...inputProps("locationMapLink")}
          className="min-h-11"
          type="url"
          maxLength={EVENT_LOCATION_LIMITS.mapLink}
          autoComplete="off"
          defaultValue={defaults?.locationMapLink ?? ""}
          placeholder="Example: https://maps.google.com/…"
        />
      </EditorField>
      <EditorField
        error={fieldErrors?.area?.[0]}
        htmlFor={`${idPrefix}-area`}
        label="Area"
      >
        <Input
          {...inputProps("area")}
          className="min-h-11"
          required
          maxLength={EVENT_LOCATION_LIMITS.area}
          autoComplete="off"
          defaultValue={defaults?.area ?? ""}
          placeholder="Example: Quezon City"
        />
      </EditorField>
      <EditorField
        error={fieldErrors?.expectedRiders?.[0]}
        htmlFor={`${idPrefix}-expectedRiders`}
        label="Expected riders"
      >
        <Input
          {...inputProps("expectedRiders")}
          className="min-h-11"
          type="number"
          inputMode="numeric"
          min={1}
          max={100000}
          required
          autoComplete="off"
          defaultValue={defaults?.expectedRiders ?? 40}
        />
      </EditorField>
      <EditorField
        error={fieldErrors?.perkPreview?.[0]}
        htmlFor={`${idPrefix}-perkPreview`}
        label="Perk preview"
      >
        <Input
          {...inputProps("perkPreview")}
          className="min-h-11"
          required
          maxLength={500}
          autoComplete="off"
          defaultValue={defaults?.perkPreview ?? ""}
          placeholder="Example: Event sticker for checked-in riders"
        />
      </EditorField>
    </>
  );
}

function EditorField({
  children,
  error,
  htmlFor,
  label,
}: {
  children: React.ReactNode;
  error?: string;
  htmlFor: string;
  label: string;
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <label className="text-sm font-medium" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
