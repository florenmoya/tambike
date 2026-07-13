"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import * as React from "react";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  Clock3Icon,
  GiftIcon,
  Loader2Icon,
  LogInIcon,
  QrCodeIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  TruckIcon,
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
import {
  getGiveawayClaimRoute,
  type GiveawayClaimRouteStep,
} from "@/features/giveaways/giveaway-claim-client";
import type {
  GiveawayState,
  RiderGiveawayAwardSummary,
} from "@/features/giveaways/types";
import {
  declineGiveawayAwardAction,
  issueGiveawayClaimTokenAction,
  submitGiveawayDeliveryDetailsAction,
  withdrawGiveawayDeliveryDetailsAction,
} from "@/server/giveaway-actions";
import { cn } from "@/lib/utils";

const GiveawayClaimTicketQr = dynamic(
  () => import("./giveaway-claim-ticket-qr").then((module) => module.GiveawayClaimTicketQr),
  {
    ssr: false,
    loading: () => <div className="mx-auto aspect-square w-56 animate-pulse rounded-xl bg-[#fffaf0]/20" aria-label="Preparing claim QR" />,
  },
);

export type RiderGiveawayClaimContext = {
  awardId: string;
  giveawayId: string;
  giveawayTitle: string;
  giveawayState: GiveawayState;
  award: RiderGiveawayAwardSummary;
  deliveryDetailsSubmitted: boolean;
  claimCredentialIssued: boolean;
};

type ClaimCredential = {
  qrPayload: string;
  version: number;
};

type GiveawayClaimScreenProps = {
  awardId: string;
  initialContext: RiderGiveawayClaimContext | null;
  initialError?: "UNAUTHENTICATED" | "ERROR" | null;
};

/**
 * The winner-facing claim route. The credential QR is deliberately generated
 * only after a deliberate tap and is retained solely in this component's
 * memory; neither a token nor a payload appears in the route or persistent UI.
 */
