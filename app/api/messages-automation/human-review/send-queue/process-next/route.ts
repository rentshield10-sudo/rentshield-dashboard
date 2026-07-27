import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

const PROMPT_VERSION = "message_automation_v1";

const ANYCLICK_BASE_URL =
    process.env.ANYCLICK_BASE_URL || "http://127.0.0.1:3001";

const ANYCLICK_TEMPLATE_SEND_FLOW_ID =
    process.env.ANYCLICK_TEMPLATE_SEND_FLOW_ID ||
    "flow_1776996361867_nxr811";

async function sendThroughAnyClick(params: {
    phone: string;
    message: string;
}) {
    const anyClickPayload = {
        inputs: {
            parameters: params.phone,
            message: params.message,
            phone: params.phone,
        },
    };

    const response = await fetch(
        `${ANYCLICK_BASE_URL}/flows/${ANYCLICK_TEMPLATE_SEND_FLOW_ID}/run`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            cache: "no-store",
            body: JSON.stringify(anyClickPayload),
        }
    );

    const responseText = await response.text();
    let anyClickResult: unknown = responseText;

    try {
        anyClickResult = JSON.parse(responseText);
    } catch {
        // keep raw text
    }

    if (!response.ok) {
        throw new Error(
            typeof anyClickResult === "string"
                ? anyClickResult
                : JSON.stringify(anyClickResult)
        );
    }

    return {
        anyClickPayload,
        anyClickResult,
    };
}

export async function POST() {
    try {
        const { data: queuedJob, error: readError } = await supabaseServer
            .from("message_send_jobs")
            .select("*")
            .eq("status", "queued")
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();

        if (readError) throw readError;

        if (!queuedJob) {
            return NextResponse.json({
                ok: true,
                processed: false,
                message: "No queued jobs",
            });
        }

        const { data: sendingJob, error: updateError } = await supabaseServer
            .from("message_send_jobs")
            .update({
                status: "sending",
                updated_at: new Date().toISOString(),
            })
            .eq("id", queuedJob.id)
            .eq("status", "queued")
            .select("*")
            .single();

        if (updateError) throw updateError;

        try {
            const { anyClickPayload, anyClickResult } = await sendThroughAnyClick({
                phone: sendingJob.phone,
                message: sendingJob.message_text,
            });

            const { data: sentJob, error: sentError } = await supabaseServer
                .from("message_send_jobs")
                .update({
                    status: "sent",
                    sent_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    anyclick_payload: anyClickPayload,
                    anyclick_result: anyClickResult as any,
                    error: null,
                })
                .eq("id", sendingJob.id)
                .select("*")
                .single();

            if (sentError) throw sentError;

            if (sentJob.escalation_id) {
                const { error: escalationError } = await supabaseServer
                    .from("human_escalations")
                    .update({
                        status: "resolved",
                        resolved_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                    })
                    .eq("id", sentJob.escalation_id);

                if (escalationError) throw escalationError;
            }

            await supabaseServer.from("ai_decisions").insert({
                intent: "human_review_manual_send",
                decision: "manual_template_sent",
                reply_text: JSON.stringify({
                    phone: sentJob.phone,
                    aptAddress: sentJob.apt_address,
                    templateKey: sentJob.template_key,
                    messagePreview: sentJob.message_text,
                    anyClickPayload,
                    anyClickResult,
                    jobId: sentJob.id,
                    escalationId: sentJob.escalation_id,
                }),
                needs_human: false,
                human_reason: null,
                should_send: true,
                sent: true,
                error: null,
                model_used: "human_review",
                prompt_version: PROMPT_VERSION,
            });

            return NextResponse.json({
                ok: true,
                processed: true,
                job: sentJob,
            });
        } catch (sendError) {
            const errorMessage =
                sendError instanceof Error ? sendError.message : String(sendError);

            const { data: failedJob, error: failedError } = await supabaseServer
                .from("message_send_jobs")
                .update({
                    status: "failed",
                    error: errorMessage,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", sendingJob.id)
                .select("*")
                .single();

            if (failedError) throw failedError;

            await supabaseServer.from("ai_decisions").insert({
                intent: "human_review_manual_send",
                decision: "manual_template_send_failed",
                reply_text: JSON.stringify({
                    phone: failedJob.phone,
                    aptAddress: failedJob.apt_address,
                    templateKey: failedJob.template_key,
                    messagePreview: failedJob.message_text,
                    jobId: failedJob.id,
                    escalationId: failedJob.escalation_id,
                }),
                needs_human: true,
                human_reason: "manual_template_send_failed",
                should_send: true,
                sent: false,
                error: errorMessage,
                model_used: "human_review",
                prompt_version: PROMPT_VERSION,
            });

            return NextResponse.json(
                {
                    ok: false,
                    processed: true,
                    job: failedJob,
                    error: errorMessage,
                },
                { status: 502 }
            );
        }
    } catch (error) {
        console.error("POST send-queue/process-next error:", error);

        return NextResponse.json(
            {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}