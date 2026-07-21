"use client";

import type { MemberProfileEditorView, ProfileVisibility, RosterIdentity } from "./types";

type RosterProfileState = Pick<
  MemberProfileEditorView,
  "defaultRosterIdentity" | "visibility" | "isPublished"
>;

export function registrationRosterIdentity(profile: RosterProfileState): RosterIdentity {
  if (!profile.isPublished || profile.visibility === "PRIVATE") return "ANONYMOUS";
  return profile.defaultRosterIdentity;
}

export function RosterIdentityField({
  idPrefix,
  value,
  onChange,
  defaultIdentity,
  visibility,
  isPublished,
  context,
  disabled = false,
}: {
  idPrefix: string;
  value: RosterIdentity | null;
  onChange: (value: RosterIdentity) => void;
  defaultIdentity: RosterIdentity;
  visibility: ProfileVisibility;
  isPublished: boolean;
  context: "registration" | "existing-rsvp";
  disabled?: boolean;
}) {
  const forcedAnonymous = !isPublished || visibility === "PRIVATE";
  const displayedValue = forcedAnonymous ? "ANONYMOUS" : value;
  const name = `${idPrefix}-roster-identity`;

  return (
    <fieldset className="roster-identity-field" disabled={disabled}>
      <legend>How should you appear on this event roster?</legend>
      <p>
        {context === "registration"
          ? `Your saved default is ${defaultIdentity.toLowerCase()}. It initializes this future registration only.`
          : "This existing RSVP is edited separately. Changing your saved default will not change it."}
      </p>
      <div className="roster-identity-options">
        <label htmlFor={`${idPrefix}-visible`}>
          <input
            id={`${idPrefix}-visible`}
            type="radio"
            name={name}
            value="VISIBLE"
            checked={displayedValue === "VISIBLE"}
            onChange={() => onChange("VISIBLE")}
            disabled={disabled || forcedAnonymous}
            required
          />
          <span><strong>Visible</strong> Show my published rider card to signed-in members.</span>
        </label>
        <label htmlFor={`${idPrefix}-anonymous`}>
          <input
            id={`${idPrefix}-anonymous`}
            type="radio"
            name={name}
            value="ANONYMOUS"
            checked={displayedValue === "ANONYMOUS"}
            onChange={() => onChange("ANONYMOUS")}
            required
          />
          <span><strong>Anonymous</strong> Count me without showing my rider card.</span>
        </label>
      </div>
      {forcedAnonymous ? (
        <p className="roster-identity-field__notice">
          {visibility === "PRIVATE"
            ? "A private profile is always anonymous on event rosters."
            : "An unpublished profile is always anonymous on event rosters."}
        </p>
      ) : null}
    </fieldset>
  );
}
