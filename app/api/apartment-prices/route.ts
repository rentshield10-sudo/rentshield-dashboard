import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

function parsePositivePrice(value: unknown) {
    const parsed = Number(String(value ?? "").replace(/[$,]/g, ""));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function GET() {
    try {
        const [pricesResponse, historyResponse] = await Promise.all([
            supabaseServer
                .from("apartment_prices")
                .select(
                    "apt_address, current_price, price_effective_date, note, updated_at",
                )
                .order("apt_address"),
            supabaseServer
                .from("apartment_price_history")
                .select(
                    "id, apt_address, previous_price, new_price, effective_date, note, created_at",
                )
                .order("effective_date", { ascending: true })
                .order("id", { ascending: true }),
        ]);

        if (pricesResponse.error) throw pricesResponse.error;
        if (historyResponse.error) throw historyResponse.error;

        const prices = (pricesResponse.data || []).map((row) => ({
            ...row,
            current_price:
                row.current_price === null ? null : Number(row.current_price),
        }));

        const history = (historyResponse.data || []).map((row) => ({
            ...row,
            previous_price:
                row.previous_price === null ? null : Number(row.previous_price),
            new_price: Number(row.new_price),
        }));

        return NextResponse.json({
            ok: true,
            prices,
            history,
        });
    } catch (error) {
        return NextResponse.json(
            {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            },
            { status: 500 },
        );
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const aptAddress = String(body?.aptAddress || "").trim();
        const newPrice = parsePositivePrice(body?.newPrice);
        const effectiveDate = String(body?.effectiveDate || "").trim();
        const note = String(body?.note || "").trim() || null;

        if (!aptAddress) {
            return NextResponse.json(
                { ok: false, error: "Apartment address is required." },
                { status: 400 },
            );
        }

        if (newPrice === null) {
            return NextResponse.json(
                { ok: false, error: "New price must be greater than zero." },
                { status: 400 },
            );
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
            return NextResponse.json(
                { ok: false, error: "A valid effective date is required." },
                { status: 400 },
            );
        }

        const { data, error } = await supabaseServer.rpc("set_apartment_price", {
            p_apt_address: aptAddress,
            p_new_price: newPrice,
            p_effective_date: effectiveDate,
            p_note: note,
        });

        if (error) throw error;

        const result = (data || []).map((row: Record<string, unknown>) => ({
            ...row,
            previous_price:
                row.previous_price === null ? null : Number(row.previous_price),
            current_price: Number(row.current_price),
        }));

        return NextResponse.json({ ok: true, result });
    } catch (error) {
        return NextResponse.json(
            {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            },
            { status: 500 },
        );
    }
}