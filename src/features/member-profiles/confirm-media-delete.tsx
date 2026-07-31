"use client";

import { AlertDialog } from "radix-ui";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export function mediaDeleteConfirmationCopy(label: string) {
  return {
    title: `Delete ${label}?`,
    description:
      "This removes the saved photo from your profile. This cannot be undone.",
    confirmLabel: "Delete photo",
  };
}

export function ConfirmMediaDelete({
  label,
  triggerLabel,
  triggerAriaLabel,
  disabled,
  onConfirm,
}: {
  label: string;
  triggerLabel: string;
  triggerAriaLabel?: string;
  disabled?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const copy = mediaDeleteConfirmationCopy(label);

  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <Button
          type="button"
          variant="destructive"
          aria-label={triggerAriaLabel}
          disabled={disabled}
        >
          <Trash2 aria-hidden="true" />
          {triggerLabel}
        </Button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-5 rounded-2xl border border-border bg-popover p-6 text-popover-foreground shadow-2xl outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
          <div className="grid gap-2">
            <AlertDialog.Title className="font-heading text-xl font-semibold tracking-tight">
              {copy.title}
            </AlertDialog.Title>
            <AlertDialog.Description className="text-sm leading-6 text-muted-foreground">
              {copy.description}
            </AlertDialog.Description>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <Button type="button" variant="outline">
                Keep photo
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void onConfirm()}
              >
                {copy.confirmLabel}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
