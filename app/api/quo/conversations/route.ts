import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

function normalizePhone(phone?: string | null) {
    const raw = String(phone || "").trim();

    if (!raw) return null;
    if (raw.startsWith("+")) return raw;

    const digits = raw.replace(/\D/g, "");

    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;

    return raw;
}

function parseHumanNotes(notes?: string | null) {
    if (!notes) return null;

    try {
        return JSON.parse(notes);
    } catch {
        return null;
    }
}

function getInboundText(notes: any) {
    return (
        notes?.inboundText ||
        notes?.inbound_text ||
        notes?.extracted?.body ||
        notes?.message ||
        null
    );
}

async function getParams(context: { params: Promise<{ id: string }> | { id: string } }) {
    return await context.params;
}

export async function GET(
    _request: Request,
    context: { params: Promise<{ id: string }> | { id: string } }
) {
    try {
        const params = await getParams(context);
        const escalationId = String(params.id || "").trim();

        if (!escalationId || escalationId === "undefined" || escalationId === "null") {
            return NextResponse.json(
                {
                    ok: false,
                    error: "Invalid escalation id",
                    receivedId: escalationId,
                },
                { status: 400 }
            );
        }

        const { data: escalation, error: escalationError } = await supabaseServer
            .from("human_escalations")
            .select(
                "id, created_at, updated_at, phone, reason, priority, status, human_notes, resolved_at"
            )
            .eq("id", escalationId)
            .single();

        if (escalationError) throw escalationError;

        const notes = parseHumanNotes(escalation.human_notes);

        const normalizedPhone = normalizePhone(escalation.phone);
        const digits = String(normalizedPhone || escalation.phone || "").replace(/\D/g, "");
        const last10 = digits.slice(-10);

        let lead = notes?.lead || null;

        if (!lead && last10) {
            const { data: leadRows, error: leadError } = await supabaseServer
                .from("dashboard_leads")
                .select(
                    "lead_id, lead_name, phone, apt_address, current_status, conversation_stage, pipeline_status"
                )
                .ilike("phone", `%${last10}%`)
                .order("lead_id", { ascending: false })
                .limit(5);

            if (leadError) throw leadError;

            lead = leadRows?.[0] || null;
        }

        return NextResponse.json({
            ok: true,
            escalation,
            lead,
            phone: normalizedPhone || escalation.phone,
            aptAddress: lead?.apt_address || notes?.lead?.apt_address || null,
            inboundText: getInboundText(notes),
            humanNotes: notes,
        });
    } catch (error) {
        console.error("GET /api/messages-automation/human-review/[id] error:", error);

        return NextResponse.json(
            {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}

export async function PATCH(
    request: Request,
    context: { params: Promise<{ id: string }> | { id: string } }
) {
    try {
        const params = await getParams(context);
        const escalationId = String(params.id || "").trim();

        if (!escalationId || escalationId === "undefined" || escalationId === "null") {
            return NextResponse.json(
                {
                    ok: false,
                    error: "Invalid escalation id",
                    receivedId: escalationId,
                },
                { status: 400 }
            );
        }

        const body = await request.json().catch(() => ({}));
        const status = String(body.status || "").trim();

        if (status !== "open" && status !== "resolved") {
            return NextResponse.json(
                { ok: false, error: "status must be open or resolved" },
                { status: 400 }
            );
        }

        const now = new Date().toISOString();

        const { data, error } = await supabaseServer
            .from("human_escalations")
            .update({
                status,
                resolved_at: status === "resolved" ? now : null,
                updated_at: now,
            })
            .eq("id", escalationId)
            .select(
                "id, created_at, updated_at, phone, reason, priority, status, human_notes, resolved_at"
            )
            .single();

        if (error) throw error;

        return NextResponse.json({
            ok: true,
            escalation: data,
        });
    } catch (error) {
        console.error("PATCH /api/messages-automation/human-review/[id] error:", error);

        return NextResponse.json(
            {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}
