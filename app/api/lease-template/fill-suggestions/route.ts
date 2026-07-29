import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

type Suggestion = { source: "rentvine" | "supabase" | "remembered"; value: string };

const LABEL_KEYWORD_MAP: { keywords: string[]; column: string }[] = [
  { keywords: ["tenant", "lessee", "resident"], column: "tenant_name" },
  { keywords: ["address"], column: "address" },
  { keywords: ["unit", "apt"], column: "unit" },
  { keywords: ["rent", "price"], column: "current_rent" },
  { keywords: ["commence", "start", "activation"], column: "activation_1" },
  { keywords: ["expir", "end"], column: "expiration_1" },
];

function matchColumn(label: string): string | null {
  const lower = label.toLowerCase();
  for (const entry of LABEL_KEYWORD_MAP) {
    if (entry.keywords.some((k) => lower.includes(k))) return entry.column;
  }
  return null;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const label = url.searchParams.get("label") ?? "";
    const apartmentId = url.searchParams.get("apartmentId");

    const suggestions: Suggestion[] = [];

    if (apartmentId) {
      const column = matchColumn(label);
      if (column) {
        const { data, error } = await supabaseServer
          .from("apartment_lease_details")
          .select(column)
          .eq("id", apartmentId)
          .maybeSingle();
        if (error) throw error;
        const raw = (data as Record<string, unknown> | null)?.[column];
        if (raw !== null && raw !== undefined && raw !== "") {
          suggestions.push({ source: "supabase", value: String(raw) });
        }
      }
    }

    const { data: remembered, error: rememberedError } = await supabaseServer
      .from("lease_template_remembered_values")
      .select("value")
      .eq("label", label)
      .order("last_used_at", { ascending: false })
      .limit(5);

    if (rememberedError) throw rememberedError;

    for (const row of remembered ?? []) {
      suggestions.push({ source: "remembered", value: row.value as string });
    }

    return NextResponse.json({ ok: true, suggestions });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}
