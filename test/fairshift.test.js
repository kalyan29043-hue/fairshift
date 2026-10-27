import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONFIGS,
  REPORT_STATUSES,
  ValueError,
  parseTimestamp,
  calculateDurationHours,
  doIntervalsOverlap,
  calculateRestHours,
  calculateShiftEarnings,
  evaluateShiftEligibility,
  calculateWorkerSummary,
  createSafetyOrGrievanceReport,
  transitionReportStatus,
  calculateFairnessAndFatigueMetrics
} from "../lib/fairshift.js";

describe("FairShift Unit Tests", () => {

  describe("Time & Interval Utilities", () => {
    it("calculates exact and fractional duration in hours", () => {
      const dur1 = calculateDurationHours("2026-10-27T08:00:00Z", "2026-10-27T16:00:00Z");
      assert.equal(dur1, 8.0);

      const dur2 = calculateDurationHours("2026-10-27T09:00:00Z", "2026-10-27T13:30:00Z");
      assert.equal(dur2, 4.5);
    });

    it("throws ValueError when endTime is not strictly after startTime", () => {
      assert.throws(
        () => calculateDurationHours("2026-10-27T10:00:00Z", "2026-10-27T10:00:00Z"),
        ValueError
      );
      assert.throws(
        () => calculateDurationHours("2026-10-27T12:00:00Z", "2026-10-27T10:00:00Z"),
        ValueError
      );
    });

    it("throws TypeError or ValueError on invalid date strings or null inputs", () => {
      assert.throws(() => calculateDurationHours(null, "2026-10-27T10:00:00Z"), TypeError);
      assert.throws(() => calculateDurationHours("invalid-date", "2026-10-27T10:00:00Z"), ValueError);
    });

    it("strictly validates timestamp types rejecting booleans and invalid objects", () => {
      assert.throws(() => parseTimestamp(true, "startTime"), ValueError);
      assert.throws(() => parseTimestamp(false, "startTime"), ValueError);
      assert.throws(() => parseTimestamp({}, "startTime"), ValueError);
      assert.throws(() => parseTimestamp([], "startTime"), ValueError);
      assert.throws(() => parseTimestamp("", "startTime"), TypeError);

      // Valid string and Date object
      assert.equal(typeof parseTimestamp("2026-10-27T08:00:00Z"), "number");
      assert.equal(typeof parseTimestamp(new Date("2026-10-27T08:00:00Z")), "number");
    });

    it("detects interval overlaps accurately with boundary checks", () => {
      // Overlapping: 08:00-14:00 and 12:00-18:00
      assert.equal(
        doIntervalsOverlap(
          "2026-10-27T08:00:00Z", "2026-10-27T14:00:00Z",
          "2026-10-27T12:00:00Z", "2026-10-27T18:00:00Z"
        ),
        true
      );

      // Touching boundary: 08:00-12:00 and 12:00-16:00 (do NOT overlap)
      assert.equal(
        doIntervalsOverlap(
          "2026-10-27T08:00:00Z", "2026-10-27T12:00:00Z",
          "2026-10-27T12:00:00Z", "2026-10-27T16:00:00Z"
        ),
        false
      );

      // Completely separate intervals
      assert.equal(
        doIntervalsOverlap(
          "2026-10-27T08:00:00Z", "2026-10-27T12:00:00Z",
          "2026-10-27T14:00:00Z", "2026-10-27T18:00:00Z"
        ),
        false
      );
    });

    it("calculates rest gap between non-overlapping intervals and returns null on overlap", () => {
      // 2 hours rest: 12:00 to 14:00
      const rest = calculateRestHours(
        "2026-10-27T08:00:00Z", "2026-10-27T12:00:00Z",
        "2026-10-27T14:00:00Z", "2026-10-27T18:00:00Z"
      );
      assert.equal(rest, 2.0);

      // Order independence (shift B comes before shift A)
      const restReversed = calculateRestHours(
        "2026-10-27T14:00:00Z", "2026-10-27T18:00:00Z",
        "2026-10-27T08:00:00Z", "2026-10-27T12:00:00Z"
      );
      assert.equal(restReversed, 2.0);

      // Back-to-back shifts (0 hours rest)
      const zeroRest = calculateRestHours(
        "2026-10-27T08:00:00Z", "2026-10-27T12:00:00Z",
        "2026-10-27T12:00:00Z", "2026-10-27T16:00:00Z"
      );
      assert.equal(zeroRest, 0.0);

      // Overlap returns null
      const overlapRest = calculateRestHours(
        "2026-10-27T08:00:00Z", "2026-10-27T14:00:00Z",
        "2026-10-27T12:00:00Z", "2026-10-27T18:00:00Z"
      );
      assert.equal(overlapRest, null);
    });
  });

  describe("Shift Earnings & Pay Calculations", () => {
    it("computes duration and gross pay for standard rates", () => {
      const shift = {
        startTime: "2026-10-27T09:00:00Z",
        endTime: "2026-10-27T17:00:00Z",
        hourlyRate: 350
      };
      const result = calculateShiftEarnings(shift);
      assert.equal(result.hours, 8.0);
      assert.equal(result.hourlyRate, 350);
      assert.equal(result.grossPay, 2800);
    });

    it("handles zero hourly rate cleanly and rejects null, empty, non-finite or negative rates", () => {
      const freeShift = {
        startTime: "2026-10-27T10:00:00Z",
        endTime: "2026-10-27T12:00:00Z",
        hourlyRate: 0
      };
      assert.equal(calculateShiftEarnings(freeShift).grossPay, 0);

      const stringZeroShift = {
        startTime: "2026-10-27T10:00:00Z",
        endTime: "2026-10-27T12:00:00Z",
        hourlyRate: "0"
      };
      assert.equal(calculateShiftEarnings(stringZeroShift).grossPay, 0);

      const base = {
        startTime: "2026-10-27T10:00:00Z",
        endTime: "2026-10-27T12:00:00Z"
      };

      // Falsy or non-numeric invalid inputs must throw ValueError
      assert.throws(() => calculateShiftEarnings({ ...base, hourlyRate: null }), ValueError);
      assert.throws(() => calculateShiftEarnings({ ...base, hourlyRate: "" }), ValueError);
      assert.throws(() => calculateShiftEarnings({ ...base, hourlyRate: true }), ValueError);
      assert.throws(() => calculateShiftEarnings({ ...base, hourlyRate: false }), ValueError);
      assert.throws(() => calculateShiftEarnings({ ...base, hourlyRate: -50 }), ValueError);
      assert.throws(() => calculateShiftEarnings({ ...base, hourlyRate: Infinity }), ValueError);
      assert.throws(() => calculateShiftEarnings({ ...base, hourlyRate: NaN }), ValueError);
    });

    it("aggregates worker summary across multiple assigned shifts", () => {
      const shifts = [
        {
          id: "s1",
          startTime: "2026-10-26T08:00:00Z",
          endTime: "2026-10-26T12:00:00Z",
          hourlyRate: 200,
          assignedWorkerIds: ["w101"]
        },
        {
          id: "s2",
          startTime: "2026-10-27T08:00:00Z",
          endTime: "2026-10-27T14:00:00Z",
          hourlyRate: 250,
          assignedWorkerIds: ["w101", "w102"]
        },
        {
          id: "s3",
          startTime: "2026-10-28T08:00:00Z",
          endTime: "2026-10-28T12:00:00Z",
          hourlyRate: 300,
          assignedWorkerIds: ["w102"] // Not w101
        }
      ];

      const summary = calculateWorkerSummary("w101", shifts, DEFAULT_CONFIGS.construction);
      assert.equal(summary.assignedShiftCount, 2);
      assert.equal(summary.totalHours, 10.0); // 4h + 6h
      assert.equal(summary.totalGrossPay, 2300); // (4 * 200) + (6 * 250) = 800 + 1500 = 2300
      assert.equal(summary.currencySymbol, "₹");
    });
  });

  describe("Shift Eligibility & Conflict Evaluation", () => {
    const qualifiedWorker = {
      id: "w1",
      name: "Aarav Sharma",
      roles: ["Scaffolder"],
      certifications: ["OSHA-10", "Scaffolding Safety"]
    };

    const targetShift = {
      id: "shift-10",
      sector: "construction",
      title: "Tower B Scaffolding",
      startTime: "2026-10-27T08:00:00Z",
      endTime: "2026-10-27T16:00:00Z",
      hourlyRate: 300,
      capacity: 2,
      assignedWorkerIds: [],
      requiredRole: "Scaffolder",
      requiredCertifications: ["Scaffolding Safety"]
    };

    it("grants eligibility when worker satisfies role, certs, and has no conflicts", () => {
      const evaluation = evaluateShiftEligibility(qualifiedWorker, targetShift, []);
      assert.equal(evaluation.eligible, true);
      assert.equal(evaluation.blockers.length, 0);
      assert.equal(evaluation.conflicts.length, 0);
    });

    it("blocks eligibility when required role is missing", () => {
      const wrongRoleWorker = { ...qualifiedWorker, roles: ["Painter"] };
      const evaluation = evaluateShiftEligibility(wrongRoleWorker, targetShift, []);
      assert.equal(evaluation.eligible, false);
      assert.match(evaluation.blockers[0], /Missing required role/);
    });

    it("blocks eligibility when required certification is missing", () => {
      const uncertifiedWorker = { ...qualifiedWorker, certifications: ["First Aid"] };
      const evaluation = evaluateShiftEligibility(uncertifiedWorker, targetShift, []);
      assert.equal(evaluation.eligible, false);
      assert.match(evaluation.blockers[0], /Missing required certification: Scaffolding Safety/);
    });

    it("blocks eligibility when shift capacity is filled or explicitly closed at 0", () => {
      const fullShift = { ...targetShift, capacity: 1, assignedWorkerIds: ["w99"] };
      const evaluation = evaluateShiftEligibility(qualifiedWorker, fullShift, []);
      assert.equal(evaluation.eligible, false);
      assert.match(evaluation.blockers[0], /Shift capacity reached/);

      // Explicit capacity of 0 must not coerce to 1; shift must be marked closed
      const closedShift = { ...targetShift, capacity: 0, assignedWorkerIds: [] };
      const closedEval = evaluateShiftEligibility(qualifiedWorker, closedShift, []);
      assert.equal(closedEval.eligible, false);
      assert.equal(closedEval.blockers[0], "Shift is closed (capacity is 0).");
    });

    it("rejects invalid shift capacity types or negative values", () => {
      assert.throws(() => evaluateShiftEligibility(qualifiedWorker, { ...targetShift, capacity: -1 }, []), ValueError);
      assert.throws(() => evaluateShiftEligibility(qualifiedWorker, { ...targetShift, capacity: 1.5 }, []), ValueError);
      assert.throws(() => evaluateShiftEligibility(qualifiedWorker, { ...targetShift, capacity: "two" }, []), ValueError);
    });

    it("blocks eligibility and records conflict details on time overlap", () => {
      const existingShifts = [
        {
          id: "shift-prior",
          title: "Morning Inspection",
          startTime: "2026-10-27T12:00:00Z",
          endTime: "2026-10-27T18:00:00Z" // Overlaps with 08:00-16:00
        }
      ];
      const evaluation = evaluateShiftEligibility(qualifiedWorker, targetShift, existingShifts);
      assert.equal(evaluation.eligible, false);
      assert.equal(evaluation.conflicts.length, 1);
      assert.equal(evaluation.conflicts[0].shiftId, "shift-prior");
      assert.match(evaluation.blockers[0], /Time conflict/);
    });

    it("emits advisory warning when rest gap is below configurable demonstration assumption", () => {
      // Prior shift ends at 02:00Z on same day; target starts at 08:00Z (6 hours rest).
      // Construction demo assumption is 11 hours.
      const existingShifts = [
        {
          id: "shift-night",
          title: "Site Guard Night",
          startTime: "2026-10-26T18:00:00Z",
          endTime: "2026-10-27T02:00:00Z"
        }
      ];
      const evaluation = evaluateShiftEligibility(qualifiedWorker, targetShift, existingShifts, { sector: "construction" });
      // Non-overlapping, so eligible to claim, but advisory warning is attached
      assert.equal(evaluation.eligible, true);
      assert.equal(evaluation.advisories.length, 1);
      assert.match(evaluation.advisories[0], /Rest interval advisory: 6h gap relative to adjacent shift "Site Guard Night"/);
      assert.match(evaluation.advisories[0], /demonstration assumption/);
      assert.equal(evaluation.minRestAdjacentShift?.title, "Site Guard Night");
    });

    it("emits advisory warning for college sector when exceeding 20h weekly demonstration assumption", () => {
      const collegeWorker = {
        id: "student-1",
        name: "Priya V.",
        roles: ["Library Proctor"]
      };

      const collegeShift = {
        id: "col-shift-3",
        sector: "college",
        title: "Library Evening Shift",
        startTime: "2026-10-28T16:00:00Z",
        endTime: "2026-10-28T21:00:00Z", // 5 hours
        hourlyRate: 150,
        requiredRole: "Library Proctor"
      };

      // Already has 18 hours in the same week
      const currentWeekShifts = [
        {
          id: "col-shift-1",
          startTime: "2026-10-26T09:00:00Z",
          endTime: "2026-10-26T18:00:00Z" // 9 hours
        },
        {
          id: "col-shift-2",
          startTime: "2026-10-27T09:00:00Z",
          endTime: "2026-10-27T18:00:00Z" // 9 hours (total 18h)
        }
      ];

      const evaluation = evaluateShiftEligibility(collegeWorker, collegeShift, currentWeekShifts, { sector: "college" });
      assert.equal(evaluation.eligible, true);
      assert.equal(evaluation.projectedWeeklyHours, 23.0); // 18 + 5 = 23h
      assert.equal(evaluation.advisories.length, 1);
      assert.match(evaluation.advisories[0], /Weekly hours advisory:.*exceeding the demonstration threshold of 20h/);
      assert.match(evaluation.advisories[0], /demonstration and testing purposes only/);
    });
  });

  describe("Safety & Grievance Report State Machine", () => {
    it("creates safety hazard report with FS-SAFE reference ID and initial status", () => {
      const report = createSafetyOrGrievanceReport({
        sector: "construction",
        type: "safety_hazard",
        description: "Missing toe-boards on 3rd floor scaffolding near crane zone.",
        reporterName: "Rajesh K."
      }, 42);

      assert.equal(report.referenceId, "FS-SAFE-0042");
      assert.equal(report.status, REPORT_STATUSES.SUBMITTED);
      assert.equal(report.statusHistory.length, 1);
      assert.equal(report.statusHistory[0].status, REPORT_STATUSES.SUBMITTED);
    });

    it("creates grievance report with FS-GRIEV prefix", () => {
      const report = createSafetyOrGrievanceReport({
        sector: "college",
        type: "scheduling_bias",
        description: "Weekend shifts repeatedly assigned to first-year student assistants.",
        reporterName: "Sneha M."
      }, 7);

      assert.equal(report.referenceId, "FS-GRIEV-0007");
      assert.equal(report.status, REPORT_STATUSES.SUBMITTED);
    });

    it("rejects invalid report types or descriptions shorter than 10 characters", () => {
      assert.throws(
        () => createSafetyOrGrievanceReport({
          sector: "construction",
          type: "illegal_type",
          description: "Adequate length description for test."
        }),
        ValueError
      );

      assert.throws(
        () => createSafetyOrGrievanceReport({
          sector: "construction",
          type: "safety_hazard",
          description: "Too short"
        }),
        ValueError
      );
    });

    it("progresses report through valid lifecycle transitions", () => {
      const report = createSafetyOrGrievanceReport({
        sector: "construction",
        type: "safety_hazard",
        description: "Wobbly ladder on Platform B needs replacement.",
        reporterName: "Worker A"
      }, 101);

      // Transition: SUBMITTED -> UNDER_REVIEW
      transitionReportStatus(report, REPORT_STATUSES.UNDER_REVIEW, {
        actor: "Safety Officer Patil",
        note: "Inspecting Platform B ladder."
      });
      assert.equal(report.status, REPORT_STATUSES.UNDER_REVIEW);
      assert.equal(report.statusHistory.length, 2);

      // Transition: UNDER_REVIEW -> ACTION_TAKEN
      transitionReportStatus(report, REPORT_STATUSES.ACTION_TAKEN, {
        actor: "Maintenance Lead",
        note: "Ladder replaced with industrial fiberglass unit."
      });
      assert.equal(report.status, REPORT_STATUSES.ACTION_TAKEN);
      assert.equal(report.statusHistory.length, 3);

      // Transition: ACTION_TAKEN -> RESOLVED
      transitionReportStatus(report, REPORT_STATUSES.RESOLVED, {
        actor: "Safety Officer Patil",
        note: "Verified replacement. Closed."
      });
      assert.equal(report.status, REPORT_STATUSES.RESOLVED);
      assert.equal(report.statusHistory.length, 4);
    });

    it("rejects illegal state machine jumps (e.g. SUBMITTED directly to ACTION_TAKEN)", () => {
      const report = createSafetyOrGrievanceReport({
        sector: "college",
        type: "fatigue_exhaustion",
        description: "Three consecutive night closes assigned without required gap.",
        reporterName: "Worker B"
      }, 102);

      assert.throws(
        () => transitionReportStatus(report, REPORT_STATUSES.ACTION_TAKEN),
        ValueError
      );

      // Also cannot transition out of terminal state RESOLVED
      transitionReportStatus(report, REPORT_STATUSES.UNDER_REVIEW);
      transitionReportStatus(report, REPORT_STATUSES.RESOLVED);

      assert.throws(
        () => transitionReportStatus(report, REPORT_STATUSES.SUBMITTED),
        ValueError
      );
    });
  });

  describe("Employer Analytics: Explainable Fatigue & Fairness Indicators", () => {
    it("flags rest violations with plain-language explanations referencing demo assumptions", () => {
      const workers = [
        { id: "w1", name: "Sunil Kumar" },
        { id: "w2", name: "Deepak Verma" }
      ];

      const shifts = [
        {
          id: "s1",
          title: "Day Excavation",
          startTime: "2026-10-27T08:00:00Z",
          endTime: "2026-10-27T16:00:00Z", // 8 hours
          assignedWorkerIds: ["w1"]
        },
        {
          id: "s2",
          title: "Night Pour",
          startTime: "2026-10-27T22:00:00Z", // 6 hours rest from 16:00 to 22:00
          endTime: "2026-10-28T06:00:00Z",
          assignedWorkerIds: ["w1"]
        }
      ];

      const metrics = calculateFairnessAndFatigueMetrics(workers, shifts, { sector: "construction" });
      assert.equal(metrics.fatigueAlerts.length, 1);
      const alert = metrics.fatigueAlerts[0];
      assert.equal(alert.type, "INSUFFICIENT_REST_ADVISORY");
      assert.equal(alert.observedRestHours, 6.0);
      assert.match(alert.explanation, /Sunil Kumar has only 6h rest/);
      assert.match(alert.explanation, /Demonstration assumption: 11h/);
    });

    it("detects directly overlapping shifts assigned to the same worker and produces a conflict alert", () => {
      const workers = [{ id: "w1", name: "Sunil Kumar" }];
      const overlappingShifts = [
        {
          id: "s1",
          title: "Morning Pour",
          startTime: "2026-10-27T08:00:00Z",
          endTime: "2026-10-27T14:00:00Z",
          assignedWorkerIds: ["w1"]
        },
        {
          id: "s2",
          title: "Afternoon Scaffolding",
          startTime: "2026-10-27T12:00:00Z", // Overlaps with 08:00-14:00
          endTime: "2026-10-27T18:00:00Z",
          assignedWorkerIds: ["w1"]
        }
      ];

      const metrics = calculateFairnessAndFatigueMetrics(workers, overlappingShifts, { sector: "construction" });
      const conflict = metrics.fatigueAlerts.find(a => a.type === "OVERLAPPING_SHIFT_CONFLICT");
      assert.ok(conflict, "Expected an OVERLAPPING_SHIFT_CONFLICT alert");
      assert.equal(conflict.workerId, "w1");
      assert.match(conflict.explanation, /Direct conflict: Sunil Kumar is concurrently assigned to overlapping shifts/);
      assert.equal(conflict.shiftATitle, "Morning Pour");
      assert.equal(conflict.shiftBTitle, "Afternoon Scaffolding");
    });

    it("computes equity score and explains hour dispersion across roster", () => {
      const workers = [
        { id: "w1", name: "Worker One" },
        { id: "w2", name: "Worker Two" }
      ];

      // Equal distribution: each has 8 hours
      const equalShifts = [
        {
          id: "s1",
          startTime: "2026-10-27T08:00:00Z",
          endTime: "2026-10-27T16:00:00Z",
          assignedWorkerIds: ["w1"]
        },
        {
          id: "s2",
          startTime: "2026-10-27T08:00:00Z",
          endTime: "2026-10-27T16:00:00Z",
          assignedWorkerIds: ["w2"]
        }
      ];

      const equalMetrics = calculateFairnessAndFatigueMetrics(workers, equalShifts);
      assert.equal(equalMetrics.equityScore, 100);
      assert.equal(equalMetrics.meanHours, 8.0);
      assert.equal(equalMetrics.standardDeviation, 0.0);
      assert.match(equalMetrics.explanation, /Shifts are equitably distributed/);

      // Unequal distribution: w1 has 16 hours, w2 has 0 hours
      const unequalShifts = [
        {
          id: "s1",
          startTime: "2026-10-27T08:00:00Z",
          endTime: "2026-10-27T16:00:00Z",
          assignedWorkerIds: ["w1"]
        },
        {
          id: "s2",
          startTime: "2026-10-28T08:00:00Z",
          endTime: "2026-10-28T16:00:00Z",
          assignedWorkerIds: ["w1"]
        }
      ];

      const unequalMetrics = calculateFairnessAndFatigueMetrics(workers, unequalShifts);
      assert.equal(unequalMetrics.meanHours, 8.0);
      assert.equal(unequalMetrics.standardDeviation, 8.0);
      assert.equal(unequalMetrics.equityScore, 0); // High disparity
      assert.match(unequalMetrics.explanation, /disparity among active workers/);
    });
  });
});

