"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangleIcon,
  CameraIcon,
  CheckCircle2Icon,
  Loader2Icon,
  ScanLineIcon,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { decodeQrImageData } from "@/features/check-in/qr-image-decoder";
import type {
  Event,
  ScanMethod,
  ScanPassResult,
} from "@/features/tambike-demo/types";

type QrScannerPanelProps = {
  event: Event;
  checkedInCount: number;
  reportHref: string;
  scanPass: (eventId: string, qrToken: string, method: ScanMethod) => Promise<ScanPassResult>;
  scannerLabel: string;
};

type LocalScanResult = Pick<ScanPassResult, "ok" | "code" | "title" | "body">;

const idleResult: LocalScanResult = {
  ok: false,
  code: "INVALID_INPUT",
  title: "Ready to scan",
  body: "Use the camera, upload a QR image, or paste a Tambike Pass token.",
};

export function QrScannerPanel({
  event,
  checkedInCount,
  reportHref,
  scanPass,
  scannerLabel,
}: QrScannerPanelProps) {
  const [result, setResult] = React.useState<LocalScanResult>(idleResult);
  const [cameraActive, setCameraActive] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [manualToken, setManualToken] = React.useState("");
  const [cameraError, setCameraError] = React.useState("");
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const frameRef = React.useRef<number | null>(null);
  const pendingRef = React.useRef(false);
  const scanCameraFrameRef = React.useRef<() => void>(() => undefined);

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

  const submitToken = React.useCallback(
    async (token: string, method: ScanMethod) => {
      const cleanToken = token.trim();
      if (!cleanToken || pendingRef.current) {
        setResult({
          ok: false,
          code: "INVALID_INPUT",
          title: "No QR token found",
          body: "Upload a clearer QR image, start the camera, or paste a valid pass token.",
        });
        return false;
      }

      pendingRef.current = true;
      setPending(true);
      setCameraError("");

      try {
        const scanResult = await scanPass(event.id, cleanToken, method);
        setResult(scanResult);
        if (scanResult.ok) {
          stopCamera();
        }
        return scanResult.ok;
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [event.id, scanPass, stopCamera],
  );

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

  React.useEffect(() => {
    scanCameraFrameRef.current = () => {
      const video = videoRef.current;
      if (!video || !streamRef.current) {
        return;
      }

      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !pendingRef.current) {
        const token = decodeFromCanvas(video, video.videoWidth, video.videoHeight);
        if (token) {
          void submitToken(token, "staff_camera");
          return;
        }
      }

      frameRef.current = window.requestAnimationFrame(scanCameraFrameRef.current);
    };
  }, [decodeFromCanvas, submitToken]);

  const startCamera = React.useCallback(async () => {
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera scanning is not available in this browser. Use QR upload instead.");
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
      setCameraError("Camera permission was blocked or no camera was found. Upload a QR image instead.");
    }
  }, [stopCamera]);

  const handleUpload = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) {
        return;
      }

      setCameraError("");
      setPending(true);
      pendingRef.current = true;

      try {
        const source = await loadImageSource(file);
        const { width, height } = getSourceSize(source);
        const token = decodeFromCanvas(source, width, height);
        closeImageSource(source);

        pendingRef.current = false;
        setPending(false);

        if (!token) {
          setResult({
            ok: false,
            code: "INVALID_INPUT",
            title: "No QR code found",
            body: "Upload a sharper, uncropped image of the rider's Tambike Pass QR.",
          });
          return;
        }

        await submitToken(token, "staff_upload");
      } catch {
        pendingRef.current = false;
        setPending(false);
        setResult({
          ok: false,
          code: "INVALID_INPUT",
          title: "Could not read image",
          body: "Use a PNG or JPG image that clearly shows the full QR code.",
        });
      }
    },
    [decodeFromCanvas, submitToken],
  );

  React.useEffect(() => stopCamera, [stopCamera]);

  const isIdle = result.title === idleResult.title;
  const tone = result.ok ? "success" : isIdle ? "idle" : "error";

  return (
    <div className="grid gap-4 px-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:px-6">
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              <ScanLineIcon data-icon="inline-start" />
              {scannerLabel}
            </Badge>
            <Badge variant="outline">{formatStatus(event.status)}</Badge>
          </div>
          <CardTitle>{event.title}</CardTitle>
          <CardDescription>
            Scan the rider&apos;s Tambike Pass QR. The backend validates event match, pass status, duplicate check-in, and scanner access.
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
                    <div className="font-medium">Camera scanner</div>
                    <div className="text-sm text-muted-foreground">Use the rear camera on mobile when possible.</div>
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
              <Label htmlFor="qr-upload">Upload QR image</Label>
              <Input id="qr-upload" type="file" accept="image/*" disabled={pending} onChange={handleUpload} />
            </div>
            <form
              className="grid gap-2"
              onSubmit={(formEvent) => {
                formEvent.preventDefault();
                void submitToken(manualToken, "staff_manual");
              }}
            >
              <Label htmlFor="manual-token">Manual token</Label>
              <div className="flex gap-2">
                <Input
                  id="manual-token"
                  value={manualToken}
                  onChange={(inputEvent) => setManualToken(inputEvent.target.value)}
                  placeholder="Paste pass token"
                />
                <Button type="submit" variant="outline" disabled={pending || !manualToken.trim()}>
                  Check
                </Button>
              </div>
            </form>
          </div>
        </CardContent>
      </Card>

      <Card className="h-fit lg:sticky lg:top-24">
        <CardHeader>
          <CardTitle>Scan result</CardTitle>
          <CardDescription>Live validation for this event.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div
            className={cn(
              "rounded-lg border p-4",
              tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-950",
              tone === "error" && "border-destructive/20 bg-destructive/5 text-destructive",
              tone === "idle" && "bg-muted/30",
            )}
            aria-live="polite"
          >
            <div className="flex items-start gap-3">
              {pending ? (
                <Loader2Icon className="mt-0.5 size-5 animate-spin" />
              ) : tone === "success" ? (
                <CheckCircle2Icon className="mt-0.5 size-5" />
              ) : tone === "error" ? (
                <XCircleIcon className="mt-0.5 size-5" />
              ) : (
                <AlertTriangleIcon className="mt-0.5 size-5 text-muted-foreground" />
              )}
              <div>
                <div className="font-medium">{pending ? "Checking pass..." : result.title}</div>
                <p className={cn("mt-1 text-sm", tone === "idle" && "text-muted-foreground")}>{result.body}</p>
              </div>
            </div>
          </div>

          <div className="grid gap-3">
            <Metric label="Checked in" value={String(checkedInCount)} />
            <Metric label="Going" value={String(event.going)} />
          </div>

          <Button asChild variant="outline">
            <Link href={reportHref}>Open event report</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
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
  if (source instanceof HTMLImageElement) {
    return {
      width: source.naturalWidth,
      height: source.naturalHeight,
    };
  }

  return {
    width: source.width,
    height: source.height,
  };
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

function formatStatus(status: Event["status"]) {
  return status.replaceAll("_", " ").toLowerCase();
}
