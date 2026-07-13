"use client";

import { QRCodeSVG } from "qrcode.react";

export function GiveawayClaimTicketQr({ payload }: { payload: string }) {
  return (
    <div className="mx-auto w-fit rounded-xl bg-[#fffaf0] p-3 shadow-[0_10px_28px_rgba(0,0,0,0.24)]">
      <QRCodeSVG
        value={payload}
        level="M"
        marginSize={2}
        size={224}
        bgColor="#fffaf0"
        fgColor="#151215"
        title="Tambike giveaway claim credential"
      />
    </div>
  );
}
