import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { renderTemplatePdf } from "@/lib/pdf-generation";
import { substituteVariables } from "@/lib/template-vars";

async function getParams(context: { params: Promise<{ id: string }> | { id: string } }) {
  return await context.params;
}

// Renders the current draft's filled-in template as a PDF on demand, for
// staff to eyeball before sending it out for signing. Not persisted anywhere
// -- this is separate from the original PDF generated at envelope-creation
// time in app/api/lease-signing/requests/route.ts.
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await getParams(context);

    const { data: template, error: templateError } = await supabaseServer
      .from("lease_templates")
      .select("body")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (templateError) throw templateError;
    if (!template?.body) {
      return NextResponse.json({ ok: false, error: "No lease template has been saved yet." }, { status: 400 });
    }

    const { data: draftValues, error: valuesError } = await supabaseServer
      .from("lease_template_draft_values")
      .select("variable_name, value")
      .eq("draft_id", id);
    if (valuesError) throw valuesError;

    const valuesMap: Record<string, string> = {};
    for (const row of draftValues ?? []) {
      valuesMap[row.variable_name] = row.value;
    }

    const filledText = substituteVariables(template.body, valuesMap);
    const pdfBytes = await renderTemplatePdf(filledText);
    const pdfBuffer = Buffer.from(pdfBytes);

    // Content-Length is required for Chrome's inline PDF viewer -- without
    // it, the response falls back to Transfer-Encoding: chunked and Chrome
    // downloads the file instead of rendering it (confirmed live).
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=lease-preview.pdf",
        "Content-Length": String(pdfBuffer.length),
      },
    });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}
