import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

const PROMPT_VERSION = "message_automation_v1";

const anyClickBaseUrl =
    process.env.ANYCLICK_BASE_URL || "http://127.0.0.1:3001";

const templateSendFlowId =
    process.env.ANYCLICK_TEMPLATE_SEND_FLOW_ID || "flow_1776996361867_nxr811";

type QueueTemplateSendBody = {
    phone?: string;
    message?: string;
    leadId?: string;
    inboundText?: string;
    templateKey?: string;
    decisionId?: number | string;
    pipelineUpdateMode?: "requirements_sent" | "none" | string;
};

async function logDecision(params: {
    decision: string;
    replyText?: unknown;
    shouldSend?: boolean;
    sent?: boolean;
    error?: string | null;
}) {
    const { error } = await supabaseServer.from("ai_decisions").insert({
        intent: "intro_reply_requirements",
        decision: params.decision,
        reply_text:
            typeof params.replyText === "string"
                ? params.replyText
                : JSON.stringify(params.replyText || null),
        needs_human: false,
        human_reason: null,
        should_send: Boolean(params.shouldSend),
        sent: Boolean(params.sent),
        error: params.error || null,
        model_used: "rule_based",
        prompt_version: PROMPT_VERSION,
    });

    if (error) throw error;
}

async function updateDecisionSentStatus(params: {
    decisionId?: number | string;
    sent: boolean;
    error?: string | null;
}) {
    if (!params.decisionId) return;

    await supabaseServer
        .from("ai_decisions")
        .update({
            sent: params.sent,
            error: params.error || null,
        })
        .eq("id", params.decisionId);
}

export async function POST(request: Request) {
    try {
        const body = (await request.json()) as QueueTemplateSendBody;

        const phone = String(body.phone || "").trim();
        const message = String(body.message || "").trim();
        const leadId = body.leadId ? String(body.leadId).trim() : "";
        const inboundText = String(body.inboundText || "").trim();
        const templateKey = String(body.templateKey || "").trim();
        const pipelineUpdateMode = String(
            body.pipelineUpdateMode || "none"
        ).trim();

        if (!phone || !message) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "phone and message are required",
                },
                { status: 400 }
            );
        }

        const outboundPayload = {
            inputs: {
                parameters: phone,
                message,
                phone,
            },
        };

        const anyClickUrl = `${anyClickBaseUrl}/flows/${templateSendFlowId}/run`;

        const response = await fetch(anyClickUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            cache: "no-store",
            body: JSON.stringify(outboundPayload),
        });

        const responseText = await response.text();
        let anyClickResult: unknown = responseText;

        try {
            anyClickResult = JSON.parse(responseText);
        } catch {
            // Keep raw text response.
        }

        if (!response.ok) {
            const errorText =
                typeof anyClickResult === "string"
                    ? anyClickResult
                    : JSON.stringify(anyClickResult);

            await updateDecisionSentStatus({
                decisionId: body.decisionId,
                sent: false,
                error: errorText,
            });

            await logDecision({
                decision: "template_send_failed",
                shouldSend: true,
                sent: false,
                error: errorText,
                replyText: {
                    phone,
                    leadId,
                    templateKey,
                    pipelineUpdateMode,
                    message,
                    outboundPayload,
                    anyClickUrl,
                    anyClickResult,
                },
            });

            return NextResponse.json(
                {
                    ok: false,
                    sent: false,
                    error: "AnyClick template send failed",
                    status: response.status,
                    anyClickResult,
                },
                { status: 502 }
            );
        }

        let pipelineUpdate: unknown = null;

        if (
            pipelineUpdateMode === "requirements_sent" &&
            leadId &&
            templateKey === "02_requirements_request_v1"
        ) {
            const { data, error } = await supabaseServer.rpc(
                "mark_lead_requirements_sent",
                {
                    p_lead_id: leadId,
                    p_inbound_sms: inboundText,
                    p_outbound_sms: message,
                }
            );

            if (error) {
                await updateDecisionSentStatus({
                    decisionId: body.decisionId,
                    sent: true,
                    error: error.message,
                });

                await logDecision({
                    decision: "template_sent_but_pipeline_update_failed",
                    shouldSend: true,
                    sent: true,
                    error: error.message,
                    replyText: {
                        phone,
                        leadId,
                        templateKey,
                        pipelineUpdateMode,
                        message,
                        inboundText,
                        anyClickResult,
                    },
                });

                return NextResponse.json(
                    {
                        ok: false,
                        sent: true,
                        pipelineUpdated: false,
                        error: "Template SMS sent but pipeline update failed",
                        pipelineError: error.message,
                        anyClickResult,
                    },
                    { status: 500 }
                );
            }

            pipelineUpdate = data;
        }

        await updateDecisionSentStatus({
            decisionId: body.decisionId,
            sent: true,
            error: null,
        });

        await logDecision({
            decision: "template_sent",
            shouldSend: true,
            sent: true,
            replyText: {
                phone,
                leadId,
                templateKey,
                pipelineUpdateMode,
                message,
                inboundText,
                anyClickResult,
                pipelineUpdate,
            },
        });

        return NextResponse.json({
            ok: true,
            sent: true,
            templateKey,
            pipelineUpdateMode,
            pipelineUpdated: Boolean(pipelineUpdate),
            anyClickResult,
            pipelineUpdate,
        });
    } catch (error) {
        console.error(
            "POST /api/messages-automation/queue-template-send error:",
            error
        );

        return NextResponse.json(
            {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}