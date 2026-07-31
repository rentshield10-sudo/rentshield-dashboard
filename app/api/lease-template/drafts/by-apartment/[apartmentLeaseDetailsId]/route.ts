import { NextResponse } from "next/server";
import { getOrCreateDraftForApartment } from "@/lib/lease-draft";

async function getParams(
  context: { params: Promise<{ apartmentLeaseDetailsId: string }> | { apartmentLeaseDetailsId: string } },
) {
  return await context.params;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ apartmentLeaseDetailsId: string }> | { apartmentLeaseDetailsId: string } },
) {
  try {
    const { apartmentLeaseDetailsId } = await getParams(context);
    const id = Number(apartmentLeaseDetailsId);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ ok: false, error: "Invalid apartment lease details id." }, { status: 400 });
    }

    const draftId = await getOrCreateDraftForApartment(id);
    return NextResponse.json({ ok: true, draftId });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}
