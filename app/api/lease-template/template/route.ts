import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

const DEFAULT_BODY = `NEW JERSEY RESIDENTIAL LEASE AGREEMENT

This residential Lease Agreement ("Lease") is entered into by and between the Landlord and Tenant: {{tenantName}}.

1. PROPERTY: The leased premises is located at {{address}}, {{city}}, {{state}}.

2. TERM: This Lease shall commence on {{leaseStart}} and expire on {{leaseEnd}}.

3. RENT: Tenant agrees to pay rent in the amount of {{rentAmount}} per month.`;

// Single-template model for now: always reads/writes the most recently
// updated row rather than managing a list, matching the "one fixed
// template" scope decision -- extensible to multiple templates later
// without a schema change (the table already supports more than one row).
export async function GET() {
  try {
    const { data, error } = await supabaseServer
      .from("lease_templates")
      .select("id, name, body, updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return NextResponse.json({
        ok: true,
        template: { id: null, name: "Lease Renewal Agreement", body: DEFAULT_BODY },
      });
    }

    return NextResponse.json({ ok: true, template: data });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const name = String(body?.name ?? "Lease Renewal Agreement").trim();
    const templateBody = String(body?.body ?? "");
    const id = body?.id ? Number(body.id) : null;

    if (id) {
      const { data, error } = await supabaseServer
        .from("lease_templates")
        .update({ name, body: templateBody, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("id, name, body, updated_at")
        .single();
      if (error) throw error;
      return NextResponse.json({ ok: true, template: data });
    }

    const { data, error } = await supabaseServer
      .from("lease_templates")
      .insert({ name, body: templateBody })
      .select("id, name, body, updated_at")
      .single();
    if (error) throw error;

    return NextResponse.json({ ok: true, template: data });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}
