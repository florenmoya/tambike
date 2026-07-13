import { RiderSelfCheckInScreen } from "@/features/check-in/rider-self-check-in-screen";
import { decodeSelfCheckInToken } from "@/features/check-in/qr-token";

export default async function CheckInPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return <RiderSelfCheckInScreen token={decodeSelfCheckInToken(token)} />;
}
