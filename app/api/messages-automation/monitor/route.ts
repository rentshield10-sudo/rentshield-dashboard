import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

const STATE_ID = "main";
const PROMPT_VERSION = "message_automation_v1";

async function ensureState() {
    const { data: existing, error: readError } = await supabaseServer
        .from("message_automation_state")
        .select("*")
        .eq("id", STATE_ID)
        .maybeSingle();

    if (readError) throw readError;

    if (existing) return existing;

    const { data, error } = await supabaseServer
        .from("message_automation_state")
        .insert({
            id: STATE_ID,
            polling_enabled: false,
            interval_minutes: 2,
            status: "idle",
        })
        .select("*")
        .single();

    if (error) throw error;

    return data;
}

export async function GET() {
    try {
        const state = await ensureState();

        const { data: decisions, error: decisionsError } = await supabaseServer
            .from("ai_decisions")
            .select(
                "id, created_at, intent, decision, reply_text, needs_human, human_reason, should_send, sent, error, model_used, prompt_version"
            )
            .eq("prompt_version", PROMPT_VERSION)
            .order("created_at", { ascending: false })
            .limit(50);

        if (decisionsError) throw decisionsError;

        const { data: humanEscalations, error: escalationError } =
            await supabaseServer
                .from("human_escalations")
                .select(
                    "id, created_at, updated_at, phone, reason, priority, status, human_notes, resolved_at"
                )
                // Keep resolved rows visible so the left pane can show green Done
                // and still allow Reopen. Increase/lower this limit if needed.
                .in("status", ["open", "resolved"])
                .ilike("reason", "automation:%")
                .order("created_at", { ascending: false })
                .limit(100);

        if (escalationError) throw escalationError;

        return NextResponse.json({
            ok: true,
            state,
            decisions: decisions || [],
            humanEscalations: humanEscalations || [],
        });
    } catch (error) {
        console.error("GET /api/messages-automation/monitor error:", error);

        return NextResponse.json(
            {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}

export async function PATCH(request: Request) {
    try {
        await ensureState();

        const body = await request.json();

        const updatePayload: Record<string, unknown> = {
            updated_at: new Date().toISOString(),
        };

        if (typeof body.pollingEnabled === "boolean") {
            updatePayload.polling_enabled = body.pollingEnabled;
        }

        if (typeof body.intervalMinutes === "number") {
            updatePayload.interval_minutes = Math.max(1, body.intervalMinutes);
        }

        if (typeof body.status === "string") {
            updatePayload.status = body.status;
        }

        const { data, error } = await supabaseServer
            .from("message_automation_state")
            .update(updatePayload)
            .eq("id", STATE_ID)
            .select("*")
            .single();

        if (error) throw error;

        return NextResponse.json({
            ok: true,
            state: data,
        });
    } catch (error) {
        console.error("PATCH /api/messages-automation/monitor error:", error);

        return NextResponse.json(
            {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}

export async function DELETE() {
    try {
        await ensureState();

        const { error: decisionsError } = await supabaseServer
            .from("ai_decisions")
            .delete()
            .eq("prompt_version", PROMPT_VERSION);

        if (decisionsError) throw decisionsError;

        const { error: escalationError } = await supabaseServer
            .from("human_escalations")
            .update({
                status: "resolved",
                resolved_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq("status", "open")
            .ilike("reason", "automation:%");

        if (escalationError) throw escalationError;

        const { data, error: stateError } = await supabaseServer
            .from("message_automation_state")
            .update({
                polling_enabled: false,
                status: "idle",
                last_checked_at: null,
                updated_at: new Date().toISOString(),
            })
            .eq("id", STATE_ID)
            .select("*")
            .single();

        if (stateError) throw stateError;

        return NextResponse.json({
            ok: true,
            state: data,
            decisions: [],
            humanEscalations: [],
        });
    } catch (error) {
        console.error("DELETE /api/messages-automation/monitor error:", error);

        return NextResponse.json(
            {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}
