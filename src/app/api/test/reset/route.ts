import { resetTambikeBackendForTests } from "@/server/backend";

export async function POST() {
  if (
    process.env.TAMBIKE_BACKEND !== "memory" ||
    process.env.TAMBIKE_ENABLE_TEST_RESET !== "true"
  ) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await resetTambikeBackendForTests();
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
