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

export async function GET() {
    try {
        const { data, error } = await supabaseServer
            .from("message_send_jobs")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(50);

        if (error) throw error;

        return NextResponse.json({
            ok: true,
            jobs: data || [],
        });
    } catch (error) {
        console.error("GET human-review/send-queue error:", error);

        return NextResponse.json(
            {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();

        const phone = normalizePhone(body.phone);
        const message = String(body.message || body.messageText || "").trim();

        if (!phone) {
            return NextResponse.json(
                { ok: false, error: "phone is required" },
                { status: 400 }
            );
        }

        if (!message) {
            return NextResponse.json(
                { ok: false, error: "message is required" },
                { status: 400 }
            );
        }

        const { data, error } = await supabaseServer
            .from("message_send_jobs")
            .insert({
                source: "human_review",
                escalation_id: body.escalationId || null,
                lead_id: body.leadId || null,
                phone,
                apt_address: body.aptAddress || null,
                template_key: body.templateKey || null,
                message_text: message,
                status: "queued",
            })
            .select("*")
            .single();

        if (error) throw error;

        return NextResponse.json({
            ok: true,
            job: data,
        });
    } catch (error) {
        console.error("POST human-review/send-queue error:", error);

        return NextResponse.json(
            {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}