export function GiveawayClaimScreen({
  awardId,
  initialContext,
  initialError = null,
}: GiveawayClaimScreenProps) {
  const [context, setContext] = React.useState(initialContext);
  const [credential, setCredential] = React.useState<ClaimCredential | null>(null);
  const [rotationWarning, setRotationWarning] = React.useState(false);
  const [declineOpen, setDeclineOpen] = React.useState(false);
  const [declineReason, setDeclineReason] = React.useState("");
  const [deliveryOpen, setDeliveryOpen] = React.useState(false);
  const [deliveryConsent, setDeliveryConsent] = React.useState(false);
  const [deliveryRecipient, setDeliveryRecipient] = React.useState("");
  const [deliveryPhone, setDeliveryPhone] = React.useState("");
  const [deliveryAddress, setDeliveryAddress] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [isPending, startTransition] = React.useTransition();

  const loginHref = `/login?next=${encodeURIComponent(`/giveaway-claims/${encodeURIComponent(awardId)}`)}`;
  const currentAward = context?.award;
  const credentialIssued = Boolean(context?.claimCredentialIssued || credential);
  const canIssueCredential = Boolean(
    currentAward && isClaimCredentialAvailable(currentAward.status),
  );

  const issueCredential = React.useCallback(
    (rotate: boolean) => {
      if (!context || !canIssueCredential || isPending) {
        return;
      }
      setMessage("");
      startTransition(async () => {
        const result = await issueGiveawayClaimTokenAction(context.awardId, rotate ? { rotate: true } : {});
        if (!result.ok) {
          setMessage(
            result.code === "UNAUTHENTICATED"
              ? "Log in with the rider account that received this award."
              : "A claim credential cannot be issued right now. Check the award status or ask the event organizer for help.",
          );
          return;
        }

        // Discard the raw token. Only the QR payload is kept in client memory
        // long enough to render the credential that the rider explicitly asked for.
        setCredential({ qrPayload: result.data.qrPayload, version: result.data.version });
        setContext((current) => (current ? { ...current, claimCredentialIssued: true } : current));
        setRotationWarning(false);
      });
    },
    [canIssueCredential, context, isPending],
  );

  const declineAward = React.useCallback(() => {
    if (!context || !declineReason.trim() || isPending) {
      if (!declineReason.trim()) {
        setMessage("Add a short reason before declining this award.");
      }
      return;
    }
    setMessage("");
    startTransition(async () => {
      const result = await declineGiveawayAwardAction(context.awardId, declineReason.trim());
      if (!result.ok) {
        setMessage(
          result.code === "UNAUTHENTICATED"
            ? "Log in with the rider account that received this award."
            : "This award could not be declined. It may no longer be available for rider changes.",
        );
        return;
      }
      setCredential(null);
      setDeclineOpen(false);
      setContext((current) => {
        if (!current) return current;
        return {
          ...current,
          award: {
            ...current.award,
            status: result.data.award?.status ?? "declined",
          },
        };
      });
    });
  }, [context, declineReason, isPending]);

  const submitDeliveryDetails = React.useCallback(() => {
    if (!context || !deliveryConsent || !deliveryRecipient.trim() || !deliveryAddress.trim() || isPending) {
      setMessage("Confirm consent, recipient name, and delivery address before submitting delivery details.");
      return;
    }
    setMessage("");
    startTransition(async () => {
      const result = await submitGiveawayDeliveryDetailsAction(context.awardId, {
        consent: true,
        consentVersion: "delivery-consent-v1",
        details: {
          recipientName: deliveryRecipient.trim(),
          phone: deliveryPhone.trim(),
          address: deliveryAddress.trim(),
        },
      });
      if (!result.ok) {
        setMessage(
          result.code === "UNAUTHENTICATED"
            ? "Log in with the rider account that received this award."
            : "Delivery details could not be saved. Confirm that the claim has been verified first.",
        );
        return;
      }
      setDeliveryRecipient("");
      setDeliveryPhone("");
      setDeliveryAddress("");
      setDeliveryConsent(false);
      setDeliveryOpen(false);
      setContext((current) => (current ? { ...current, deliveryDetailsSubmitted: true } : current));
    });
  }, [context, deliveryAddress, deliveryConsent, deliveryPhone, deliveryRecipient, isPending]);

  const withdrawDeliveryDetails = React.useCallback(() => {
    if (!context || isPending) {
      return;
    }
    setMessage("");
    startTransition(async () => {
      const result = await withdrawGiveawayDeliveryDetailsAction(context.awardId);
      if (!result.ok) {
        setMessage("Delivery details could not be withdrawn. Ask the fulfiller for help if fulfilment has already started.");
        return;
      }
      setContext((current) => (current ? { ...current, deliveryDetailsSubmitted: false } : current));
    });
  }, [context, isPending]);

  if (!context) {
    return <UnavailableClaimScreen loginHref={initialError === "UNAUTHENTICATED" ? loginHref : undefined} />;
  }

  const award = context.award;
  const route = getGiveawayClaimRoute(award.status, credentialIssued);
  const deliveryEligible = award.status === "verified" && award.fulfilmentMode === "delivery";

  return (
    <main className="min-h-dvh bg-[#050506] px-4 py-5 text-[#fff8eb] sm:px-6 sm:py-10">
      <div className="mx-auto grid w-full max-w-lg gap-4">
        <header className="flex items-center justify-between px-1 text-sm">
          <Link href="/" className="font-black tracking-tight text-[#ffbe45]">Tambike</Link>
          <span className="text-[#fff8eb]/60">Giveaway claim</span>
        </header>

        <section className="overflow-hidden rounded-2xl border border-[#ffbe45]/30 bg-[linear-gradient(135deg,rgba(255,190,69,0.16),rgba(17,18,20,0.97)_46%,rgba(122,39,72,0.24))] shadow-[0_22px_56px_rgba(0,0,0,0.38)]">
          <div className="grid gap-4 p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge className="border border-[#ffbe45]/40 bg-[#ffbe45] text-[#1a1107] hover:bg-[#ffbe45]">
                <GiftIcon data-icon="inline-start" />
                Award credential
              </Badge>
              <Badge variant="outline" className="border-white/20 bg-white/5 text-[#fff8eb]">{formatGiveawayState(context.giveawayState)}</Badge>
            </div>
            <div>
              <p className="text-xs font-black tracking-[0.13em] text-[#ffbe45] uppercase">{context.giveawayTitle}</p>
              <h1 className="mt-2 font-[Arial_Black,Impact,sans-serif] text-3xl leading-[0.94] tracking-tight sm:text-4xl">{award.prizePoolTitle}</h1>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-[#fff8eb]/68">
                Keep this ticket private. Show its QR only to an authorized giveaway operator when you are ready to claim the prize.
              </p>
            </div>
            {award.claimDeadlineAt ? (
              <div className="flex items-start gap-2 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-[#fff8eb]/75">
                <Clock3Icon className="mt-0.5 size-4 shrink-0 text-[#ffbe45]" />
                <span>Claim deadline: <strong className="font-semibold text-[#fff8eb]">{formatClaimDeadline(award.claimDeadlineAt)}</strong></span>
              </div>
            ) : null}
          </div>

          <CampaignRouteStrip route={route} />
        </section>

        <StatusCard award={award} />

        {message ? (
          <div className="flex gap-3 rounded-xl border border-[#e63b2e]/45 bg-[#e63b2e]/10 p-4 text-sm text-[#fff8eb]" aria-live="polite">
            <CircleAlertIcon className="mt-0.5 size-5 shrink-0 text-[#ff8c7f]" />
            <p>{message}</p>
          </div>
        ) : null}

        {canIssueCredential ? (
          <Card className="border border-[#ffbe45]/30 bg-[#17181a] text-[#fff8eb] shadow-[0_14px_36px_rgba(0,0,0,0.3)]">
            <CardHeader>
              <CardTitle className="text-[#fff8eb]">Your claim credential</CardTitle>
              <CardDescription className="text-[#fff8eb]/62">
                A claim QR is separate from your Tambike Pass and cannot check you in or redeem perks.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {credential ? (
                <>
                  <GiveawayClaimTicketQr payload={credential.qrPayload} />
                  <div className="rounded-xl border border-[#ffbe45]/20 bg-[#ffbe45]/8 p-3 text-sm text-[#fff8eb]/80">
                    Credential version {credential.version}. Keep this screen open and show the QR only at the claim desk.
                  </div>
                </>
              ) : (
                <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-[#fff8eb]/70">
                  <QrCodeIcon className="mt-0.5 size-5 shrink-0 text-[#ffbe45]" />
                  <span>{credentialIssued ? "For your privacy, a previous credential is not shown again after this page reloads. Replace it to issue a new QR." : "Issue the QR only when you are ready to show it to an authorized giveaway operator."}</span>
                </div>
              )}

              {rotationWarning ? (
                <div className="grid gap-3 rounded-xl border border-[#ffbe45]/45 bg-[#ffbe45]/10 p-4">
                  <div className="flex gap-2 text-sm leading-relaxed text-[#fff8eb]">
                    <AlertTriangleIcon className="mt-0.5 size-5 shrink-0 text-[#ffbe45]" />
                    <span>Replacing this credential immediately invalidates the QR currently shown. Anyone holding the old QR will no longer be able to use it.</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" className="border-white/20 bg-transparent text-[#fff8eb] hover:bg-white/10 hover:text-[#fff8eb]" onClick={() => setRotationWarning(false)} disabled={isPending}>Keep current QR</Button>
                    <Button type="button" className="bg-[#ffbe45] text-[#201407] hover:bg-[#ffd166]" onClick={() => issueCredential(true)} disabled={isPending}>
                      {isPending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <RotateCcwIcon data-icon="inline-start" />}
                      Replace credential
                    </Button>
                  </div>
                </div>
              ) : credentialIssued ? (
                <Button type="button" variant="outline" className="border-[#ffbe45]/45 bg-transparent text-[#fff8eb] hover:bg-[#ffbe45]/10 hover:text-[#fff8eb]" onClick={() => setRotationWarning(true)} disabled={isPending}>
                  <RotateCcwIcon data-icon="inline-start" />
                  Replace credential
                </Button>
              ) : (
                <Button type="button" className="bg-[#ffbe45] text-[#201407] hover:bg-[#ffd166]" onClick={() => issueCredential(false)} disabled={isPending}>
                  {isPending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <QrCodeIcon data-icon="inline-start" />}
                  Show my claim QR
                </Button>
              )}
            </CardContent>
          </Card>
        ) : null}

        {deliveryEligible ? (
          <DeliveryDetailsCard
            submitted={context.deliveryDetailsSubmitted}
            open={deliveryOpen}
            consent={deliveryConsent}
            recipient={deliveryRecipient}
            phone={deliveryPhone}
            address={deliveryAddress}
            pending={isPending}
            onToggle={() => setDeliveryOpen((open) => !open)}
            onConsentChange={setDeliveryConsent}
            onRecipientChange={setDeliveryRecipient}
            onPhoneChange={setDeliveryPhone}
            onAddressChange={setDeliveryAddress}
            onSubmit={submitDeliveryDetails}
            onWithdraw={withdrawDeliveryDetails}
          />
        ) : null}

        {isDeclinable(award.status) ? (
          <Card className="border border-white/10 bg-[#111214] text-[#fff8eb]">
            <CardHeader>
              <CardTitle className="text-base text-[#fff8eb]">Can’t claim this prize?</CardTitle>
              <CardDescription className="text-[#fff8eb]/58">Declining removes your current award. This cannot be undone from this screen.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {declineOpen ? (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor="giveaway-decline-reason" className="text-[#fff8eb]">Reason</Label>
                    <Input id="giveaway-decline-reason" value={declineReason} onChange={(event) => setDeclineReason(event.target.value)} placeholder="For example: I cannot attend the collection window" className="border-white/15 bg-white/5 text-[#fff8eb] placeholder:text-[#fff8eb]/35" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" className="border-white/20 bg-transparent text-[#fff8eb] hover:bg-white/10 hover:text-[#fff8eb]" onClick={() => setDeclineOpen(false)} disabled={isPending}>Keep award</Button>
                    <Button type="button" variant="destructive" onClick={declineAward} disabled={isPending || !declineReason.trim()}>
                      {isPending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <XCircleIcon data-icon="inline-start" />}
                      Decline award
                    </Button>
                  </div>
                </>
              ) : (
                <Button type="button" variant="outline" className="w-full border-white/20 bg-transparent text-[#fff8eb] hover:bg-white/10 hover:text-[#fff8eb]" onClick={() => setDeclineOpen(true)}>
                  I can’t claim this prize
                </Button>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </main>
  );
}

function UnavailableClaimScreen({ loginHref }: { loginHref?: string }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#050506] px-4 py-8 text-[#fff8eb]">
      <Card className="w-full max-w-md border border-white/10 bg-[#17181a] text-[#fff8eb]">
        <CardHeader>
          <div className="mb-1 grid size-10 place-items-center rounded-xl bg-[#e63b2e]/12 text-[#ff958a]"><AlertTriangleIcon className="size-5" /></div>
          <CardTitle className="text-[#fff8eb]">Claim unavailable</CardTitle>
          <CardDescription className="text-[#fff8eb]/62">This claim ticket is not available to this account, or it is no longer active.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {loginHref ? <Button asChild className="bg-[#ffbe45] text-[#201407] hover:bg-[#ffd166]"><Link href={loginHref}><LogInIcon data-icon="inline-start" />Log in as the winning rider</Link></Button> : null}
          <Button asChild variant="outline" className="border-white/20 bg-transparent text-[#fff8eb] hover:bg-white/10 hover:text-[#fff8eb]"><Link href="/">Back to Tambike</Link></Button>
        </CardContent>
      </Card>
    </main>
  );
}

function CampaignRouteStrip({ route }: { route: GiveawayClaimRouteStep[] }) {
  return (
    <ol className="grid grid-cols-4 border-t border-white/10 bg-black/20" aria-label="Claim progress">
      {route.map((step, index) => (
        <li key={step.label} className={cn("min-w-0 p-3 sm:p-4", index > 0 && "border-l border-white/10", step.state === "current" && "bg-[#ffbe45]/12", step.state === "unavailable" && "opacity-45")} aria-current={step.state === "current" ? "step" : undefined}>
          <span className={cn("block text-[10px] font-black tracking-[0.1em] uppercase", step.state === "complete" || step.state === "current" ? "text-[#ffbe45]" : "text-[#fff8eb]/45")}>{step.state === "complete" ? "Done" : step.state === "current" ? "Now" : step.state === "unavailable" ? "Unavailable" : "Next"}</span>
          <span className="mt-1 block text-xs font-bold leading-tight text-[#fff8eb] sm:text-sm">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

function StatusCard({ award }: { award: RiderGiveawayAwardSummary }) {
  const status = award.status;
  const copy = claimStatusCopy(status);
  return (
    <Card className={cn("border text-[#fff8eb]", copy.tone === "success" && "border-[#20b26b]/40 bg-[#20b26b]/12", copy.tone === "warning" && "border-[#ffbe45]/35 bg-[#ffbe45]/10", copy.tone === "error" && "border-[#e63b2e]/40 bg-[#e63b2e]/10", copy.tone === "muted" && "border-white/10 bg-[#17181a]")}>
      <CardContent className="flex gap-3">
        <copy.icon className={cn("mt-0.5 size-5 shrink-0", copy.tone === "success" ? "text-[#68df9f]" : copy.tone === "error" ? "text-[#ff958a]" : "text-[#ffbe45]")} />
        <div>
          <p className="font-semibold">{copy.title}</p>
          <p className="mt-1 text-sm leading-relaxed text-[#fff8eb]/72">{copy.body}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function DeliveryDetailsCard({
  submitted,
  open,
  consent,
  recipient,
  phone,
  address,
  pending,
  onToggle,
  onConsentChange,
  onRecipientChange,
  onPhoneChange,
  onAddressChange,
  onSubmit,
  onWithdraw,
}: {
  submitted: boolean;
  open: boolean;
  consent: boolean;
  recipient: string;
  phone: string;
  address: string;
  pending: boolean;
  onToggle: () => void;
  onConsentChange: (value: boolean) => void;
  onRecipientChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onAddressChange: (value: string) => void;
  onSubmit: () => void;
  onWithdraw: () => void;
}) {
  return (
    <Card className="border border-[#ffbe45]/30 bg-[#17181a] text-[#fff8eb]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[#fff8eb]"><TruckIcon className="size-5 text-[#ffbe45]" />Delivery details</CardTitle>
        <CardDescription className="text-[#fff8eb]/62">This verified prize will be delivered. Details are encrypted, consent-based, and retained only for the fulfilment window.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {submitted ? (
          <div className="grid gap-3 rounded-xl border border-[#20b26b]/35 bg-[#20b26b]/10 p-4">
            <div className="flex gap-2 text-sm text-[#fff8eb]"><CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-[#68df9f]" /><span>Delivery details are recorded for the approved fulfiller. They are not shown on this page.</span></div>
            <Button type="button" variant="outline" className="w-full border-white/20 bg-transparent text-[#fff8eb] hover:bg-white/10 hover:text-[#fff8eb]" onClick={onWithdraw} disabled={pending}>Withdraw delivery details</Button>
          </div>
        ) : open ? (
          <div className="grid gap-3 rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="grid gap-2"><Label htmlFor="delivery-recipient" className="text-[#fff8eb]">Recipient name</Label><Input id="delivery-recipient" value={recipient} onChange={(event) => onRecipientChange(event.target.value)} className="border-white/15 bg-white/5 text-[#fff8eb]" /></div>
            <div className="grid gap-2"><Label htmlFor="delivery-phone" className="text-[#fff8eb]">Phone (optional)</Label><Input id="delivery-phone" value={phone} onChange={(event) => onPhoneChange(event.target.value)} className="border-white/15 bg-white/5 text-[#fff8eb]" inputMode="tel" /></div>
            <div className="grid gap-2"><Label htmlFor="delivery-address" className="text-[#fff8eb]">Delivery address</Label><Input id="delivery-address" value={address} onChange={(event) => onAddressChange(event.target.value)} className="border-white/15 bg-white/5 text-[#fff8eb]" /></div>
            <Label className="items-start rounded-lg bg-white/5 p-3 text-sm font-normal leading-relaxed text-[#fff8eb]/78"><Checkbox checked={consent} onCheckedChange={(checked) => onConsentChange(checked === true)} /><span>I consent to Tambike storing these delivery details for this prize’s fulfilment window.</span></Label>
            <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="border-white/20 bg-transparent text-[#fff8eb] hover:bg-white/10 hover:text-[#fff8eb]" onClick={onToggle} disabled={pending}>Cancel</Button><Button type="button" className="bg-[#ffbe45] text-[#201407] hover:bg-[#ffd166]" onClick={onSubmit} disabled={pending || !consent || !recipient.trim() || !address.trim()}>{pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <TruckIcon data-icon="inline-start" />}Save delivery details</Button></div>
          </div>
        ) : (
          <Button type="button" className="bg-[#ffbe45] text-[#201407] hover:bg-[#ffd166]" onClick={onToggle}>Add delivery details</Button>
        )}
      </CardContent>
    </Card>
  );
}

function claimStatusCopy(status: RiderGiveawayAwardSummary["status"]) {
  switch (status) {
    case "pending_verification":
      return { tone: "warning" as const, icon: Clock3Icon, title: "Awaiting verification", body: "Your award is reserved. Generate a claim credential and show it to an authorized giveaway operator." };
    case "claimable":
      return { tone: "warning" as const, icon: QrCodeIcon, title: "Ready to claim", body: "Generate your credential when you are ready to present it at the claim desk." };
    case "verified":
      return { tone: "success" as const, icon: ShieldCheckIcon, title: "Claim verified", body: "An authorized operator has verified your claim. Follow the fulfilment instructions for this prize." };
    case "fulfilled":
      return { tone: "success" as const, icon: CheckCircle2Icon, title: "Prize fulfilled", body: "This prize has been recorded as fulfilled." };
    case "declined":
      return { tone: "muted" as const, icon: XCircleIcon, title: "Award declined", body: "You declined this award. There is no active claim credential." };
    case "expired":
      return { tone: "error" as const, icon: AlertTriangleIcon, title: "Claim expired", body: "The claim window has ended. Contact the organizer only if they have separately offered a recovery." };
    case "disqualified":
    case "voided":
      return { tone: "error" as const, icon: AlertTriangleIcon, title: "Award unavailable", body: "This award is no longer available for claim." };
    default:
      return { tone: "muted" as const, icon: Clock3Icon, title: "Award status updating", body: "This award is not ready for rider claim actions yet." };
  }
}

function isClaimCredentialAvailable(status: RiderGiveawayAwardSummary["status"]) {
  return status === "pending_verification" || status === "claimable";
}

function isDeclinable(status: RiderGiveawayAwardSummary["status"]) {
  return status === "pending_verification" || status === "claimable";
}

function formatGiveawayState(state: GiveawayState) {
  return state.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatClaimDeadline(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Scheduled deadline";
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  }).format(date);
}
