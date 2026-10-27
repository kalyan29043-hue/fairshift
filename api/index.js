/**
 * Vercel Serverless Function entrypoint.
 *
 * Vercel routes all /api/* requests here (see vercel.json).
 * The FairShift createServer() handler is reused directly — Vercel passes
 * (req, res) compatible with Node's IncomingMessage / ServerResponse, so the
 * existing routing logic works without modification.
 *
 * NOTE: Vercel serverless functions are stateless and ephemeral. The in-memory
 * store resets on every cold start. This is consistent with the existing
 * simulation/demo disclaimer already shown in the UI.
 */
import { createServer } from "../server.js";

// Create one server instance per function instance (warm across requests in the
// same container, reset on cold start — consistent with demo storage notice).
const server = createServer();

// Extract the internal request listener from the http.Server instance.
// This is the async (req, res) handler passed to http.createServer().
const handler = server.listeners("request")[0];

export default handler;

