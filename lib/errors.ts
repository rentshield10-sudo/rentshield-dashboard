// For tenant-facing routes: log the real error server-side, but never
// return raw internal error text (e.g. a Postgres/Supabase error string) to
// an untrusted caller. Routes still craft their own specific, intentional
// user-facing messages for expected business-logic failures (invalid token,
// expired link, wrong code, etc.) -- this is only for the unexpected-error
// catch-all case.
export function safeErrorResponse(error: unknown, context: string): { error: string } {
  console.error(`[${context}]`, error);
  return { error: "Something went wrong. Please try again or contact the property manager." };
}
