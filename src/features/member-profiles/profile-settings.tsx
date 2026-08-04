"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  Bike,
  Camera,
  LoaderCircle,
  Save,
  UserRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDemo } from "@/features/tambike-demo/demo-provider";
import type {
  MemberProfileEditorView,
  ProfileVisibility,
  RosterIdentity,
  UpdateMemberProfileInput,
  UpsertMotorcycleInput,
} from "./types";
import { ConfirmMediaDelete } from "./confirm-media-delete";
import { MemberMediaUploader } from "./member-media-uploader";
import { MemberMediaImage } from "./member-media-image";
import { MotorcyclePhotoWorkspace } from "./motorcycle-photo-workspace";
import { getProfileEditorPresentation } from "./profile-editor-presentation";
import { useUnsavedProfileGuard } from "./use-unsaved-profile-guard";
import styles from "./profile-studio.module.css";

function actionErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("INVALID_INPUT")) return "Check the highlighted details and try again.";
  if (message.includes("PHOTO_LIMIT")) return "This garage already has five motorcycle photos.";
  return "Changes could not be saved. Try again.";
}

function mediaIdFromUrl(url: string) {
  const prefix = "/media/";
  if (!url.startsWith(prefix) || url.length === prefix.length) {
    throw new Error("INVALID_MEDIA_URL");
  }
  return decodeURIComponent(url.slice(prefix.length));
}

function optionalNumber(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text ? Number(text) : undefined;
}

export function profileInputFromFormData(formData: FormData): UpdateMemberProfileInput {
  return {
    displayName: String(formData.get("displayName") ?? ""),
    area: String(formData.get("area") ?? ""),
    bio: String(formData.get("bio") ?? ""),
    visibility: String(formData.get("visibility") ?? "") as ProfileVisibility,
    defaultRosterIdentity: String(
      formData.get("defaultRosterIdentity") ?? "",
    ) as RosterIdentity,
  };
}

export function profileInputFromSubmitEvent(
  event: Pick<FormEvent<HTMLFormElement>, "currentTarget" | "preventDefault">,
): UpdateMemberProfileInput {
  event.preventDefault();
  return profileInputFromFormData(new FormData(event.currentTarget));
}

interface ProfileDraft {
  displayName: string;
  area: string;
  bio: string;
  visibility: ProfileVisibility;
  defaultRosterIdentity: RosterIdentity;
}

interface EditorRefreshState {
  editor: MemberProfileEditorView;
  draft: ProfileDraft;
  profileDirty: boolean;
  motorcycleDraft: UpsertMotorcycleInput;
  motorcycleDirty: boolean;
}

function profileDraftFromEditor(editor: MemberProfileEditorView): ProfileDraft {
  return {
    displayName: editor.displayName,
    area: editor.area,
    bio: editor.bio ?? "",
    visibility: editor.visibility,
    defaultRosterIdentity: editor.defaultRosterIdentity,
  };
}

export function motorcycleDraftFromEditor(
  editor: MemberProfileEditorView,
): UpsertMotorcycleInput {
  return {
    make: editor.motorcycle?.make ?? "",
    model: editor.motorcycle?.model ?? "",
    year: editor.motorcycle?.year,
    displacementCc: editor.motorcycle?.displacementCc,
    nickname: editor.motorcycle?.nickname ?? "",
    description: editor.motorcycle?.description ?? "",
  };
}

export function reconcileMotorcycleDraft(
  draft: UpsertMotorcycleInput,
  dirty: boolean,
  refreshed: MemberProfileEditorView,
): UpsertMotorcycleInput {
  return dirty ? draft : motorcycleDraftFromEditor(refreshed);
}

export function reconcileEditorRefresh(
  state: EditorRefreshState,
  refreshed: MemberProfileEditorView,
): EditorRefreshState {
  return {
    editor: refreshed,
    draft: state.profileDirty ? state.draft : profileDraftFromEditor(refreshed),
    profileDirty: state.profileDirty,
    motorcycleDraft: reconcileMotorcycleDraft(
      state.motorcycleDraft,
      state.motorcycleDirty,
      refreshed,
    ),
    motorcycleDirty: state.motorcycleDirty,
  };
}

export function reorderedMotorcyclePhotos(
  photos: NonNullable<MemberProfileEditorView["motorcycle"]>["photos"],
  fromIndex: number,
  toIndex: number,
) {
  if (
    fromIndex < 0 ||
    fromIndex >= photos.length ||
    toIndex < 0 ||
    toIndex >= photos.length ||
    fromIndex === toIndex
  ) {
    return photos;
  }

  const reordered = [...photos];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);
  return reordered.map((photo, position) => ({ ...photo, position }));
}

