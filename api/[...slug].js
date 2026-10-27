/**
 * Vercel catch-all serverless function for all /api/* routes.
 *
 * File name api/[...slug].js makes Vercel's file-system router handle every
 * request under /api/ (e.g. /api/health, /api/shifts, /api/reports) without
 * any custom rewrites in vercel.json. Vercel preserves the original req.url,
 * so server.js's pathname routing (pathname.startsWith("/api/")) works correctly.
 *
 * In-memory store resets on cold start — consistent with the demo disclaimer.
 */
export { default } from "../server.js";
