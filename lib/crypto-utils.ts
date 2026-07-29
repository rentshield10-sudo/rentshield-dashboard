import crypto from "crypto";

export function sha256Hex(data: string | Buffer | Uint8Array): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function generateOtpCode(): string {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
