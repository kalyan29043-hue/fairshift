/**
 * FairShift Native HTTP Server
 * 
 * Provides REST API endpoints for shift management, safety/grievance reporting,
 * and employer fatigue/fairness indicators using Node.js built-ins only.
 * 
 * DISCLAIMER & STORAGE NOTICE:
 * Demonstrates fair scheduling assumptions for construction and college sectors.
 * In-memory storage only; state resets on server restart.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import { fileURLToPath } from "node:url";
import { createStore, STORAGE_NOTICE } from "./lib/store.js";
import { ValueError, DEMO_DISCLAIMER } from "./lib/fairshift.js";

const MAX_BODY_BYTES = 64 * 1024; // 64 KB limit

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon"
};

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "public");

const SECURITY_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Content-Security-Policy": "default-src 'self'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer"
};

function serveStaticFile(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendError(res, 405, "Method Not Allowed");
  }
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const normalized = path.normalize(safePath).replace(/^(\.\.[\/\\])+/, "");
  const targetPath = path.join(PUBLIC_DIR, normalized);

  if (!targetPath.startsWith(PUBLIC_DIR)) {
    return sendError(res, 403, "Forbidden");
  }

  if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
    return sendError(res, 404, "File not found");
  }

  const ext = path.extname(targetPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const content = fs.readFileSync(targetPath);

  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": content.length,
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; img-src 'self' data:; connect-src 'self'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer"
  });
  if (req.method === "HEAD") {
    return res.end();
  }
  res.end(content);
}

function sendJson(res, statusCode, data, headers = {}) {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    ...headers,
    "Content-Length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

function sendError(res, statusCode, message, extra = {}) {
  sendJson(res, statusCode, {
    error: message,
    ...extra
  });
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers["content-type"] || "";
    if (contentType && !contentType.toLowerCase().includes("application/json")) {
      const err = new Error("Unsupported Media Type: Content-Type must be application/json");
      err.statusCode = 415;
      return reject(err);
    }

    let body = "";
    let bytesReceived = 0;

    req.on("data", chunk => {
      bytesReceived += chunk.length;
      if (bytesReceived > MAX_BODY_BYTES) {
        req.destroy();
        const err = new Error("Payload Too Large: request body exceeds 64 KB limit");
        err.statusCode = 413;
        return reject(err);
      }
      body += chunk.toString("utf8");
    });

    req.on("end", () => {
      if (!body || body.trim() === "") {
        return resolve({});
      }
      try {
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch {
        const err = new Error("Bad Request: Malformed JSON payload");
        err.statusCode = 400;
        reject(err);
      }
    });

    req.on("error", reject);
  });
}

export function createServer(storeInstance) {
  const store = storeInstance || createStore();

  return http.createServer(async (req, res) => {
    try {
      const host = req.headers.host || "localhost";
      const parsedUrl = new URL(req.url, `http://${host}`);
      const pathname = parsedUrl.pathname;
      const method = req.method.toUpperCase();

      // Serve static frontend files for non-API routes
      if (!pathname.startsWith("/api/")) {
        return serveStaticFile(req, res, pathname);
      }

      // 1. GET /api/health
      if (pathname === "/api/health") {
        if (method !== "GET") {
          return sendError(res, 405, "Method Not Allowed");
        }
        return sendJson(res, 200, {
          status: "ok",
          service: "fairshift-api",
          timestamp: new Date().toISOString(),
          uptimeSeconds: Math.floor(process.uptime()),
          storageNotice: STORAGE_NOTICE,
          disclaimer: DEMO_DISCLAIMER
        });
      }

      // 2. GET /api/config
      if (pathname === "/api/config") {
        if (method !== "GET") {
          return sendError(res, 405, "Method Not Allowed");
        }
        const sector = parsedUrl.searchParams.get("sector") || "construction";
        return sendJson(res, 200, {
          activeSector: sector,
          config: store.getSectorConfig(sector),
          allConfigs: store.getAllConfigs()
        });
      }

      // 3. GET /api/workers
      if (pathname === "/api/workers") {
        if (method !== "GET") {
          return sendError(res, 405, "Method Not Allowed");
        }
        const sector = parsedUrl.searchParams.get("sector");
        const workers = store.getWorkers(sector);
        return sendJson(res, 200, {
          workers,
          sector: sector || "all"
        });
      }

      // 3. GET & POST /api/shifts
      if (pathname === "/api/shifts") {
        if (method === "GET") {
          const sector = parsedUrl.searchParams.get("sector");
          const workerId = parsedUrl.searchParams.get("workerId");
          const shifts = store.getShifts(sector, workerId);
          return sendJson(res, 200, {
            shifts,
            totalCount: shifts.length,
            sector: sector || "all",
            storageNotice: STORAGE_NOTICE
          });
        }

        if (method === "POST") {
          const body = await parseJsonBody(req);
          const newShift = store.createShift(body);
          return sendJson(res, 201, {
            shift: newShift,
            message: "Shift created successfully in demonstration store."
          });
        }

        return sendError(res, 405, "Method Not Allowed");
      }

      // 4. POST /api/shifts/:id/claim
      const claimMatch = pathname.match(/^\/api\/shifts\/([^/]+)\/claim$/);
      if (claimMatch) {
        if (method !== "POST") {
          return sendError(res, 405, "Method Not Allowed");
        }
        const shiftId = decodeURIComponent(claimMatch[1]);
        const body = await parseJsonBody(req);
        if (!body.workerId) {
          return sendError(res, 400, "Missing required field: workerId");
        }
        const claimResult = store.claimShift(shiftId, body.workerId);
        return sendJson(res, 200, {
          ...claimResult,
          message: "Shift claimed successfully."
        });
      }

      // 5. GET & POST /api/reports
      if (pathname === "/api/reports") {
        if (method === "GET") {
          const sector = parsedUrl.searchParams.get("sector");
          const refId = parsedUrl.searchParams.get("refId");
          const result = store.getReports(sector, refId);
          if (refId && !result) {
            return sendError(res, 404, `Report not found with reference ID: ${refId}`);
          }
          return sendJson(res, 200, {
            reports: Array.isArray(result) ? result : [result],
            queryRefId: refId || null
          });
        }

        if (method === "POST") {
          const body = await parseJsonBody(req);
          const newReport = store.createReport(body);
          return sendJson(res, 201, {
            report: newReport,
            message: "Report submitted. Keep this reference ID to track status updates."
          });
        }

        return sendError(res, 405, "Method Not Allowed");
      }

      // 6. PATCH /api/reports/:id/status
      const reportStatusMatch = pathname.match(/^\/api\/reports\/([^/]+)\/status$/);
      if (reportStatusMatch) {
        if (method !== "PATCH") {
          return sendError(res, 405, "Method Not Allowed");
        }
        const refId = decodeURIComponent(reportStatusMatch[1]);
        const body = await parseJsonBody(req);
        if (!body.status) {
          return sendError(res, 400, "Missing required field: status");
        }
        const updated = store.updateReportStatus(refId, body.status, {
          actor: body.actor || "Supervisor/Admin",
          note: body.note || ""
        });
        return sendJson(res, 200, {
          report: updated,
          message: `Report status transitioned to ${body.status}.`
        });
      }

      // 7. GET /api/admin/metrics
      if (pathname === "/api/admin/metrics") {
        if (method !== "GET") {
          return sendError(res, 405, "Method Not Allowed");
        }
        const sector = parsedUrl.searchParams.get("sector") || "construction";
        const metrics = store.getAdminMetrics(sector);
        return sendJson(res, 200, {
          metrics,
          sector
        });
      }

      // 404 for unknown endpoints
      return sendError(res, 404, "Endpoint not found");

    } catch (err) {
      let status = err.statusCode;
      if (!status) {
        if (err.name === "ValueError" || err.name === "TypeError") {
          status = 400;
        } else {
          status = 500;
        }
      }
      return sendError(res, status, err.message || "Internal Server Error", {
        details: err.evaluation || null
      });
    }
  });
}

// Start server when executed directly as script
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const PORT = process.env.PORT || 8080;
  const HOST = "0.0.0.0";
  const server = createServer();
  server.listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`FairShift server listening on http://${HOST}:${PORT}`);
    // eslint-disable-next-line no-console
    console.log(`Demonstration mode active. Storage: ${STORAGE_NOTICE}`);
  });
}
