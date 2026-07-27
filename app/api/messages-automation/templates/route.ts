import { NextResponse } from "next/server";

const quoSenderBaseUrl =
    process.env.QUOSENDER_BASE_URL || "http://localhost:3000";

async function fetchJson(url: string) {
    const response = await fetch(url, {
        cache: "no-store",
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
        throw new Error(
            payload?.error ||
            payload?.message ||
            `QuoSender returned ${response.status}`
        );
    }

    return payload;
}

export async function GET() {
    try {
        let payload: unknown;

        try {
            // This should match your QuoSender Template Builder if mounted under /api.
            payload = await fetchJson(`${quoSenderBaseUrl}/api/templates`);
        } catch {
            // Fallback in case your Express router is mounted without /api.
            payload = await fetchJson(`${quoSenderBaseUrl}/templates`);
        }

        const templates = Array.isArray(payload)
            ? payload
            : Array.isArray((payload as any)?.templates)
                ? (payload as any).templates
                : [];

        return NextResponse.json({
            ok: true,
            templates,
        });
    } catch (error) {
        console.error("GET /api/messages-automation/templates error:", error);

        return NextResponse.json(
            {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}