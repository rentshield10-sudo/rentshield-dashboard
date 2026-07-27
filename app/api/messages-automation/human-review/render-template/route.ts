import { NextResponse } from "next/server";
import {
    getRenderedTemplateText,
    renderQuoSenderTemplateByAddress,
} from "@/lib/quosender";

export async function POST(request: Request) {
    try {
        const body = await request.json();

        const aptAddress = String(body.aptAddress || body.apt_address || "").trim();
        const templateKey = String(body.templateKey || body.templateId || "").trim();

        if (!aptAddress) {
            return NextResponse.json(
                { ok: false, error: "aptAddress is required" },
                { status: 400 }
            );
        }

        if (!templateKey) {
            return NextResponse.json(
                { ok: false, error: "templateKey is required" },
                { status: 400 }
            );
        }

        const rendered = await renderQuoSenderTemplateByAddress({
            aptAddress,
            templateKey,
        });

        const message = getRenderedTemplateText(rendered);

        if (!message) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "Template rendered empty message",
                    rendered,
                },
                { status: 422 }
            );
        }

        return NextResponse.json({
            ok: true,
            message,
            rendered,
        });
    } catch (error) {
        console.error("POST human-review/render-template error:", error);

        return NextResponse.json(
            {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}