/**
 * Exact trace test: POST /api/reports submission flow
 * Verifies every field read by app.js lines 608-617.
 *
 * Also contains a regression test for the confirmed initial-state bug:
 * #reportSuccessBox was visible on page load because .callout-success{display:flex}
 * in the author stylesheet overrides the UA [hidden]{display:none} rule.
 * Fix: add [hidden]{display:none !important} to styles.css.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../server.js";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "..");

function makeReq(method, url, body) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { host: "localhost" };
  if (body) {
    req.headers["content-type"] = "application/json";
    const raw = JSON.stringify(body);
    req.headers["content-length"] = Buffer.byteLength(raw);
    req._body = raw;
  }
  return req;
}

function makeRes() {
  const res = new EventEmitter();
  res.headers = {};
  res.statusCode = null;
  res.chunks = [];
  res.writeHead = (code, hdrs = {}) => { res.statusCode = code; Object.assign(res.headers, hdrs); };
  res.end = (chunk) => { if (chunk) res.chunks.push(chunk); res.body = Buffer.concat(res.chunks.map(c => Buffer.isBuffer(c) ? c : Buffer.from(c))); res.emit("finish"); };
  res.write = (chunk) => res.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return res;
}

async function apiCall(server, method, url, body) {
  return new Promise((resolve) => {
    const req = makeReq(method, url, body);
    const res = makeRes();
    res.once("finish", () => {
      let parsed; try { parsed = JSON.parse(res.body.toString("utf8")); } catch { parsed = {}; }
      resolve({ status: res.statusCode, body: parsed });
    });
    server.emit("request", req, res);
    if (req._body) req.emit("data", Buffer.from(req._body));
    req.emit("end");
  });
}

describe("Report submission flow — exact trace matching app.js", () => {
  let server;
  before(() => { server = createServer(); });

  describe("POST /api/reports — response structure app.js reads", () => {
    it("returns HTTP 201 (not 200)", async () => {
      const r = await apiCall(server, "POST", "/api/reports", {
        sector: "construction",
        type: "safety_hazard",
        description: "Trace test: scaffolding at grid-line C4 missing toe-boards.",
        reporterName: "Trace Tester",
        workerId: "w_c1"
      });
      assert.equal(r.status, 201, `Expected 201, got ${r.status}. Body: ${JSON.stringify(r.body)}`);
    });

    it("top-level response key is 'report' (not 'reports' or nested)", async () => {
      const r = await apiCall(server, "POST", "/api/reports", {
        sector: "construction",
        type: "safety_hazard",
        description: "Checking top-level key structure of POST response.",
        reporterName: "Trace Tester"
      });
      assert.ok(r.body.report !== undefined, `'report' key missing. Keys present: ${Object.keys(r.body).join(", ")}`);
      assert.equal(r.body.reports, undefined, "Must not have a 'reports' (plural) key — that's GET not POST");
    });

    it("report.referenceId is a non-empty string starting with FS-", async () => {
      const r = await apiCall(server, "POST", "/api/reports", {
        sector: "construction",
        type: "safety_hazard",
        description: "Checking referenceId field presence and format.",
        reporterName: "Trace Tester"
      });
      const refId = r.body?.report?.referenceId;
      assert.equal(typeof refId, "string", `referenceId type: ${typeof refId}, value: ${refId}`);
      assert.ok(refId.length > 0, "referenceId must not be empty string");
      assert.ok(refId.startsWith("FS-"), `referenceId must start with 'FS-', got: '${refId}'`);
    });

    it("safety_hazard type gets FS-SAFE prefix (not FS-GRIEV)", async () => {
      const r = await apiCall(server, "POST", "/api/reports", {
        sector: "construction",
        type: "safety_hazard",
        description: "Type-prefix routing test for safety hazard reports.",
        reporterName: "Trace Tester"
      });
      assert.ok(r.body.report.referenceId.startsWith("FS-SAFE"), `Got: ${r.body.report.referenceId}`);
    });

    it("non-safety types get FS-GRIEV prefix", async () => {
      for (const type of ["fatigue_exhaustion", "wage_discrepancy", "scheduling_bias", "other"]) {
        const r = await apiCall(server, "POST", "/api/reports", {
          sector: "college", type,
          description: "Type prefix test — must be at least 10 chars long.",
          reporterName: "Trace"
        });
        assert.ok(r.body.report.referenceId.startsWith("FS-GRIEV"),
          `Type '${type}' should get FS-GRIEV, got: ${r.body.report.referenceId}`);
      }
    });

    it("report.status is 'SUBMITTED' on creation", async () => {
      const r = await apiCall(server, "POST", "/api/reports", {
        sector: "construction", type: "safety_hazard",
        description: "Checking initial status value after creation.",
        reporterName: "Trace Tester"
      });
      assert.equal(r.body.report.status, "SUBMITTED");
    });

    it("report.statusHistory is a non-empty array with one entry", async () => {
      const r = await apiCall(server, "POST", "/api/reports", {
        sector: "construction", type: "safety_hazard",
        description: "Checking statusHistory array structure on first creation.",
        reporterName: "Trace Tester"
      });
      const hist = r.body.report.statusHistory;
      assert.ok(Array.isArray(hist), "statusHistory must be array");
      assert.ok(hist.length >= 1, "statusHistory must have at least 1 entry");
      assert.equal(hist[0].status, "SUBMITTED");
      assert.equal(typeof hist[0].timestamp, "string");
    });

    it("each new report gets a unique incrementing referenceId", async () => {
      const r1 = await apiCall(server, "POST", "/api/reports", {
        sector: "construction", type: "safety_hazard",
        description: "First report for uniqueness check — enough characters.",
        reporterName: "A"
      });
      const r2 = await apiCall(server, "POST", "/api/reports", {
        sector: "construction", type: "safety_hazard",
        description: "Second report for uniqueness check — enough characters.",
        reporterName: "B"
      });
      assert.notEqual(r1.body.report.referenceId, r2.body.report.referenceId,
        "Two successive reports must have different referenceIds");
    });
  });

  describe("POST /api/reports — validation errors return 400 (not fake success)", () => {
    it("description shorter than 10 chars returns 400", async () => {
      const r = await apiCall(server, "POST", "/api/reports", {
        sector: "construction", type: "safety_hazard", description: "short"
      });
      assert.equal(r.status, 400, `Expected 400, got ${r.status}`);
      assert.ok(r.body.error, "Error response must have 'error' field");
      assert.equal(r.body.report, undefined, "Error response must NOT have 'report' field");
    });

    it("invalid type returns 400", async () => {
      const r = await apiCall(server, "POST", "/api/reports", {
        sector: "construction", type: "invalid_type",
        description: "This is a valid long enough description."
      });
      assert.equal(r.status, 400);
    });

    it("invalid sector returns 400", async () => {
      const r = await apiCall(server, "POST", "/api/reports", {
        sector: "invalid_sector", type: "safety_hazard",
        description: "This is a valid long enough description."
      });
      assert.equal(r.status, 400);
    });

    it("empty body returns 400 — sector is required and cannot default", async () => {
      const r = await apiCall(server, "POST", "/api/reports", {});
      // sector is mandatory; server must reject with 400, never silently succeed
      assert.equal(r.status, 400, `Expected 400 for missing sector, got ${r.status}`);
      assert.ok(r.body.error, "Error response must have an 'error' field");
      assert.equal(r.body.report, undefined, "Error response must NOT contain a 'report' key");
    });
  });

  describe("GET /api/reports?refId — Track Report by ID flow (app.js handleTrackReport)", () => {
    it("FS-SAFE-0001 returns 200 with .reports[0].referenceId === 'FS-SAFE-0001'", async () => {
      const r = await apiCall(server, "GET", "/api/reports?refId=FS-SAFE-0001");
      assert.equal(r.status, 200);
      // app.js line 618: const report = res.reports ? res.reports[0] : null;
      assert.ok(Array.isArray(r.body.reports), "response.reports must be array for handleTrackReport");
      assert.equal(r.body.reports.length, 1);
      assert.equal(r.body.reports[0].referenceId, "FS-SAFE-0001");
    });

    it("FS-GRIEV-0001 returns 200 in college sector", async () => {
      const r = await apiCall(server, "GET", "/api/reports?refId=FS-GRIEV-0001");
      assert.equal(r.status, 200);
      assert.equal(r.body.reports[0].referenceId, "FS-GRIEV-0001");
      assert.equal(r.body.reports[0].sector, "college");
    });

    it("newly submitted report is retrievable by its referenceId", async () => {
      const submit = await apiCall(server, "POST", "/api/reports", {
        sector: "construction", type: "safety_hazard",
        description: "Round-trip test: submit then retrieve by referenceId.",
        reporterName: "RoundTrip Tester"
      });
      const refId = submit.body.report.referenceId;
      assert.ok(refId, "Must have referenceId after submit");

      const track = await apiCall(server, "GET", `/api/reports?refId=${refId}`);
      assert.equal(track.status, 200, `Track by new refId ${refId} returned ${track.status}`);
      assert.equal(track.body.reports[0].referenceId, refId);
      assert.equal(track.body.reports[0].status, "SUBMITTED");
      assert.ok(Array.isArray(track.body.reports[0].statusHistory));
    });

    it("unknown refId returns 404 (not 200 with empty data)", async () => {
      const r = await apiCall(server, "GET", "/api/reports?refId=FS-FAKE-9999");
      assert.equal(r.status, 404);
    });
  });

  describe("PATCH /api/reports/:id/status — status transition", () => {
    it("valid SUBMITTED → UNDER_REVIEW transition returns updated report", async () => {
      const submit = await apiCall(server, "POST", "/api/reports", {
        sector: "construction", type: "wage_discrepancy",
        description: "Transition test: valid SUBMITTED to UNDER_REVIEW progression.",
        reporterName: "Transition Tester"
      });
      const refId = submit.body.report.referenceId;

      const patch = await apiCall(server, "PATCH", `/api/reports/${refId}/status`, {
        status: "UNDER_REVIEW",
        actor: "Test Supervisor",
        note: "Regression test transition"
      });
      assert.equal(patch.status, 200);
      assert.equal(patch.body.report.status, "UNDER_REVIEW");
      assert.equal(patch.body.report.referenceId, refId);
      assert.equal(patch.body.report.statusHistory.length, 2);
    });
  });
});

// ---------------------------------------------------------------------------
// Regression: initial-state visibility bug (CSS specificity overriding [hidden])
// ---------------------------------------------------------------------------
// Root cause: .callout-success { display: flex } in the author stylesheet wins
// over the browser UA's [hidden] { display: none } because author styles always
// beat UA styles in the cascade regardless of specificity or source order.
// The element was therefore visible on first page load, showing "Report
// Successfully Filed!" with the placeholder `--` reference ID.
//
// Fix: [hidden] { display: none !important } added to styles.css so the hidden
// attribute always wins over any author display value.
// ---------------------------------------------------------------------------
describe("Regression: #reportSuccessBox initial-state visibility (CSS specificity bug)", () => {

  it("HTML: #reportSuccessBox has the 'hidden' attribute in initial markup", () => {
    const html = readFileSync(resolve(ROOT, "public/index.html"), "utf8");
    // Locate the reportSuccessBox element
    const boxMatch = html.match(/<div[^>]*id="reportSuccessBox"[^>]*>/);
    assert.ok(boxMatch, "#reportSuccessBox element not found in index.html");
    assert.ok(
      boxMatch[0].includes(" hidden"),
      `#reportSuccessBox opening tag must carry the hidden attribute.\nFound: ${boxMatch[0]}`
    );
  });

  it("CSS: .callout-success sets display:flex (which would override [hidden] without a normalization rule)", () => {
    const css = readFileSync(resolve(ROOT, "public/styles.css"), "utf8");
    // Verify the problem case still exists so we know the fix is still needed
    assert.ok(
      /\.callout-success\s*\{[^}]*display\s*:\s*flex/s.test(css),
      ".callout-success must still set display:flex — if it no longer does, this regression test can be removed"
    );
  });

  it("CSS: [hidden] normalization rule exists and uses !important to override author display values", () => {
    const css = readFileSync(resolve(ROOT, "public/styles.css"), "utf8");
    // Must have [hidden] { display: none !important }
    const hasRule = /\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/s.test(css);
    assert.ok(
      hasRule,
      "styles.css must contain [hidden] { display: none !important } to prevent " +
      "author-stylesheet display rules (e.g. .callout-success { display:flex }) " +
      "from overriding the hidden attribute and showing elements on page load."
    );
  });

  it("CSS: [hidden] rule appears before component rules (must not be after .callout-success)", () => {
    const css = readFileSync(resolve(ROOT, "public/styles.css"), "utf8");
    const hiddenPos = css.search(/\[hidden\]\s*\{/);
    const calloutPos = css.search(/\.callout-success\s*\{/);
    assert.ok(hiddenPos !== -1, "[hidden] rule not found in styles.css");
    assert.ok(calloutPos !== -1, ".callout-success rule not found in styles.css");
    // Position in file does not matter when !important is used, but early placement
    // is a convention signal; only the !important test above is load-bearing.
    // This test documents intent without being brittle about exact line numbers.
    assert.ok(
      hiddenPos < calloutPos,
      `[hidden] rule (pos ${hiddenPos}) should appear before .callout-success (pos ${calloutPos}) as a style-guide convention`
    );
  });

  it("app.js: reportSuccessBox is toggled only via .hidden (not style.display), so CSS [hidden] rule controls visibility", () => {
    const js = readFileSync(resolve(ROOT, "public/app.js"), "utf8");
    // Count assignments to reportSuccessBox.hidden
    const hiddenAssignments = (js.match(/reportSuccessBox\.hidden\s*=/g) || []).length;
    assert.ok(hiddenAssignments >= 2,
      `Expected at least 2 .hidden assignments (hide before submit, show on success). Found: ${hiddenAssignments}`);
    // Must NOT directly manipulate style.display on this element
    assert.ok(
      !js.includes("reportSuccessBox.style.display"),
      "reportSuccessBox must not be shown/hidden via style.display — use .hidden so the CSS rule controls it"
    );
  });
});

