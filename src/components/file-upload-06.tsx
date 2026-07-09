"use client";

import type React from "react";
import { useRef, useState } from "react";
import { CheckCircleIcon, FileTextIcon, Loader2Icon, UploadIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";

type UploadStatus = "validating" | "completed" | "failed";

interface UploadItem {
  id: string;
  name: string;
  progress: number;
  status: UploadStatus;
  detail: string;
}

const initialUploads: UploadItem[] = [
  {
    id: "org-bulk-july",
    name: "organizer-verification-july.csv",
    progress: 74,
    status: "validating",
    detail: "Checking FB links, duplicate organizers, and approved venues.",
  },
  {
    id: "venue-owner-match",
    name: "venue-owner-matching.xlsx",
    progress: 100,
    status: "completed",
    detail: "18 venue records matched to approved staff accounts.",
  },
  {
    id: "event-risk-flags",
    name: "event-risk-flags.csv",
    progress: 100,
    status: "failed",
    detail: "3 rows need event IDs before import.",
  },
];

export default function FileUpload06() {
  const [uploads, setUploads] = useState<UploadItem[]>(initialUploads);
  const filePickerRef = useRef<HTMLInputElement>(null);

  const addFiles = (files: FileList) => {
    const nextUploads = Array.from(files).map((file, index) => ({
      id: `${file.name}-${Date.now()}-${index}`,
      name: file.name,
      progress: 18,
      status: "validating" as const,
      detail: "Queued for schema and duplicate checks.",
    }));

    setUploads((current) => [...nextUploads, ...current]);
  };

  const openFilePicker = () => {
    filePickerRef.current?.click();
  };

  const onFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      addFiles(event.target.files);
    }
    event.target.value = "";
  };

  const onDragOver = (event: React.DragEvent) => {
    event.preventDefault();
  };

  const onDropFiles = (event: React.DragEvent) => {
    event.preventDefault();
    if (event.dataTransfer.files) {
      addFiles(event.dataTransfer.files);
    }
  };

  const removeUploadById = (id: string) => {
    setUploads((current) => current.filter((file) => file.id !== id));
  };

  const validatingUploads = uploads.filter((file) => file.status === "validating");
  const completedUploads = uploads.filter((file) => file.status === "completed");
  const failedUploads = uploads.filter((file) => file.status === "failed");

  return (
    <div className="flex w-full flex-col gap-6">
      <Card
        className="group flex min-h-44 w-full cursor-pointer flex-col items-center justify-center gap-4 border-dashed py-8 text-sm shadow-none transition-colors hover:bg-muted/50"
        onDragOver={onDragOver}
        onDrop={onDropFiles}
        onClick={openFilePicker}
      >
        <div className="flex items-center gap-2 text-muted-foreground">
          <UploadIcon className="size-5" />
          <div>
            Drop organizer or venue validation files here, or{" "}
            <Button
              variant="link"
              className="h-auto p-0 font-normal text-primary"
              onClick={(event) => {
                event.stopPropagation();
                openFilePicker();
              }}
            >
              browse files
            </Button>
            .
          </div>
        </div>
        <input
          ref={filePickerRef}
          type="file"
          className="hidden"
          accept=".csv,.xlsx,.xls"
          multiple
          onChange={onFileInputChange}
        />
        <span className="text-sm text-muted-foreground">
          Supported: CSV, XLSX, XLS. Imports stay in review until an admin approves.
        </span>
      </Card>

      <div className="grid gap-5">
        <UploadSection
          title="Validating"
          icon={<Loader2Icon className="mr-1 size-4 animate-spin" />}
          uploads={validatingUploads}
          onRemove={removeUploadById}
        />
        {validatingUploads.length > 0 && (completedUploads.length > 0 || failedUploads.length > 0) ? (
          <Separator />
        ) : null}
        <UploadSection
          title="Finished"
          icon={<CheckCircleIcon className="mr-1 size-4" />}
          uploads={completedUploads}
          onRemove={removeUploadById}
        />
        {failedUploads.length > 0 ? (
          <>
            <Separator />
            <UploadSection
              title="Needs fixes"
              icon={<FileTextIcon className="mr-1 size-4" />}
              uploads={failedUploads}
              onRemove={removeUploadById}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

function UploadSection({
  title,
  icon,
  uploads,
  onRemove,
}: {
  title: string;
  icon: React.ReactNode;
  uploads: UploadItem[];
  onRemove: (id: string) => void;
}) {
  if (uploads.length === 0) {
    return null;
  }

  return (
    <section>
      <h2 className="mb-2 flex items-center font-mono text-xs font-normal uppercase tracking-normal text-foreground">
        {icon}
        {title}
      </h2>
      <div className="divide-y rounded-lg border bg-card">
        {uploads.map((file) => (
          <div key={file.id} className="group flex items-center gap-3 p-4">
            <div className="grid size-10 shrink-0 place-content-center rounded-md border bg-muted">
              <FileTextIcon className="inline size-4 group-hover:hidden" />
              <Button
                variant="ghost"
                size="icon"
                className="hidden size-5 p-0 group-hover:inline-flex"
                onClick={() => onRemove(file.id)}
                aria-label={`Remove ${file.name}`}
              >
                <XIcon className="size-4" />
              </Button>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{file.name}</p>
                  <p className="truncate text-sm text-muted-foreground">{file.detail}</p>
                </div>
                <span className="text-sm tabular-nums text-muted-foreground">{file.progress}%</span>
              </div>
              <Progress value={file.progress} className="mt-2 h-2" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