function editorHasMotorcyclePhotoOrder(
  editor: MemberProfileEditorView,
  intendedMediaIds: string[],
) {
  const savedPhotos =
    editor.motorcycle?.photos.toSorted((left, right) => left.position - right.position) ?? [];
  return (
    savedPhotos.length === intendedMediaIds.length &&
    savedPhotos.every(
      (photo, position) =>
        photo.position === position &&
        mediaIdFromUrl(photo.url) === intendedMediaIds[position],
    )
  );
}

export async function persistMotorcyclePhotoOrder(
  intendedPhotos: NonNullable<MemberProfileEditorView["motorcycle"]>["photos"],
  dependencies: {
    reorderMotorcyclePhotos: (mediaIds: string[]) => Promise<MemberProfileEditorView>;
    getMemberProfileEditor: () => Promise<MemberProfileEditorView>;
  },
) {
  const intendedMediaIds = intendedPhotos.map((photo) => mediaIdFromUrl(photo.url));
  const actionEditor = await dependencies.reorderMotorcyclePhotos(intendedMediaIds);
  if (editorHasMotorcyclePhotoOrder(actionEditor, intendedMediaIds)) {
    return actionEditor;
  }

  const refreshedEditor = await dependencies.getMemberProfileEditor();
  if (editorHasMotorcyclePhotoOrder(refreshedEditor, intendedMediaIds)) {
    return refreshedEditor;
  }

  throw new Error("MOTORCYCLE_PHOTO_ORDER_NOT_SAVED");
}

export function ProfileViewAction({
  viewAction,
  profileDirty,
  motorcycleDirty,
}: {
  viewAction: { label: string; href: string };
  profileDirty: boolean;
  motorcycleDirty: boolean;
}) {
  const dirty = profileDirty || motorcycleDirty;
  const label =
    dirty && viewAction.href === "/profile/preview"
      ? "Preview saved profile"
      : viewAction.label;

  return (
    <>
      <Button asChild variant="outline">
        <Link
          href={viewAction.href}
          aria-describedby={dirty ? "profile-view-action-help" : undefined}
        >
          {label}
        </Link>
      </Button>
      {dirty ? (
        <span
          id="profile-view-action-help"
          className={styles.studioViewActionHint}
        >
          Unsaved changes are not included.
        </span>
      ) : null}
    </>
  );
}

export function ProfileStudioHeader({
  presentation,
  profileDirty,
  motorcycleDirty,
}: {
  presentation: ReturnType<typeof getProfileEditorPresentation>;
  profileDirty: boolean;
  motorcycleDirty: boolean;
}) {
  return (
    <header className={styles.studioHeader}>
      <div className={styles.studioHeading}>
        <span>Profile</span>
        <h1 id="profile-settings-title">Your profile</h1>
        <p>Add the details people see when they open your profile.</p>
      </div>
      <div className={styles.studioHeaderActions}>
        <span className={styles.studioState} data-state={presentation.state}>
          {presentation.label}
        </span>
        <ProfileViewAction
          viewAction={presentation.viewAction}
          profileDirty={profileDirty}
          motorcycleDirty={motorcycleDirty}
        />
      </div>
    </header>
  );
}

export function ProfileSaveFooter({
  pending,
  status,
}: {
  pending: boolean;
  status: string;
}) {
  return (
    <section
      className={styles.profileDetailsSaveFooter}
      aria-label="Save profile"
    >
      <div className={styles.profileDetailsSaveCopy}>
        <span>
          Saves your profile and motorcycle details. Photos upload automatically
          when selected.
        </span>
      </div>
      <div className={styles.profileDetailsSaveActions}>
        <Button
          type="submit"
          size="lg"
          disabled={pending}
          className={styles.profileDetailsSaveButton}
        >
          {pending ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <Save aria-hidden="true" />
          )}
          {pending ? "Saving…" : "Save profile"}
        </Button>
        <p className={styles.profileDetailsSaveStatus} aria-live="polite">
          {status}
        </p>
      </div>
    </section>
  );
}

export function ProfileSaveFieldset({
  pending,
  children,
}: {
  pending: boolean;
  children: ReactNode;
}) {
  return (
    <fieldset className="profile-save-fieldset" disabled={pending} aria-busy={pending}>
      {children}
    </fieldset>
  );
}

