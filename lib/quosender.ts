type RenderTemplateByAddressParams = {
    aptAddress: string;
    templateKey: string;
};

export type RenderedQuoSenderTemplate = {
    templateKey?: string;
    templateName?: string;
    apt_address?: string;
    aptAddress?: string;
    message?: string;
    renderedMessage?: string;
    text?: string;
    body?: string;
    content?: string;
    [key: string]: unknown;
};

const quoSenderBaseUrl =
    process.env.QUOSENDER_BASE_URL || "http://127.0.0.1:3000";

export async function renderQuoSenderTemplateByAddress({
    aptAddress,
    templateKey,
}: RenderTemplateByAddressParams): Promise<RenderedQuoSenderTemplate> {
    const response = await fetch(
        `${quoSenderBaseUrl}/api/templates/render-by-address`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            cache: "no-store",
            body: JSON.stringify({
                apt_address: aptAddress,
                templateKey,
            }),
        }
    );

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
        throw new Error(
            `QuoSender template render failed: ${payload?.error || payload?.message || response.statusText
            }`
        );
    }

    return payload;
}

export function getRenderedTemplateText(payload: RenderedQuoSenderTemplate) {
    return String(
        payload.message ||
        payload.renderedMessage ||
        payload.text ||
        payload.body ||
        payload.content ||
        ""
    ).trim();
}