import { Bike } from "lucide-react";

import { MemberMediaImage } from "./member-media-image";
import styles from "./profile-studio.module.css";
import type {
  MemberProfileEditorView,
  UpdateMemberProfileInput,
  UpsertMotorcycleInput,
} from "./types";

export interface ProfileStudioPreviewProps {
  editor: MemberProfileEditorView;
  profileDraft: UpdateMemberProfileInput;
  motorcycleDraft: UpsertMotorcycleInput;
}

export function ProfileStudioPreview({
  editor,
  profileDraft,
  motorcycleDraft,
}: ProfileStudioPreviewProps) {
  const visibilityLabel = {
    PUBLIC: "Public profile",
    MEMBERS_ONLY: "Members-only profile",
    PRIVATE: "Private profile",
  }[profileDraft.visibility];
  const cover = editor.motorcycle?.photos
    .toSorted((left, right) => left.position - right.position)
    .find((photo) => photo.url.startsWith("/media/"));

  return (
    <aside className={styles.studioPreview} aria-label="Garage preview">
      <span className={styles.studioPreviewEyebrow}>Garage preview</span>
      <div className={styles.studioPreviewHero}>
        {cover ? (
          <MemberMediaImage
            src={cover.url}
            alt="Cover photo"
            width={cover.width || 1200}
            height={cover.height || 900}
            sizes="(max-width: 900px) 100vw, 34vw"
          />
        ) : (
          <div className={styles.studioPreviewEmpty} aria-label="No cover photo">
            <Bike aria-hidden="true" />
          </div>
        )}
      </div>
      <div className={styles.studioPreviewIdentity}>
        <h2>{profileDraft.displayName || "Your rider name"}</h2>
        <p>{profileDraft.area || "Your area"}</p>
      </div>
      <span className={styles.studioPreviewVisibility}>{visibilityLabel}</span>
      <strong className={styles.studioPreviewSpecification}>
        {motorcycleDraft.make || "Motorcycle make"} {motorcycleDraft.model || "and model"}
      </strong>
      <p className={styles.studioPreviewNote}>
        {profileDraft.bio || "Add a short garage note to introduce your ride."}
      </p>
    </aside>
  );
}
