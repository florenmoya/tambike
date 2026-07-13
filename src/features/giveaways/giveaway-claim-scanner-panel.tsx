"use client";

import * as React from "react";
import {
  AlertTriangleIcon,
  CameraIcon,
  CheckCircle2Icon,
  Loader2Icon,
  PackageCheckIcon,
  ScanLineIcon,
  ShieldCheckIcon,
  UploadIcon,
  XCircleIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { decodeQrImageData } from "@/features/check-in/qr-image-decoder";
import { normalizeGiveawayClaimPayload } from "@/features/giveaways/giveaway-claim-client";
import type {
  GiveawayClaimScannerMethod,
  OperatorGiveawayClaimView,
} from "@/features/giveaways/types";
import {
  fulfillGiveawayAwardAction,
  resolveGiveawayClaimAction,
  verifyGiveawayClaimAction,
} from "@/server/giveaway-actions";
import { cn } from "@/lib/utils";

type ScannerNotice = {
  tone: "idle" | "success" | "error";
  title: string;
  body: string;
};

const idleNotice: ScannerNotice = {
  tone: "idle",
  title: "Ready for a claim credential",
  body: "Use the camera, upload a claim QR image, or paste the dedicated giveaway claim payload.",
};

/**
 * A dedicated claim scanner. It deliberately has no dependency on attendance
 * scanning, pass check-in, or perk redemption; only the QR pixel decoder is
 * shared with that independent surface.
 */
export function GiveawayClaimScannerPanel() {
  const [notice, setNotice] = React.useState<ScannerNotice>(idleNotice);
  const [claim, setClaim] = React.useState<OperatorGiveawayClaimView | null>(null);
  const [manualPayload, setManualPayload] = React.useState("");
  const [presenceObserved, setPresenceObserved] = React.useState(false);
  const [cameraActive, setCameraActive] = React.useState(false);
  const [cameraError, setCameraError] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const frameRef = React.useRef<number | null>(null);
  const pendingRef = React.useRef(false);
  const scanCameraFrameRef = React.useRef<() => void>(() => undefined);
  const resolvedPayloadRef = React.useRef<string | null>(null);
  const resolvedMethodRef = React.useRef<GiveawayClaimScannerMethod>("manual");
  const verificationKeyRef = React.useRef<string | null>(null);
  const fulfilmentKeyRef = React.useRef<string | null>(null);

  const stopCamera = React.useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  const decodeFromCanvas = React.useCallback((source: CanvasImageSource, width: number, height: number) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !context || width <= 0 || height <= 0) {
      return null;
    }

    canvas.width = width;
    canvas.height = height;
    context.drawImage(source, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    return decodeQrImageData(imageData.data, imageData.width, imageData.height);
  }, []);

  const resolveClaim = React.useCallback(
    async (value: string, method: GiveawayClaimScannerMethod) => {
      const payload = normalizeGiveawayClaimPayload(value);
      if (!payload || pendingRef.current) {
        setClaim(null);
        resolvedPayloadRef.current = null;
        setNotice({
          tone: "error",
          title: "This is not a giveaway claim QR",
          body: "Use the dedicated claim credential. Rider pass, attendance, and perk QR codes are not accepted here.",
        });
        return;
      }

      pendingRef.current = true;
      setPending(true);
      setCameraError("");
      setNotice({
        tone: "idle",
        title: "Checking credential",
        body: "Resolving this claim without changing its state.",
      });

      try {
        const result = await resolveGiveawayClaimAction(payload);
        if (!result.ok) {
          setClaim(null);
          resolvedPayloadRef.current = null;
          setNotice({
            tone: "error",
            title: result.code === "UNAUTHENTICATED" ? "Operator login required" : "Claim could not be resolved",
            body:
              result.code === "UNAUTHENTICATED"
                ? "Sign in with an authorized giveaway operator account, then scan again."
                : "This credential is unavailable, expired, or not assigned to this giveaway operator.",
          });
          return;
        }

        resolvedPayloadRef.current = payload;
        resolvedMethodRef.current = method;
        verificationKeyRef.current = null;
        fulfilmentKeyRef.current = null;
        setClaim(result.data);
        setPresenceObserved(false);
        setNotice({
          tone: "success",
          title: "Claim found",
          body: "Review the prize and verify it separately before fulfilment.",
        });
        stopCamera();
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [stopCamera],
  );

  React.useEffect(() => {
    scanCameraFrameRef.current = () => {
      const video = videoRef.current;
      if (!video || !streamRef.current) {
        return;
      }

      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !pendingRef.current) {
        const payload = decodeFromCanvas(video, video.videoWidth, video.videoHeight);
        if (payload) {
          void resolveClaim(payload, "camera");
          return;
        }
      }

      frameRef.current = window.requestAnimationFrame(scanCameraFrameRef.current);
    };
  }, [decodeFromCanvas, resolveClaim]);

  const startCamera = React.useCallback(async () => {
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera scanning is not available in this browser. Upload a QR image or paste the payload instead.");
      return;
    }

    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stopCamera();
        return;
      }
      video.srcObject = stream;
      await video.play();
      setCameraActive(true);
      frameRef.current = window.requestAnimationFrame(scanCameraFrameRef.current);
    } catch {
      stopCamera();
      setCameraError("Camera permission was blocked or no camera was found. Upload a QR image or paste the payload instead.");
    }
  }, [stopCamera]);

  const uploadImage = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) {
        return;
      }

      setCameraError("");
      pendingRef.current = true;
      setPending(true);
      try {
        const source = await loadImageSource(file);
        const { width, height } = getSourceSize(source);
        const payload = decodeFromCanvas(source, width, height);
        closeImageSource(source);
        pendingRef.current = false;
        setPending(false);

        if (!payload) {
          setClaim(null);
          setNotice({
            tone: "error",
            title: "No QR code found",
            body: "Upload a clear, uncropped image of the rider’s giveaway claim QR.",
          });
          return;
        }
        await resolveClaim(payload, "upload");
      } catch {
        pendingRef.current = false;
        setPending(false);
        setClaim(null);
        setNotice({
          tone: "error",
          title: "Could not read image",
          body: "Use a PNG or JPG that clearly shows the full giveaway claim QR.",
        });
      }
    },
    [decodeFromCanvas, resolveClaim],
  );

  const verifyClaim = React.useCallback(async () => {
    const payload = resolvedPayloadRef.current;
    if (!claim || !payload || pendingRef.current) {
      return;
    }
    if (claim.presenceVerificationRequired && !presenceObserved) {
      setNotice({
        tone: "error",
        title: "Presence confirmation required",
        body: "Confirm that the rider is present before verifying this claim.",
      });
      return;
    }

    pendingRef.current = true;
    setPending(true);
    verificationKeyRef.current ??= createIdempotencyKey("verify");
    try {
      const result = await verifyGiveawayClaimAction({
        payload,
        method: resolvedMethodRef.current,
        idempotencyKey: verificationKeyRef.current,
        presenceObserved: claim.presenceVerificationRequired ? presenceObserved : undefined,
      });
      if (!result.ok) {
        setNotice({
          tone: "error",
          title: result.code === "UNAUTHENTICATED" ? "Operator login required" : "Claim was not verified",
          body: "The award may no longer be claimable. Resolve the credential again before trying a new operation.",
        });
        return;
      }
      setClaim(result.data);
      resolvedPayloadRef.current = null;
      setNotice({
        tone: "success",
        title: "Claim verified",
        body: "Verification is recorded. Fulfil this prize in a separate action when it is actually handed over or arranged.",
      });
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }, [claim, presenceObserved]);

  const fulfillClaim = React.useCallback(async () => {
    if (!claim || claim.status !== "verified" || pendingRef.current) {
      return;
    }

    pendingRef.current = true;
    setPending(true);
    fulfilmentKeyRef.current ??= createIdempotencyKey("fulfil");
    try {
      const result = await fulfillGiveawayAwardAction({
        awardId: claim.awardId,
        idempotencyKey: fulfilmentKeyRef.current,
      });
      if (!result.ok) {
        setNotice({
          tone: "error",
          title: result.code === "UNAUTHENTICATED" ? "Operator login required" : "Prize was not fulfilled",
          body: "The prize remains unfulfilled. Check the required fulfilment details before trying again.",
        });
        return;
      }
      setClaim(result.data);
      setNotice({
        tone: "success",
        title: "Prize fulfilled",
        body: "The fulfilment record is complete.",
      });
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }, [claim]);

  React.useEffect(() => stopCamera, [stopCamera]);

  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]" aria-label="Giveaway claim scanner">
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              <ScanLineIcon data-icon="inline-start" />
              Claim scanner
            </Badge>
            <Badge variant="outline">Attendance-independent</Badge>
          </div>
          <CardTitle>Verify a giveaway claim</CardTitle>
          <CardDescription>
            This scanner accepts only a rider’s dedicated claim credential. Resolving a code never checks anyone in or redeems a perk.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="overflow-hidden rounded-lg border bg-muted/30">
            <video
              ref={videoRef}
              className={cn("aspect-video w-full bg-black object-cover", !cameraActive && "hidden")}
              muted
              playsInline
            />
            {!cameraActive ? (
              <div className="grid aspect-video place-items-center p-6 text-center">
                <div className="grid gap-3">
                  <div className="mx-auto grid size-20 place-items-center rounded-xl border bg-background">
                    <CameraIcon className="size-9 text-muted-foreground" />
                  </div>
                  <div>
                    <div className="font-medium">Claim credential camera</div>
                    <p className="mt-1 text-sm text-muted-foreground">Use the rear camera on mobile when possible.</p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <canvas ref={canvasRef} className="hidden" aria-hidden="true" />

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={startCamera} disabled={pending}>
              <CameraIcon data-icon="inline-start" />
              {cameraActive ? "Restart camera" : "Start camera"}
            </Button>
            {cameraActive ? (
              <Button type="button" variant="outline" onClick={stopCamera}>
                Stop camera
              </Button>
            ) : null}
          </div>

          {cameraError ? (
            <p className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive" aria-live="polite">
              {cameraError}
            </p>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="giveaway-claim-upload">Upload claim QR image</Label>
              <Input
                id="giveaway-claim-upload"
                type="file"
                accept="image/*"
                disabled={pending}
                onChange={uploadImage}
              />
            </div>
            <form
              className="grid gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const payload = manualPayload;
                setManualPayload("");
                void resolveClaim(payload, "manual");
              }}
            >
              <Label htmlFor="giveaway-claim-manual">Manual claim payload</Label>
              <div className="flex gap-2">
                <Input
                  id="giveaway-claim-manual"
                  value={manualPayload}
                  onChange={(event) => setManualPayload(event.target.value)}
                  placeholder="Paste claim payload"
                  autoComplete="off"
                />
                <Button type="submit" variant="outline" disabled={pending || !manualPayload.trim()}>
                  <UploadIcon data-icon="inline-start" />
                  Check
                </Button>
              </div>
            </form>
          </div>
        </CardContent>
      </Card>

      <Card className="h-fit lg:sticky lg:top-24">
        <CardHeader>
          <CardTitle>Claim result</CardTitle>
          <CardDescription>Resolve, verify, then fulfil — each step is recorded separately.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <ScannerNoticeCard notice={notice} pending={pending} />

          {claim ? (
            <div className="grid gap-3 rounded-lg border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">{claim.prizePoolTitle}</div>
                <Badge variant="outline">{formatClaimStatus(claim.status)}</Badge>
              </div>
              <dl className="grid gap-2 text-sm text-muted-foreground">
                <div className="flex justify-between gap-3"><dt>Fulfilment</dt><dd className="text-right text-foreground">{formatFulfilmentMode(claim.fulfilmentMode)}</dd></div>
                {claim.claimDeadlineAt ? <div className="flex justify-between gap-3"><dt>Claim by</dt><dd className="text-right text-foreground">{formatDateTime(claim.claimDeadlineAt)}</dd></div> : null}
              </dl>

              {claim.status === "pending_verification" || claim.status === "claimable" ? (
                <div className="grid gap-3 border-t pt-3">
                  {claim.presenceVerificationRequired ? (
                    <Label className="items-start rounded-lg bg-muted/50 p-3 text-sm font-normal leading-snug">
                      <Checkbox checked={presenceObserved} onCheckedChange={(checked) => setPresenceObserved(checked === true)} />
                      <span>I have confirmed the rider is physically present for this prize.</span>
                    </Label>
                  ) : null}
                  <Button type="button" onClick={verifyClaim} disabled={pending} className="w-full">
                    {pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <ShieldCheckIcon data-icon="inline-start" />}
                    Verify claim
                  </Button>
                </div>
              ) : null}

              {claim.status === "verified" ? (
                <div className="grid gap-2 border-t pt-3">
                  <p className="text-sm text-muted-foreground">Complete this only when the prize has actually been handed over or its approved fulfilment has been arranged.</p>
                  <Button type="button" onClick={fulfillClaim} disabled={pending} className="w-full">
                    {pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <PackageCheckIcon data-icon="inline-start" />}
                    Mark prize fulfilled
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

function ScannerNoticeCard({ notice, pending }: { notice: ScannerNotice; pending: boolean }) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        notice.tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-950",
        notice.tone === "error" && "border-destructive/20 bg-destructive/5 text-destructive",
        notice.tone === "idle" && "bg-muted/30",
      )}
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        {pending ? <Loader2Icon className="mt-0.5 size-5 animate-spin" /> : notice.tone === "success" ? <CheckCircle2Icon className="mt-0.5 size-5" /> : notice.tone === "error" ? <XCircleIcon className="mt-0.5 size-5" /> : <AlertTriangleIcon className="mt-0.5 size-5 text-muted-foreground" />}
        <div>
          <div className="font-medium">{pending ? "Working…" : notice.title}</div>
          <p className={cn("mt-1 text-sm", notice.tone === "idle" && "text-muted-foreground")}>{notice.body}</p>
        </div>
      </div>
    </div>
  );
}

function createIdempotencyKey(operation: "verify" | "fulfil") {
  return `claim-${operation}:${crypto.randomUUID()}`;
}

async function loadImageSource(file: File) {
  if ("createImageBitmap" in window) {
    return window.createImageBitmap(file);
  }
  const image = new Image();
  image.src = await readFileAsDataUrl(file);
  await image.decode();
  return image;
}

function getSourceSize(source: ImageBitmap | HTMLImageElement) {
  return source instanceof HTMLImageElement
    ? { width: source.naturalWidth, height: source.naturalHeight }
    : { width: source.width, height: source.height };
}

function closeImageSource(source: ImageBitmap | HTMLImageElement) {
  if ("close" in source && typeof source.close === "function") {
    source.close();
  }
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function formatClaimStatus(status: OperatorGiveawayClaimView["status"]) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatFulfilmentMode(mode: OperatorGiveawayClaimView["fulfilmentMode"]) {
  return mode.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Scheduled deadline" : date.toLocaleString();
}
