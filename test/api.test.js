import test, { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createServer } from "../server.js";
import { createStore } from "../lib/store.js";

describe("FairShift REST API Integration Tests", () => {
  let server;
  let store;

  before(() => {
    store = createStore();
    server = createServer(store);
  });

  function request(path, options = {}) {
    return new Promise((resolve, reject) => {
      const method = (options.method || "GET").toUpperCase();
      const rawHeaders = { ...(options.headers || {}) };
      let bodyData = options.body;

      let payloadBuffer = null;
      if (bodyData !== undefined && bodyData !== null) {
        if (typeof bodyData === "object" && !Buffer.isBuffer(bodyData)) {
          payloadBuffer = Buffer.from(JSON.stringify(bodyData), "utf8");
          if (!rawHeaders["content-type"] && !rawHeaders["Content-Type"]) {
            rawHeaders["content-type"] = "application/json";
          }
        } else if (typeof bodyData === "string") {
          payloadBuffer = Buffer.from(bodyData, "utf8");
        } else if (Buffer.isBuffer(bodyData)) {
          payloadBuffer = bodyData;
        }
      }

      // Create an in-memory stream for req
      const req = new Readable({
        read() {
          if (payloadBuffer) {
            this.push(payloadBuffer);
            payloadBuffer = null;
          }
          this.push(null);
        }
      });

      req.method = method;
      req.url = path;
      req.headers = {};
      for (const [k, v] of Object.entries(rawHeaders)) {
        req.headers[k.toLowerCase()] = v;
      }
      req.headers.host = "localhost";

      const resHeaders = {};
      let statusCode = 200;
      const chunks = [];

      const res = {
        writeHead(code, headers) {
          statusCode = code;
          if (headers) {
            for (const [hk, hv] of Object.entries(headers)) {
              resHeaders[hk.toLowerCase()] = hv;
            }
          }
        },
        setHeader(name, val) {
          resHeaders[name.toLowerCase()] = val;
        },
        getHeader(name) {
          return resHeaders[name.toLowerCase()];
        },
        write(chunk) {
          if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        },
        end(chunk) {
          if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          const text = Buffer.concat(chunks).toString("utf8");
          let data;
          try {
            data = JSON.parse(text);
          } catch {
            data = text;
          }
          resolve({
            status: statusCode,
            headers: {
              get(name) {
                return resHeaders[name.toLowerCase()];
              }
            },
            data
          });
        }
      };

      server.emit("request", req, res);
    });
  }

  describe("Security Headers & HTTP Protocols", () => {
    it("attaches all required security headers to responses", async () => {
      const res = await request("/api/health");
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      assert.equal(res.headers.get("x-frame-options"), "DENY");
      assert.equal(res.headers.get("referrer-policy"), "no-referrer");
      assert.equal(res.headers.get("content-security-policy"), "default-src 'self'");
    });

    it("returns 404 with safe JSON message for unknown routes", async () => {
      const res = await request("/api/unknown-endpoint");
      assert.equal(res.status, 404);
      assert.equal(res.data.error, "Endpoint not found");
    });

    it("returns 405 Method Not Allowed when method is incorrect", async () => {
      const res = await request("/api/health", { method: "POST" });
      assert.equal(res.status, 405);
      assert.equal(res.data.error, "Method Not Allowed");
    });

    it("rejects non-JSON content-type with 415 on POST requests", async () => {
      const res = await request("/api/shifts", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "plain text body"
      });
      assert.equal(res.status, 415);
      assert.match(res.data.error, /Unsupported Media Type/);
    });

    it("rejects malformed JSON syntax with 400 Bad Request", async () => {
      const res = await request("/api/shifts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ malformed json"
      });
      assert.equal(res.status, 400);
      assert.match(res.data.error, /Malformed JSON payload/);
    });

    it("rejects payloads exceeding 64 KB limit with 413 Payload Too Large", async () => {
      const bigDescription = "A".repeat(66 * 1024);
      const res = await request("/api/shifts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: {
          sector: "construction",
          title: "Massive Payload Shift",
          description: bigDescription,
          startTime: "2026-10-30T08:00:00Z",
          endTime: "2026-10-30T16:00:00Z",
          hourlyRate: 300
        }
      });
      assert.equal(res.status, 413);
      assert.match(res.data.error, /Payload Too Large/);
    });
  });

  describe("GET /api/health", () => {
    it("returns health status and explicit in-memory storage notice", async () => {
      const res = await request("/api/health");
      assert.equal(res.status, 200);
      assert.equal(res.data.status, "ok");
      assert.equal(res.data.service, "fairshift-api");
      assert.match(res.data.storageNotice, /In-memory demonstration store/);
      assert.match(res.data.disclaimer, /demonstration and testing purposes only/);
    });
  });

  describe("GET /api/config", () => {
    it("returns sector configs, active sector, and demo disclaimers", async () => {
      const res = await request("/api/config?sector=college");
      assert.equal(res.status, 200);
      assert.equal(res.data.activeSector, "college");
      assert.equal(res.data.config.minRestHoursDemoAssumption, 8);
      assert.equal(res.data.config.maxWeeklyHoursDemoAssumption, 20);
      assert.match(res.data.config.disclaimer, /demonstration and testing purposes only/);
    });
  });

  describe("GET & POST /api/shifts", () => {
    it("returns seeded demonstration shifts filtered by sector", async () => {
      const res = await request("/api/shifts?sector=construction");
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.data.shifts));
      assert.ok(res.data.shifts.length > 0);
      assert.equal(res.data.sector, "construction");

      // Verify shift duration and pay calculation is attached
      const first = res.data.shifts[0];
      assert.ok(first.durationHours > 0);
      assert.ok(first.grossPayEstimate > 0);
    });

    it("evaluates worker eligibility when workerId is provided in query params", async () => {
      const res = await request("/api/shifts?sector=construction&workerId=w_c1");
      assert.equal(res.status, 200);
      const shift = res.data.shifts.find(s => s.id === "s_c1");
      assert.ok(shift);
      assert.equal(shift.isAssigned, true);
      assert.ok(shift.eligibility);
    });

    it("creates a new valid shift and returns 201 Created", async () => {
      const newShiftPayload = {
        sector: "construction",
        title: "Perimeter Lighting Rigging",
        description: "Mount LED flood lights on tower scaffolding poles.",
        startTime: "2026-10-31T10:00:00Z",
        endTime: "2026-10-31T18:00:00Z",
        hourlyRate: 340,
        capacity: 2,
        requiredRole: "Electrician",
        requiredCertifications: ["Electrical Safety"]
      };

      const res = await request("/api/shifts", {
        method: "POST",
        body: newShiftPayload
      });

      assert.equal(res.status, 201);
      assert.ok(res.data.shift.id);
      assert.equal(res.data.shift.title, "Perimeter Lighting Rigging");
      assert.equal(res.data.shift.capacity, 2);
    });

    it("rejects invalid shift creation payloads with 400 Bad Request", async () => {
      // Missing title
      const res1 = await request("/api/shifts", {
        method: "POST",
        body: {
          sector: "construction",
          startTime: "2026-10-31T10:00:00Z",
          endTime: "2026-10-31T18:00:00Z",
          hourlyRate: 300
        }
      });
      assert.equal(res1.status, 400);

      // End time before start time
      const res2 = await request("/api/shifts", {
        method: "POST",
        body: {
          sector: "construction",
          title: "Inverted Shift",
          startTime: "2026-10-31T18:00:00Z",
          endTime: "2026-10-31T10:00:00Z",
          hourlyRate: 300
        }
      });
      assert.equal(res2.status, 400);

      // Negative hourly rate
      const res3 = await request("/api/shifts", {
        method: "POST",
        body: {
          sector: "construction",
          title: "Negative Rate Shift",
          startTime: "2026-10-31T10:00:00Z",
          endTime: "2026-10-31T18:00:00Z",
          hourlyRate: -100
        }
      });
      assert.equal(res3.status, 400);
    });
  });

  describe("POST /api/shifts/:id/claim", () => {
    it("successfully claims an eligible open shift", async () => {
      // w_c3 (Deepak Verma - Electrician) claims s_c3 (Site Electrical Rough-in)
      const res = await request("/api/shifts/s_c3/claim", {
        method: "POST",
        body: { workerId: "w_c3" }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.claimed, true);
      assert.equal(res.data.workerId, "w_c3");
    });

    it("rejects claim with 409 Conflict when worker lacks required role", async () => {
      // w_u3 (Campus Dining Staff) tries to claim s_u2 (CS Lab - requires Computer Lab Assistant)
      const res = await request("/api/shifts/s_u2/claim", {
        method: "POST",
        body: { workerId: "w_u3" }
      });
      assert.equal(res.status, 409);
      assert.match(res.data.error, /Missing required role/);
    });

    it("rejects claim with 409 Conflict when worker has direct time conflict", async () => {
      // Create two overlapping shifts
      const shift1 = store.createShift({
        sector: "college",
        title: "Turing Lab Morning Session",
        startTime: "2026-11-01T09:00:00Z",
        endTime: "2026-11-01T13:00:00Z",
        hourlyRate: 180,
        requiredRole: "Computer Lab Assistant"
      });

      const shift2 = store.createShift({
        sector: "college",
        title: "CS Helpdesk Midday",
        startTime: "2026-11-01T11:00:00Z", // Overlaps 11:00-13:00
        endTime: "2026-11-01T15:00:00Z",
        hourlyRate: 180,
        requiredRole: "Computer Lab Assistant"
      });

      // Claim shift 1
      const claim1 = await request(`/api/shifts/${shift1.id}/claim`, {
        method: "POST",
        body: { workerId: "w_u2" }
      });
      assert.equal(claim1.status, 200);

      // Attempt to claim overlapping shift 2 -> should return 409 Conflict
      const claim2 = await request(`/api/shifts/${shift2.id}/claim`, {
        method: "POST",
        body: { workerId: "w_u2" }
      });
      assert.equal(claim2.status, 409);
      assert.match(claim2.data.error, /Time conflict/);
    });

    it("returns 404 when claiming a non-existent shift or with non-existent worker", async () => {
      const res1 = await request("/api/shifts/s_non_existent/claim", {
        method: "POST",
        body: { workerId: "w_c1" }
      });
      assert.equal(res1.status, 404);

      const res2 = await request("/api/shifts/s_c1/claim", {
        method: "POST",
        body: { workerId: "w_non_existent" }
      });
      assert.equal(res2.status, 404);
    });
  });

  describe("Safety & Grievance Reporting Endpoints", () => {
    it("GET /api/reports sanitizes public listings without exposing reporter private details", async () => {
      const res = await request("/api/reports?sector=construction");
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.data.reports));
      assert.ok(res.data.reports.length > 0);

      const report = res.data.reports[0];
      assert.ok(report.referenceId);
      assert.ok(report.status);
      assert.ok(report.descriptionPreview);

      // Ensure private reporter details are omitted from public listing
      assert.equal(report.reporterName, undefined);
      assert.equal(report.workerId, undefined);
    });

    it("GET /api/reports?refId=... returns full report details and audit history for exact ID", async () => {
      const res = await request("/api/reports?refId=FS-SAFE-0001");
      assert.equal(res.status, 200);
      assert.equal(res.data.reports.length, 1);
      const report = res.data.reports[0];
      assert.equal(report.referenceId, "FS-SAFE-0001");
      assert.ok(Array.isArray(report.statusHistory));
      assert.ok(report.statusHistory.length >= 2);
    });

    it("GET /api/reports?refId=FS-UNKNOWN returns 404", async () => {
      const res = await request("/api/reports?refId=FS-UNKNOWN-9999");
      assert.equal(res.status, 404);
    });

    it("POST /api/reports creates report and returns trackable reference ID", async () => {
      const newReport = {
        sector: "college",
        type: "fatigue_exhaustion",
        description: "Back-to-back night closing and morning open shifts scheduled during exams.",
        reporterName: "Student Assistant"
      };

      const res = await request("/api/reports", {
        method: "POST",
        body: newReport
      });

      assert.equal(res.status, 201);
      assert.ok(res.data.report.referenceId.startsWith("FS-GRIEV-"));
      assert.equal(res.data.report.status, "SUBMITTED");
    });

    it("PATCH /api/reports/:id/status transitions status and appends to audit history", async () => {
      // First create a report
      const createRes = await request("/api/reports", {
        method: "POST",
        body: {
          sector: "construction",
          type: "safety_hazard",
          description: "Broken rungs on steel ladder accessing excavation pit 4.",
          reporterName: "Site Worker"
        }
      });
      const refId = createRes.data.report.referenceId;

      // Transition to UNDER_REVIEW
      const patchRes = await request(`/api/reports/${refId}/status`, {
        method: "PATCH",
        body: {
          status: "UNDER_REVIEW",
          actor: "Safety Inspector Dave",
          note: "Flagged pit 4 ladder as out of service."
        }
      });
      assert.equal(patchRes.status, 200);
      assert.equal(patchRes.data.report.status, "UNDER_REVIEW");
      assert.equal(patchRes.data.report.statusHistory.length, 2);

      // Illegal transition jump (UNDER_REVIEW cannot jump back to SUBMITTED)
      const illegalRes = await request(`/api/reports/${refId}/status`, {
        method: "PATCH",
        body: { status: "SUBMITTED" }
      });
      assert.equal(illegalRes.status, 400);
      assert.match(illegalRes.data.error, /Illegal status transition/);
    });
  });

  describe("GET /api/admin/metrics", () => {
    it("returns explainable fairness and fatigue indicators with disclaimers", async () => {
      const res = await request("/api/admin/metrics?sector=construction");
      assert.equal(res.status, 200);
      assert.ok(res.data.metrics);
      assert.equal(typeof res.data.metrics.equityScore, "number");
      assert.ok(Array.isArray(res.data.metrics.fatigueAlerts));
      assert.match(res.data.metrics.disclaimer, /demonstration and testing purposes only/);
      assert.match(res.data.metrics.storageNotice, /In-memory demonstration store/);
    });
  });

  describe("GET /api/workers", () => {
    it("returns workers for the specified sector with earnings summaries", async () => {
      const res = await request("/api/workers?sector=construction");
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.data.workers));
      assert.ok(res.data.workers.length >= 4);

      const firstWorker = res.data.workers[0];
      assert.ok(firstWorker.id);
      assert.ok(firstWorker.name);
      assert.ok(firstWorker.summary);
      assert.equal(typeof firstWorker.summary.totalHours, "number");
    });
  });

  describe("Static Frontend Assets & Security", () => {
    it("serves index.html at root with text/html and CSP headers", async () => {
      const res = await request("/");
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type"), /text\/html/);
      assert.match(res.data, /FairShift/);
      assert.match(res.headers.get("content-security-policy"), /default-src 'self'/);
    });

    it("serves styles.css with text/css content type", async () => {
      const res = await request("/styles.css");
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type"), /text\/css/);
      assert.match(res.data, /--bg-app/);
    });

    it("serves app.js with application/javascript content type", async () => {
      const res = await request("/app.js");
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type"), /application\/javascript/);
      assert.match(res.data, /FairShift/);
    });

    it("blocks directory traversal attempts safely with 403 or 404", async () => {
      const res = await request("/../../../package.json");
      assert.ok(res.status === 403 || res.status === 404);
    });
  });

  describe("Input Validation — Sector Allowlist", () => {
    it("rejects invalid sector on GET /api/workers with 400", async () => {
      const res = await request("/api/workers?sector=INJECTED");
      assert.equal(res.status, 400);
      assert.match(res.data.error, /Invalid sector/);
    });

    it("rejects invalid sector on GET /api/shifts with 400", async () => {
      const res = await request("/api/shifts?sector=<script>alert(1)</script>");
      assert.equal(res.status, 400);
      assert.match(res.data.error, /Invalid sector/);
    });

    it("rejects invalid sector on GET /api/reports with 400", async () => {
      const res = await request("/api/reports?sector=unknown_sector");
      assert.equal(res.status, 400);
      assert.match(res.data.error, /Invalid sector/);
    });

    it("rejects invalid sector on GET /api/config with 400", async () => {
      const res = await request("/api/config?sector=hacker");
      assert.equal(res.status, 400);
      assert.match(res.data.error, /Invalid sector/);
    });

    it("rejects invalid sector on GET /api/admin/metrics with 400", async () => {
      const res = await request("/api/admin/metrics?sector=DROP TABLE");
      assert.equal(res.status, 400);
      assert.match(res.data.error, /Invalid sector/);
    });

    it("accepts valid sector 'construction' on all GET endpoints", async () => {
      const endpoints = [
        "/api/workers?sector=construction",
        "/api/shifts?sector=construction",
        "/api/reports?sector=construction",
        "/api/config?sector=construction",
        "/api/admin/metrics?sector=construction"
      ];
      for (const ep of endpoints) {
        const res = await request(ep);
        assert.equal(res.status, 200, `Expected 200 for ${ep}, got ${res.status}`);
      }
    });

    it("accepts valid sector 'college' on all GET endpoints", async () => {
      const endpoints = [
        "/api/workers?sector=college",
        "/api/shifts?sector=college",
        "/api/reports?sector=college",
        "/api/config?sector=college",
        "/api/admin/metrics?sector=college"
      ];
      for (const ep of endpoints) {
        const res = await request(ep);
        assert.equal(res.status, 200, `Expected 200 for ${ep}, got ${res.status}`);
      }
    });
  });
});

