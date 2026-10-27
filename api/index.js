/**
 * Vercel Serverless Function — FairShift API handler.
 *
 * All /api/* requests are rewritten here by vercel.json.
 * Re-exports the default handler from server.js (an async (req, res) function).
 * The handler contains the full routing logic and serves both API and static
 * files, so no additional configuration is needed.
 *
 * In-memory store resets on cold start — consistent with the demo disclaimer.
 */
export { default } from "../server.js";
