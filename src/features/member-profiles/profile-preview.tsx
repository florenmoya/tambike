"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useDemo } from "@/features/tambike-demo/demo-provider";
import { toSavedProfilePreviewView } from "./profile-preview-adapter";
import { RiderGarageView } from "./rider-garage-view";
import styles from "./profile-studio.module.css";
import type { MemberProfileEditorView } from "./types";

export function ProfilePreview() {
  const { currentUser, getMemberProfileEditor } = useDemo();
  const [editor, setEditor] = useState<MemberProfileEditorView | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;
    getMemberProfileEditor()
      .then((profileEditor) => {
        if (active) setEditor(profileEditor);
      })
      .catch(() => {
        if (active) {
          setLoadError("Your profile preview could not be loaded. Try again.");
        }
      });
    return () => {
      active = false;
    };
  }, [getMemberProfileEditor]);

  if (!currentUser) return null;

  if (loadError) {
    return <p className="profile-settings-load" role="alert">{loadError}</p>;
  }

  if (!editor) {
    return (
      <div className="profile-settings-load" aria-live="polite">
        <LoaderCircle className="animate-spin" aria-hidden="true" /> Loading profile preview…
      </div>
    );
  }

  return (
    <section className={styles.previewPage} aria-label="Your profile preview">
      <div className={styles.previewNotice} role="status">
        <span>Preview — only you can see this</span>
        <Button asChild variant="outline">
          <Link href="/profile">Back to edit</Link>
        </Button>
      </div>
      <div className="garage-profile-page">
        <div className="garage-profile-shell">
          <RiderGarageView
            profile={toSavedProfilePreviewView(editor)}
            prioritizeMedia
          />
        </div>
      </div>
    </section>
  );
}
