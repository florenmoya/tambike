"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import {
  Bike,
  Camera,
  LoaderCircle,
  Save,
  Trash2,
  UserRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import { MemberMediaUploader } from "./member-media-uploader";
import { MemberMediaImage } from "./member-profile-screen";
import { MotorcyclePhotoWorkspace } from "./motorcycle-photo-workspace";
import { ProfileStudioPreview } from "./profile-studio-preview";
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
    motorcycleDraft,
  } = profileEditorState;
  const [profileStatus, setProfileStatus] = useState("");
  const [motorcycleStatus, setMotorcycleStatus] = useState("");
  const [mediaStatus, setMediaStatus] = useState("");
  const [profilePending, setProfilePending] = useState(false);
  const [motorcyclePending, setMotorcyclePending] = useState(false);
  const [mediaPending, setMediaPending] = useState(false);
  const photos = editor.motorcycle?.photos.toSorted((left, right) => left.position - right.position) ?? [];

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

  const handleProfileSave = async (formData: FormData) => {
    setProfilePending(true);
    setProfileStatus("");
    try {
      const saved = await updateMemberProfile(profileInputFromFormData(formData));
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
      setProfileStatus(saved.isPublished ? "Profile changes saved." : "Private profile saved.");
    } catch (error) {
      setProfileStatus(actionErrorMessage(error));
    } finally {
      setProfilePending(false);
    }
  };

  const handleMotorcycleSave = async () => {
    setMotorcyclePending(true);
    setMotorcycleStatus("");
    try {
      await upsertMotorcycle(motorcycleDraft);
      const refreshed = await getMemberProfileEditor();
      setProfileEditorState((current) => ({
        ...reconcileEditorRefresh(current, refreshed),
        motorcycleDraft: motorcycleDraftFromEditor(refreshed),
        motorcycleDirty: false,
      }));
      setMotorcycleStatus("Motorcycle details saved.");
    } catch (error) {
      setMotorcycleStatus(actionErrorMessage(error));
    } finally {
      setMotorcyclePending(false);
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
    const reordered = [...photos];
    [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
    setMediaPending(true);
    setMediaStatus("");
    try {
      const refreshed = await reorderMotorcyclePhotos(
        reordered.map((photo) => mediaIdFromUrl(photo.url)),
      );
      setProfileEditorState((current) => reconcileEditorRefresh(current, refreshed));
      setMediaStatus(`Photo ${index + 1} moved ${direction < 0 ? "earlier" : "later"}.`);
    } catch (error) {
      setMediaStatus(actionErrorMessage(error));
    } finally {
      setMediaPending(false);
    }
  };

  const reorderPhoto = async (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const reordered = [...photos];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    setMediaPending(true);
    setMediaStatus("");
    try {
      const refreshed = await reorderMotorcyclePhotos(
        reordered.map((photo) => mediaIdFromUrl(photo.url)),
      );
      setProfileEditorState((current) => reconcileEditorRefresh(current, refreshed));
      setMediaStatus("Motorcycle photo order saved.");
    } catch (error) {
      setMediaStatus(actionErrorMessage(error));
    } finally {
      setMediaPending(false);
    }
  };

  const publishLabel = !editor.isPublished && profileDraft.visibility !== "PRIVATE"
    ? "Publish profile"
    : "Save profile changes";
  const readinessItems = [
    {
      label: "Identity",
      ready: Boolean(profileDraft.displayName.trim() && profileDraft.area.trim()),
    },
    { label: "Avatar", ready: Boolean(editor.profilePhotoUrl) },
    {
      label: "Motorcycle",
      ready: Boolean(motorcycleDraft.make.trim() && motorcycleDraft.model.trim()),
    },
    { label: "Photos", ready: photos.length > 0 },
  ];
  const readyItems = readinessItems.filter((item) => item.ready);

  return (
    <div
      className={`profile-settings ${styles.studio}`}
      aria-labelledby="profile-settings-title"
    >
      <header className={styles.studioHeader}>
        <div>
          <span>Rider profile</span>
          <h1 id="profile-settings-title">Garage Studio</h1>
          <p>Build the rider card people see before the next meetup.</p>
        </div>
        {editor.slug ? (
          <Button asChild>
            <Link href={`/riders/${editor.slug}`}>View rider page</Link>
          </Button>
        ) : (
          <Badge>Not published</Badge>
        )}
        <div className={styles.readiness} aria-label="Profile readiness">
          <strong>{readyItems.length} of {readinessItems.length} ready</strong>
          <span>
            {readinessItems
              .filter((item) => !item.ready)
              .map((item) => item.label)
              .join(" · ") || "Your garage card is ready"}
          </span>
        </div>
      </header>

      <div className={styles.studioLayout}>
      <div className={styles.studioEditor}>
      <form action={handleProfileSave} className="profile-settings__grid">
        <ProfileSaveFieldset pending={profilePending}>
        <Card className="profile-settings__section">
          <CardHeader>
            <CardTitle><UserRound aria-hidden="true" /> Identity</CardTitle>
            <CardDescription>This is the name, area, and story shown on your garage card.</CardDescription>
          </CardHeader>
          <CardContent className="profile-fields">
            <div className="profile-field">
              <Label htmlFor="profile-display-name">Display name</Label>
              <Input id="profile-display-name" name="displayName" required value={profileDraft.displayName} maxLength={80} onChange={(event) => updateProfileDraft({ displayName: event.currentTarget.value })} />
            </div>
            <div className="profile-field">
              <Label htmlFor="profile-area">Area / city</Label>
              <Input id="profile-area" name="area" required value={profileDraft.area} maxLength={80} onChange={(event) => updateProfileDraft({ area: event.currentTarget.value })} />
            </div>
            <div className="profile-field profile-field--wide">
              <Label htmlFor="profile-bio">Garage note</Label>
              <textarea id="profile-bio" name="bio" value={profileDraft.bio} maxLength={500} rows={5} onChange={(event) => updateProfileDraft({ bio: event.currentTarget.value })} />
              <span>Up to 500 characters. Contact details do not belong here.</span>
            </div>
            <div className="profile-field">
              <Label htmlFor="profile-visibility">Profile visibility</Label>
              <input type="hidden" name="visibility" value={profileDraft.visibility} />
              <Select value={profileDraft.visibility} onValueChange={(value) => updateProfileDraft({ visibility: value as ProfileVisibility })}>
                <SelectTrigger id="profile-visibility" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PUBLIC">Public — anyone with the link</SelectItem>
                  <SelectItem value="MEMBERS_ONLY">Members only — signed-in riders</SelectItem>
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
              This setting applies to all current and future event rosters.
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
                  <SelectItem value="VISIBLE">Visible — show my eligible rider card</SelectItem>
                </SelectContent>
              </Select>
              <span>
                Private or unpublished profiles always appear anonymously.
              </span>
            </div>
          </CardContent>
        </Card>

        <div className="profile-settings__save profile-field--wide">
          <Button type="submit" size="lg" disabled={profilePending}>
            {profilePending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
            {profilePending ? "Saving…" : publishLabel}
          </Button>
          <p aria-live="polite">{profileStatus}</p>
        </div>
        </ProfileSaveFieldset>
      </form>

      <Card className="profile-settings__section profile-settings__media-section">
        <CardHeader>
          <CardTitle><Camera aria-hidden="true" /> Avatar</CardTitle>
          <CardDescription>The identity plate crops this image to a centered square.</CardDescription>
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
              <Button
                type="button"
                variant="destructive"
                disabled={mediaPending}
                onClick={() => removeMedia(editor.profilePhotoUrl!, "Avatar")}
              >
                <Trash2 aria-hidden="true" /> Delete avatar
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <form action={handleMotorcycleSave}>
        <ProfileSaveFieldset pending={motorcyclePending}>
        <Card className="profile-settings__section">
          <CardHeader>
            <CardTitle><Bike aria-hidden="true" /> Motorcycle</CardTitle>
            <CardDescription>Tambike shows one motorcycle as the centerpiece of your garage card.</CardDescription>
          </CardHeader>
          <CardContent className="profile-fields">
            <div className="profile-field"><Label htmlFor="motorcycle-make">Make</Label><Input id="motorcycle-make" name="make" required value={motorcycleDraft.make} onChange={(event) => updateMotorcycleDraft({ make: event.currentTarget.value })} placeholder="Honda" /></div>
            <div className="profile-field"><Label htmlFor="motorcycle-model">Model</Label><Input id="motorcycle-model" name="model" required value={motorcycleDraft.model} onChange={(event) => updateMotorcycleDraft({ model: event.currentTarget.value })} placeholder="CB650R" /></div>
            <div className="profile-field"><Label htmlFor="motorcycle-year">Year</Label><Input id="motorcycle-year" name="year" type="number" min={1885} max={2100} value={motorcycleDraft.year ?? ""} onChange={(event) => updateMotorcycleDraft({ year: optionalNumber(event.currentTarget.value) })} /></div>
            <div className="profile-field"><Label htmlFor="motorcycle-displacement">Displacement (cc)</Label><Input id="motorcycle-displacement" name="displacementCc" type="number" min={1} max={10000} value={motorcycleDraft.displacementCc ?? ""} onChange={(event) => updateMotorcycleDraft({ displacementCc: optionalNumber(event.currentTarget.value) })} /></div>
            <div className="profile-field profile-field--wide"><Label htmlFor="motorcycle-nickname">Nickname</Label><Input id="motorcycle-nickname" name="nickname" value={motorcycleDraft.nickname ?? ""} onChange={(event) => updateMotorcycleDraft({ nickname: event.currentTarget.value })} placeholder="Ember" /></div>
            <div className="profile-field profile-field--wide"><Label htmlFor="motorcycle-description">Motorcycle note</Label><textarea id="motorcycle-description" name="description" value={motorcycleDraft.description ?? ""} onChange={(event) => updateMotorcycleDraft({ description: event.currentTarget.value })} maxLength={500} rows={4} /></div>
            <div className="profile-settings__save profile-field--wide">
              <Button type="submit" disabled={motorcyclePending}>
                {motorcyclePending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
                {motorcyclePending ? "Saving…" : "Save motorcycle"}
              </Button>
              <p aria-live="polite">{motorcycleStatus}</p>
            </div>
          </CardContent>
        </Card>
        </ProfileSaveFieldset>
      </form>

      <MotorcyclePhotoWorkspace
        photos={photos}
        disabled={!editor.motorcycle}
        mediaPending={mediaPending}
        onUploaded={refreshEditor}
        onMove={movePhoto}
        onReorder={reorderPhoto}
        onDelete={removeMedia}
      />
      <p
        className={`profile-settings__media-status ${styles.mediaStatus}`}
        aria-live="polite"
      >
        {mediaStatus}
      </p>
      </div>

      <div className={styles.studioPreviewColumn}>
        <ProfileStudioPreview
          editor={editor}
          profileDraft={profileDraft}
          motorcycleDraft={motorcycleDraft}
        />
      </div>
      </div>
    </div>
  );
}