export function ProfileSettings() {
  const { currentUser, getMemberProfileEditor } = useDemo();
  const [initialEditor, setInitialEditor] = useState<MemberProfileEditorView | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;
    getMemberProfileEditor()
      .then((editor) => {
        if (active) setInitialEditor(editor);
      })
      .catch((error) => {
        if (active) setLoadError(actionErrorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [getMemberProfileEditor]);

  if (!currentUser) return null;

  if (loadError) {
    return <p className="profile-settings-load" role="alert">{loadError}</p>;
  }

  if (!initialEditor) {
    return (
      <div className="profile-settings-load" aria-live="polite">
        <LoaderCircle className="animate-spin" aria-hidden="true" /> Loading garage settings…
      </div>
    );
  }

  return <LoadedProfileSettings initialEditor={initialEditor} />;
}

function LoadedProfileSettings({
  initialEditor,
}: {
  initialEditor: MemberProfileEditorView;
}) {
  const {
    getMemberProfileEditor,
    updateMemberProfile,
    upsertMotorcycle,
    deleteMemberMedia,
    reorderMotorcyclePhotos,
  } = useDemo();
  const [profileEditorState, setProfileEditorState] = useState<EditorRefreshState>(() => ({
    editor: initialEditor,
    draft: profileDraftFromEditor(initialEditor),
    profileDirty: false,
    motorcycleDraft: motorcycleDraftFromEditor(initialEditor),
    motorcycleDirty: false,
  }));
  const {
    editor,
    draft: profileDraft,
    profileDirty,
    motorcycleDraft,
    motorcycleDirty,
  } = profileEditorState;
  const [saveStatus, setSaveStatus] = useState("");
  const [mediaStatus, setMediaStatus] = useState("");
  const [savePending, setSavePending] = useState(false);
  const [mediaPending, setMediaPending] = useState(false);
  useUnsavedProfileGuard(profileDirty || motorcycleDirty);
  const photos = editor.motorcycle?.photos.toSorted((left, right) => left.position - right.position) ?? [];
  const presentation = getProfileEditorPresentation({
    isPublished: editor.isPublished,
    slug: editor.slug,
    visibility: editor.visibility,
    displayName: profileDraft.displayName,
    area: profileDraft.area,
    make: motorcycleDraft.make,
    model: motorcycleDraft.model,
    photoCount: photos.length,
  });

  const refreshEditor = async () => {
    const refreshed = await getMemberProfileEditor();
    setProfileEditorState((current) => reconcileEditorRefresh(current, refreshed));
  };

  const updateProfileDraft = (changes: Partial<ProfileDraft>) => {
    setProfileEditorState((current) => ({
      ...current,
      draft: { ...current.draft, ...changes },
      profileDirty: true,
    }));
  };

  const updateMotorcycleDraft = (changes: Partial<UpsertMotorcycleInput>) => {
    setProfileEditorState((current) => ({
      ...current,
      motorcycleDraft: { ...current.motorcycleDraft, ...changes },
      motorcycleDirty: true,
    }));
  };

  const handleSaveProfile = async (input: UpdateMemberProfileInput) => {
    setSavePending(true);
    setSaveStatus("");
    let profileSaved = false;

    try {
      const saved = await updateMemberProfile(input);
      profileSaved = true;
      setProfileEditorState((current) => ({
        ...current,
        editor: saved,
        draft: profileDraftFromEditor(saved),
        profileDirty: false,
        motorcycleDraft: reconcileMotorcycleDraft(
          current.motorcycleDraft,
          current.motorcycleDirty,
          saved,
        ),
      }));

      let refreshed = saved;
      if (motorcycleDirty) {
        await upsertMotorcycle(motorcycleDraft);
        refreshed = await getMemberProfileEditor();
      }

      setProfileEditorState((current) => ({
        ...current,
        editor: refreshed,
        draft: profileDraftFromEditor(refreshed),
        profileDirty: false,
        motorcycleDraft: motorcycleDraftFromEditor(refreshed),
        motorcycleDirty: false,
      }));
      setSaveStatus(
        refreshed.visibility === "PRIVATE"
          ? "Profile saved. It remains private."
          : "Profile saved.",
      );
    } catch (error) {
      setSaveStatus(
        profileSaved
          ? "Profile details saved, but motorcycle changes could not be saved. Try again."
          : actionErrorMessage(error),
      );
    } finally {
      setSavePending(false);
    }
  };

  const removeMedia = async (url: string, label: string) => {
    setMediaPending(true);
    setMediaStatus("");
    try {
      const refreshed = await deleteMemberMedia(mediaIdFromUrl(url));
      setProfileEditorState((current) => reconcileEditorRefresh(current, refreshed));
      setMediaStatus(`${label} deleted.`);
    } catch (error) {
      setMediaStatus(actionErrorMessage(error));
    } finally {
      setMediaPending(false);
    }
  };

  const movePhoto = async (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= photos.length) return;
    const reordered = reorderedMotorcyclePhotos(photos, index, nextIndex);
    setMediaPending(true);
    setMediaStatus("");
    try {
      const refreshed = await persistMotorcyclePhotoOrder(reordered, {
        reorderMotorcyclePhotos,
        getMemberProfileEditor,
      });
      setProfileEditorState((current) => reconcileEditorRefresh(current, refreshed));
      setMediaStatus(
        `Photo ${index + 1} moved to the ${direction < 0 ? "previous" : "next"} position.`,
      );
    } catch (error) {
      setMediaStatus(actionErrorMessage(error));
    } finally {
      setMediaPending(false);
    }
  };

  const reorderPhoto = async (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const reordered = reorderedMotorcyclePhotos(photos, fromIndex, toIndex);
    setMediaPending(true);
    setMediaStatus("");
    try {
      const refreshed = await persistMotorcyclePhotoOrder(reordered, {
        reorderMotorcyclePhotos,
        getMemberProfileEditor,
      });
      setProfileEditorState((current) => reconcileEditorRefresh(current, refreshed));
      setMediaStatus("Motorcycle photo order saved.");
    } catch (error) {
      setMediaStatus(actionErrorMessage(error));
    } finally {
      setMediaPending(false);
    }
  };

  return (
    <div
      className={`profile-settings ${styles.studio}`}
      aria-labelledby="profile-settings-title"
    >
      <ProfileStudioHeader
        presentation={presentation}
        profileDirty={profileDirty}
        motorcycleDirty={motorcycleDirty}
      />
      <p className={styles.requiredLegend}>* Needed for a complete profile</p>

      <form
        id="profile-settings-form"
        onSubmit={(event) => {
          void handleSaveProfile(profileInputFromSubmitEvent(event));
        }}
        className={styles.studioEditor}
      >
        <ProfileSaveFieldset pending={savePending}>
         <div className="profile-settings__grid">
         <Card id="profile-identity" className="profile-settings__section">
          <CardHeader>
            <CardTitle><UserRound aria-hidden="true" /> Profile details</CardTitle>
          </CardHeader>
          <CardContent className="profile-fields">
            <div className="profile-field">
              <Label htmlFor="profile-display-name">Display name *</Label>
              <Input id="profile-display-name" name="displayName" required value={profileDraft.displayName} maxLength={80} onChange={(event) => updateProfileDraft({ displayName: event.currentTarget.value })} />
            </div>
            <div className="profile-field">
              <Label htmlFor="profile-area">Area / city *</Label>
              <Input id="profile-area" name="area" required value={profileDraft.area} maxLength={80} onChange={(event) => updateProfileDraft({ area: event.currentTarget.value })} />
            </div>
            <div className="profile-field profile-field--wide">
              <Label htmlFor="profile-bio">About you (optional)</Label>
              <textarea id="profile-bio" name="bio" value={profileDraft.bio} maxLength={500} rows={5} onChange={(event) => updateProfileDraft({ bio: event.currentTarget.value })} />
              <span>Avoid phone numbers, email addresses, and exact locations. 500 characters maximum.</span>
            </div>
            <div className="profile-field">
              <Label htmlFor="profile-visibility">Profile visibility</Label>
              <input type="hidden" name="visibility" value={profileDraft.visibility} />
              <Select value={profileDraft.visibility} onValueChange={(value) => updateProfileDraft({ visibility: value as ProfileVisibility })}>
                <SelectTrigger id="profile-visibility" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PUBLIC">Public — anyone with the link</SelectItem>
                  <SelectItem value="MEMBERS_ONLY">Members only — signed-in members</SelectItem>
                  <SelectItem value="PRIVATE">Private — only you</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card id="attendance-privacy" className="profile-settings__section">
          <CardHeader>
            <CardTitle>Attendance privacy</CardTitle>
            <CardDescription>
              Used by default for every event roster.
            </CardDescription>
          </CardHeader>
          <CardContent className="profile-fields">
            <div className="profile-field profile-field--wide">
              <Label htmlFor="default-roster-identity">Default event roster identity</Label>
              <input type="hidden" name="defaultRosterIdentity" value={profileDraft.defaultRosterIdentity} />
              <Select
                value={profileDraft.defaultRosterIdentity}
                onValueChange={(value) => updateProfileDraft({ defaultRosterIdentity: value as RosterIdentity })}
              >
                <SelectTrigger id="default-roster-identity" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ANONYMOUS">Anonymous — count me without my card</SelectItem>
                  <SelectItem value="VISIBLE">Visible — show my profile</SelectItem>
                </SelectContent>
              </Select>
              <span>
                Private or unpublished profiles always appear anonymously.
              </span>
            </div>
          </CardContent>
        </Card>
         </div>

       <Card id="profile-avatar" className="profile-settings__section profile-settings__media-section">
        <CardHeader>
          <CardTitle><Camera aria-hidden="true" /> Profile photo (optional)</CardTitle>
        </CardHeader>
        <CardContent className="profile-avatar-editor">
          {editor.profilePhotoUrl ? (
            <MemberMediaImage src={editor.profilePhotoUrl} alt="Current avatar photo" width={512} height={512} sizes="112px" />
          ) : (
            <div className="profile-avatar-editor__empty" aria-label="No avatar photo"><UserRound aria-hidden="true" /></div>
          )}
          <div>
            <MemberMediaUploader purpose="avatar" photos={[]} onUploaded={refreshEditor} />
            {editor.profilePhotoUrl ? (
              <ConfirmMediaDelete
                label="profile photo"
                triggerLabel="Delete profile photo"
                disabled={mediaPending}
                onConfirm={() => removeMedia(editor.profilePhotoUrl!, "Profile photo")}
              />
            ) : null}
          </div>
        </CardContent>
      </Card>

       <Card id="profile-motorcycle" className="profile-settings__section">
          <CardHeader>
            <CardTitle><Bike aria-hidden="true" /> Motorcycle</CardTitle>
            <CardDescription>This motorcycle appears on your profile.</CardDescription>
          </CardHeader>
          <CardContent className="profile-fields">
            <div className="profile-field"><Label htmlFor="motorcycle-make">Make *</Label><Input id="motorcycle-make" name="make" required value={motorcycleDraft.make} onChange={(event) => updateMotorcycleDraft({ make: event.currentTarget.value })} placeholder="Honda" /></div>
            <div className="profile-field"><Label htmlFor="motorcycle-model">Model *</Label><Input id="motorcycle-model" name="model" required value={motorcycleDraft.model} onChange={(event) => updateMotorcycleDraft({ model: event.currentTarget.value })} placeholder="CB650R" /></div>
            <div className="profile-field"><Label htmlFor="motorcycle-year">Year (optional)</Label><Input id="motorcycle-year" name="year" type="number" min={1885} max={2100} value={motorcycleDraft.year ?? ""} onChange={(event) => updateMotorcycleDraft({ year: optionalNumber(event.currentTarget.value) })} /></div>
            <div className="profile-field"><Label htmlFor="motorcycle-displacement">Displacement (cc) (optional)</Label><Input id="motorcycle-displacement" name="displacementCc" type="number" min={1} max={10000} value={motorcycleDraft.displacementCc ?? ""} onChange={(event) => updateMotorcycleDraft({ displacementCc: optionalNumber(event.currentTarget.value) })} /></div>
            <div className="profile-field profile-field--wide"><Label htmlFor="motorcycle-nickname">Nickname (optional)</Label><Input id="motorcycle-nickname" name="nickname" value={motorcycleDraft.nickname ?? ""} onChange={(event) => updateMotorcycleDraft({ nickname: event.currentTarget.value })} placeholder="Ember" /></div>
            <div className="profile-field profile-field--wide"><Label htmlFor="motorcycle-description">Motorcycle note (optional)</Label><textarea id="motorcycle-description" name="description" value={motorcycleDraft.description ?? ""} onChange={(event) => updateMotorcycleDraft({ description: event.currentTarget.value })} maxLength={500} rows={4} /></div>
          </CardContent>
        </Card>

        <ProfileSaveFooter
          pending={savePending}
          status={saveStatus}
        />
        </ProfileSaveFieldset>

       <div id="motorcycle-photos">
         <MotorcyclePhotoWorkspace
           photos={photos}
           uploadEnabled={Boolean(editor.motorcycle)}
           mediaPending={mediaPending}
           onUploaded={refreshEditor}
           onMove={movePhoto}
           onReorder={reorderPhoto}
           onDelete={removeMedia}
         />
       </div>
      <p
        className={`profile-settings__media-status ${styles.mediaStatus}`}
        aria-live="polite"
      >
        {mediaStatus}
      </p>
      </form>
    </div>
  );
}
