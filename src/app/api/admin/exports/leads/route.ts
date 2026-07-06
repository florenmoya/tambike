import type { NextRequest } from "next/server";
import { BackendError, getTambikeBackend } from "@/server/backend";
import { sessionCookieName } from "@/server/session-cookie";

function errorResponse(error: unknown) {
  if (error instanceof BackendError) {
    const statusByCode: Record<BackendError["code"], number> = {
      UNAUTHENTICATED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      INVALID_INPUT: 400,
      WRONG_EVENT: 409,
      ALREADY_CHECKED_IN: 409,
      CANCELLED_PASS: 409,
    };

    return Response.json({ error: error.code }, { status: statusByCode[error.code] });
  }

  return Response.json({ error: "EXPORT_FAILED" }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const token = request.cookies.get(sessionCookieName)?.value;
  if (!token) {
    return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const backend = await getTambikeBackend();

  try {
    const csv = await backend.exportLeadsCsv(token);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="tambike-leads.csv"',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
