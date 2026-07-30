import { Resend } from "resend";

// Sandbox sender until the custom domain (rentshieldpropertymanagement.com)
// is verified in Resend — swap to e.g. noreply@rentshieldpropertymanagement.com
// once that DNS work is done. In sandbox mode, Resend only allows sending
// to the account's own verified email address.
const FROM_ADDRESS = "onboarding@resend.dev";

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ id: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("Missing env var: RESEND_API_KEY");
  }

  const resend = new Resend(apiKey);
  const result = await resend.emails.send({ from: FROM_ADDRESS, to, subject, html });

  if (result.error) {
    throw new Error(`Resend send failed: ${result.error.message}`);
  }
  if (!result.data) {
    throw new Error("Resend send returned no data.");
  }

  return { id: result.data.id };
}
