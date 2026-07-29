// Simple in-memory sliding-window rate limiter, keyed by an arbitrary
// string (e.g. IP address). This resets on cold starts and isn't shared
// across multiple serverless instances, so it's a basic deterrent, not a
// hard guarantee, on a platform like Vercel — acceptable for this
// project's scale, but worth knowing if traffic ever grows.

const buckets = new Map<string, number[]>();

export function isRateLimited(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const timestamps = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);

  if (timestamps.length >= maxRequests) {
    buckets.set(key, timestamps);
    return true;
  }

  timestamps.push(now);
  buckets.set(key, timestamps);
  return false;
}
