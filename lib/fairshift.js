/**
 * FairShift Core Logic Module
 * 
 * Implements deterministic shift scheduling, eligibility validation,
 * time-conflict checks, configurable demonstration assumptions (rest/hours),
 * hours and gross-pay computation, grievance/safety report transitions,
 * and explainable fairness metrics.
 * 
 * DISCLAIMER:
 * Rest intervals (e.g., 11-hour gap) and student weekly hour limits (e.g., 20h cap)
 * are configurable demonstration assumptions for testing and simulation purposes,
 * not verified statutory mandates or legal advice.
 */

export const DEMO_DISCLAIMER =
  "Demonstration assumptions (such as an 11-hour rest interval or a 20-hour college weekly cap) are configured for demonstration and testing purposes only, not statutory advice.";

export const DEFAULT_CONFIGS = {
  construction: {
    sector: "construction",
    displayName: "Construction & Infrastructure Site",
    minRestHoursDemoAssumption: 11,
    maxWeeklyHoursDemoAssumption: 48,
    currencySymbol: "₹",
    allowedRoles: ["Mason", "Electrician", "Scaffolder", "Safety Inspector", "General Laborer", "Crane Operator"],
    disclaimer: DEMO_DISCLAIMER
  },
  college: {
    sector: "college",
    displayName: "College Campus Work-Study",
    minRestHoursDemoAssumption: 8,
    maxWeeklyHoursDemoAssumption: 20,
    currencySymbol: "₹",
    allowedRoles: ["Library Proctor", "Computer Lab Assistant", "Teaching Assistant", "Campus Dining Staff", "Research Aide"],
    disclaimer: DEMO_DISCLAIMER
  }
};

export const REPORT_STATUSES = {
  SUBMITTED: "SUBMITTED",
  UNDER_REVIEW: "UNDER_REVIEW",
  ACTION_TAKEN: "ACTION_TAKEN",
  RESOLVED: "RESOLVED",
  DISMISSED: "DISMISSED"
};

const VALID_TRANSITIONS = {
  [REPORT_STATUSES.SUBMITTED]: [REPORT_STATUSES.UNDER_REVIEW, REPORT_STATUSES.DISMISSED],
  [REPORT_STATUSES.UNDER_REVIEW]: [REPORT_STATUSES.ACTION_TAKEN, REPORT_STATUSES.RESOLVED, REPORT_STATUSES.DISMISSED],
  [REPORT_STATUSES.ACTION_TAKEN]: [REPORT_STATUSES.RESOLVED],
  [REPORT_STATUSES.RESOLVED]: [], // Terminal state
  [REPORT_STATUSES.DISMISSED]: [] // Terminal state
};

/**
 * Validate and parse an ISO date or timestamp into a Unix epoch timestamp (ms).
 */
export function parseTimestamp(value, fieldName = "timestamp") {
  if (value === null || value === undefined || value === "") {
    throw new TypeError(`${fieldName} is required`);
  }
  if (typeof value === "boolean" || typeof value === "symbol" || typeof value === "function") {
    throw new ValueError(`Invalid date type for ${fieldName}`);
  }
  if (typeof value === "object" && !(value instanceof Date)) {
    throw new ValueError(`Invalid date object for ${fieldName}`);
  }
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) {
    throw new ValueError(`Invalid date format for ${fieldName}: ${value}`);
  }
  return time;
}

export class ValueError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValueError";
  }
}

/**
 * Calculate duration in hours between two timestamps.
 */
export function calculateDurationHours(startTime, endTime) {
  const start = parseTimestamp(startTime, "startTime");
  const end = parseTimestamp(endTime, "endTime");
  if (end <= start) {
    throw new ValueError(`endTime (${endTime}) must be strictly after startTime (${startTime})`);
  }
  const hours = (end - start) / (1000 * 60 * 60);
  return Math.round(hours * 100) / 100;
}

/**
 * Test if two time intervals [startA, endA) and [startB, endB) overlap.
 */
export function doIntervalsOverlap(startA, endA, startB, endB) {
  const sA = parseTimestamp(startA, "startA");
  const eA = parseTimestamp(endA, "endA");
  const sB = parseTimestamp(startB, "startB");
  const eB = parseTimestamp(endB, "endB");
  if (eA <= sA || eB <= sB) {
    throw new ValueError("Interval end must be strictly after interval start");
  }
  return sA < eB && eA > sB;
}

/**
 * Calculate rest duration in hours between two non-overlapping intervals.
 * Returns null if they overlap or are identical.
 */
export function calculateRestHours(startA, endA, startB, endB) {
  const sA = parseTimestamp(startA, "startA");
  const eA = parseTimestamp(endA, "endA");
  const sB = parseTimestamp(startB, "startB");
  const eB = parseTimestamp(endB, "endB");

  if (doIntervalsOverlap(sA, eA, sB, eB)) {
    return null; // Overlap, rest cannot be calculated
  }

  let restMs = 0;
  if (eA <= sB) {
    restMs = sB - eA;
  } else if (eB <= sA) {
    restMs = sA - eB;
  }
  return Math.round((restMs / (1000 * 60 * 60)) * 100) / 100;
}

/**
 * Calculate the week key (YYYY-Www) in ISO standard for grouping weekly hours.
 */
export function getIsoWeekKey(dateInput) {
  const d = new Date(parseTimestamp(dateInput, "dateInput"));
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/**
 * Calculate hours and gross pay for a single shift.
 */
export function calculateShiftEarnings(shift) {
  if (!shift || typeof shift !== "object") {
    throw new TypeError("shift must be a valid object");
  }
  const hours = calculateDurationHours(shift.startTime, shift.endTime);

  if (
    shift.hourlyRate === null ||
    shift.hourlyRate === undefined ||
    shift.hourlyRate === "" ||
    typeof shift.hourlyRate === "boolean"
  ) {
    throw new ValueError("hourlyRate must be provided as a non-negative number");
  }

  const rate = Number(shift.hourlyRate);
  if (!Number.isFinite(rate) || rate < 0) {
    throw new ValueError("hourlyRate must be a non-negative finite number");
  }
  const grossPay = Math.round(hours * rate * 100) / 100;
  return {
    hours,
    hourlyRate: rate,
    grossPay
  };
}

/**
 * Check whether a worker is eligible to claim a shift.
 * Validates role/certifications, double-booking, and evaluates
 * configurable demonstration rest/weekly hour assumptions.
 */
export function evaluateShiftEligibility(worker, targetShift, workerAssignedShifts = [], options = {}) {
  if (!worker || typeof worker !== "object") {
    throw new TypeError("worker must be an object");
  }
  if (!targetShift || typeof targetShift !== "object") {
    throw new TypeError("targetShift must be an object");
  }

  const sector = targetShift.sector || options.sector || "construction";
  const baseConfig = DEFAULT_CONFIGS[sector] || DEFAULT_CONFIGS.construction;
  const config = {
    ...baseConfig,
    ...options
  };

  const targetStart = parseTimestamp(targetShift.startTime, "targetShift.startTime");
  const targetEnd = parseTimestamp(targetShift.endTime, "targetShift.endTime");
  const shiftHours = calculateDurationHours(targetStart, targetEnd);

  const blockers = [];
  const advisories = [];
  const conflicts = [];
  let minObservedRest = null;
  let minRestAdjacentShift = null;

  // 1. Capacity check
  const assignedWorkerIds = targetShift.assignedWorkerIds || [];
  let capacity = 1;
  if (typeof targetShift.capacity === "number") {
    if (!Number.isFinite(targetShift.capacity) || targetShift.capacity < 0 || !Number.isInteger(targetShift.capacity)) {
      throw new ValueError("Shift capacity must be a non-negative integer");
    }
    capacity = targetShift.capacity;
  } else if (targetShift.capacity !== undefined) {
    throw new ValueError("Shift capacity must be a non-negative integer");
  }

  if (assignedWorkerIds.includes(worker.id)) {
    blockers.push("Worker is already assigned to this shift.");
  } else if (capacity === 0) {
    blockers.push("Shift is closed (capacity is 0).");
  } else if (assignedWorkerIds.length >= capacity) {
    blockers.push(`Shift capacity reached (${assignedWorkerIds.length}/${capacity}).`);
  }

  // 2. Role / Certification match
  if (targetShift.requiredRole) {
    const workerRoles = Array.isArray(worker.roles) ? worker.roles : [worker.role].filter(Boolean);
    if (!workerRoles.includes(targetShift.requiredRole)) {
      blockers.push(`Missing required role: ${targetShift.requiredRole}.`);
    }
  }

  if (Array.isArray(targetShift.requiredCertifications) && targetShift.requiredCertifications.length > 0) {
    const workerCerts = new Set(worker.certifications || []);
    for (const reqCert of targetShift.requiredCertifications) {
      if (!workerCerts.has(reqCert)) {
        blockers.push(`Missing required certification: ${reqCert}.`);
      }
    }
  }

  // 3. Direct time overlap / double-booking
  for (const existing of workerAssignedShifts) {
    if (existing.id === targetShift.id) continue;
    const exStart = parseTimestamp(existing.startTime, "existing.startTime");
    const exEnd = parseTimestamp(existing.endTime, "existing.endTime");

    if (doIntervalsOverlap(targetStart, targetEnd, exStart, exEnd)) {
      conflicts.push({
        shiftId: existing.id,
        title: existing.title || "Untitled Shift",
        startTime: existing.startTime,
        endTime: existing.endTime
      });
      blockers.push(`Time conflict: overlaps with shift "${existing.title || existing.id}" (${existing.startTime} - ${existing.endTime}).`);
    } else {
      // Calculate adjacent rest gap
      const rest = calculateRestHours(targetStart, targetEnd, exStart, exEnd);
      if (rest !== null) {
        if (minObservedRest === null || rest < minObservedRest) {
          minObservedRest = rest;
          minRestAdjacentShift = existing;
        }
      }
    }
  }

  // 4. Configurable rest interval demonstration assumption
  if (minObservedRest !== null && minObservedRest < config.minRestHoursDemoAssumption) {
    const shiftRef = minRestAdjacentShift
      ? `relative to adjacent shift "${minRestAdjacentShift.title || minRestAdjacentShift.id}"`
      : "before/after adjacent shift";
    advisories.push(
      `Rest interval advisory: ${minObservedRest}h gap ${shiftRef} is below the demonstration assumption of ${config.minRestHoursDemoAssumption}h. (${config.disclaimer})`
    );
  }

  // 5. Configurable weekly hours demonstration assumption
  const targetWeek = getIsoWeekKey(targetStart);
  let currentWeeklyHours = 0;
  for (const s of workerAssignedShifts) {
    if (s.id === targetShift.id) continue;
    if (getIsoWeekKey(s.startTime) === targetWeek) {
      currentWeeklyHours += calculateDurationHours(s.startTime, s.endTime);
    }
  }
  const projectedWeeklyHours = Math.round((currentWeeklyHours + shiftHours) * 100) / 100;

  if (projectedWeeklyHours > config.maxWeeklyHoursDemoAssumption) {
    advisories.push(
      `Weekly hours advisory: claiming this shift brings projected weekly total to ${projectedWeeklyHours}h, exceeding the demonstration threshold of ${config.maxWeeklyHoursDemoAssumption}h. (${config.disclaimer})`
    );
  }

  const eligible = blockers.length === 0;

  return {
    eligible,
    blockers,
    advisories,
    conflicts,
    minObservedRestHours: minObservedRest,
    minRestAdjacentShift: minRestAdjacentShift
      ? {
          id: minRestAdjacentShift.id,
          title: minRestAdjacentShift.title || minRestAdjacentShift.id,
          startTime: minRestAdjacentShift.startTime,
          endTime: minRestAdjacentShift.endTime
        }
      : null,
    projectedWeeklyHours,
    shiftHours,
    configAssumptionNotes: {
      sector: config.sector,
      minRestHoursDemoAssumption: config.minRestHoursDemoAssumption,
      maxWeeklyHoursDemoAssumption: config.maxWeeklyHoursDemoAssumption,
      disclaimer: config.disclaimer
    }
  };
}

/**
 * Calculate total hours and gross earnings for a set of assigned shifts.
 */
export function calculateWorkerSummary(workerId, shifts = [], sectorConfig = DEFAULT_CONFIGS.construction) {
  if (!workerId) {
    throw new TypeError("workerId is required");
  }
  const relevant = shifts.filter(s => Array.isArray(s.assignedWorkerIds) && s.assignedWorkerIds.includes(workerId));

  let totalHours = 0;
  let totalGrossPay = 0;
  const weeklyMap = {};

  for (const shift of relevant) {
    const earnings = calculateShiftEarnings(shift);
    totalHours += earnings.hours;
    totalGrossPay += earnings.grossPay;

    const week = getIsoWeekKey(shift.startTime);
    weeklyMap[week] = Math.round(((weeklyMap[week] || 0) + earnings.hours) * 100) / 100;
  }

  totalHours = Math.round(totalHours * 100) / 100;
  totalGrossPay = Math.round(totalGrossPay * 100) / 100;

  return {
    workerId,
    assignedShiftCount: relevant.length,
    totalHours,
    totalGrossPay,
    currencySymbol: sectorConfig.currencySymbol || "₹",
    weeklyHours: weeklyMap
  };
}

/**
 * Create a new safety or grievance report with trackable reference ID.
 */
export function createSafetyOrGrievanceReport(reportInput, counter = 1) {
  if (!reportInput || typeof reportInput !== "object") {
    throw new TypeError("reportInput must be an object");
  }
  const { sector, type, description, reporterName, workerId } = reportInput;

  if (!sector || !DEFAULT_CONFIGS[sector]) {
    throw new ValueError(`Invalid sector: ${sector}. Must be 'construction' or 'college'.`);
  }
  const validTypes = ["safety_hazard", "fatigue_exhaustion", "wage_discrepancy", "scheduling_bias", "other"];
  if (!type || !validTypes.includes(type)) {
    throw new ValueError(`Invalid report type: ${type}. Must be one of: ${validTypes.join(", ")}`);
  }
  if (!description || typeof description !== "string" || description.trim().length < 10) {
    throw new ValueError("description must be at least 10 characters long");
  }

  const prefix = type === "safety_hazard" ? "FS-SAFE" : "FS-GRIEV";
  const num = String(counter).padStart(4, "0");
  const referenceId = `${prefix}-${num}`;
  const now = new Date().toISOString();

  return {
    referenceId,
    sector,
    type,
    description: description.trim(),
    reporterName: (reporterName || "Anonymous Worker").trim(),
    workerId: workerId || null,
    status: REPORT_STATUSES.SUBMITTED,
    createdAt: now,
    updatedAt: now,
    statusHistory: [
      {
        status: REPORT_STATUSES.SUBMITTED,
        timestamp: now,
        actor: reporterName || "Reporter",
        note: "Report submitted into tracking system."
      }
    ]
  };
}

/**
 * Transition a report's status according to the valid state machine.
 */
export function transitionReportStatus(report, nextStatus, { actor = "Admin", note = "" } = {}) {
  if (!report || typeof report !== "object") {
    throw new TypeError("report must be an object");
  }
  if (!REPORT_STATUSES[nextStatus]) {
    throw new ValueError(`Invalid target status: ${nextStatus}`);
  }

  const current = report.status;
  const allowed = VALID_TRANSITIONS[current] || [];
  if (!allowed.includes(nextStatus)) {
    throw new ValueError(
      `Illegal status transition: cannot transition from ${current} to ${nextStatus}. Allowed: [${allowed.join(", ") || "none - terminal state"}]`
    );
  }

  const now = new Date().toISOString();
  report.status = nextStatus;
  report.updatedAt = now;
  if (!Array.isArray(report.statusHistory)) {
    report.statusHistory = [];
  }
  report.statusHistory.push({
    fromStatus: current,
    status: nextStatus,
    timestamp: now,
    actor,
    note: note || `Status updated to ${nextStatus}`
  });

  return report;
}

/**
 * Compute explainable employer indicators:
 * - Fatigue risk alerts (gaps below demo assumption or excessive weekly hours)
 * - Fairness distribution index (hours variance, Gini coefficient / coefficient of variation)
 */
export function calculateFairnessAndFatigueMetrics(workers = [], shifts = [], options = {}) {
  const sector = options.sector || "construction";
  const config = {
    ...(DEFAULT_CONFIGS[sector] || DEFAULT_CONFIGS.construction),
    ...options
  };

  const fatigueAlerts = [];
  const workerHourMap = new Map();

  for (const w of workers) {
    workerHourMap.set(w.id, {
      workerId: w.id,
      workerName: w.name,
      totalHours: 0,
      shifts: []
    });
  }

  // Organize assigned shifts per worker
  for (const shift of shifts) {
    const hours = calculateDurationHours(shift.startTime, shift.endTime);
    for (const wId of (shift.assignedWorkerIds || [])) {
      if (!workerHourMap.has(wId)) {
        workerHourMap.set(wId, { workerId: wId, workerName: `Worker-${wId}`, totalHours: 0, shifts: [] });
      }
      const record = workerHourMap.get(wId);
      record.totalHours += hours;
      record.shifts.push(shift);
    }
  }

  // Evaluate fatigue for each worker
  for (const record of workerHourMap.values()) {
    // Sort shifts chronologically
    record.shifts.sort((a, b) => parseTimestamp(a.startTime) - parseTimestamp(b.startTime));

    // Check for direct time overlaps between any pair of shifts assigned to worker
    for (let i = 0; i < record.shifts.length; i++) {
      const current = record.shifts[i];
      for (let j = i + 1; j < record.shifts.length; j++) {
        const candidate = record.shifts[j];
        if (doIntervalsOverlap(current.startTime, current.endTime, candidate.startTime, candidate.endTime)) {
          fatigueAlerts.push({
            workerId: record.workerId,
            workerName: record.workerName,
            type: "OVERLAPPING_SHIFT_CONFLICT",
            shiftAId: current.id,
            shiftBId: candidate.id,
            shiftATitle: current.title || current.id,
            shiftBTitle: candidate.title || candidate.id,
            startTimeA: current.startTime,
            endTimeA: current.endTime,
            startTimeB: candidate.startTime,
            endTimeB: candidate.endTime,
            explanation: `Direct conflict: ${record.workerName} is concurrently assigned to overlapping shifts "${current.title || current.id}" and "${candidate.title || candidate.id}".`
          });
        }
      }
    }

    // Check rest intervals between adjacent shifts
    for (let i = 0; i < record.shifts.length - 1; i++) {
      const current = record.shifts[i];
      const next = record.shifts[i + 1];
      const rest = calculateRestHours(current.startTime, current.endTime, next.startTime, next.endTime);

      if (rest !== null && rest < config.minRestHoursDemoAssumption) {
        fatigueAlerts.push({
          workerId: record.workerId,
          workerName: record.workerName,
          type: "INSUFFICIENT_REST_ADVISORY",
          observedRestHours: rest,
          recommendedRestHours: config.minRestHoursDemoAssumption,
          priorShiftTitle: current.title,
          nextShiftTitle: next.title,
          explanation: `${record.workerName} has only ${rest}h rest between "${current.title}" and "${next.title}". (Demonstration assumption: ${config.minRestHoursDemoAssumption}h; ${config.disclaimer})`
        });
      }
    }

    // Check weekly hour totals
    const weeklyTotals = {};
    for (const s of record.shifts) {
      const wk = getIsoWeekKey(s.startTime);
      weeklyTotals[wk] = (weeklyTotals[wk] || 0) + calculateDurationHours(s.startTime, s.endTime);
    }
    for (const [wk, hrs] of Object.entries(weeklyTotals)) {
      if (hrs > config.maxWeeklyHoursDemoAssumption) {
        fatigueAlerts.push({
          workerId: record.workerId,
          workerName: record.workerName,
          type: "EXCESSIVE_WEEKLY_HOURS_ADVISORY",
          week: wk,
          observedWeeklyHours: hrs,
          thresholdHours: config.maxWeeklyHoursDemoAssumption,
          explanation: `${record.workerName} is allocated ${hrs}h in week ${wk}, exceeding the demonstration threshold of ${config.maxWeeklyHoursDemoAssumption}h. (${config.disclaimer})`
        });
      }
    }
  }

  // Calculate fairness index across all workers
  const hourValues = Array.from(workerHourMap.values()).map(r => r.totalHours);
  const totalWorkers = hourValues.length;

  let meanHours = 0;
  let standardDeviation = 0;
  let equityScore = 100;
  let explanation = "No workers registered.";

  if (totalWorkers > 0) {
    const sum = hourValues.reduce((acc, h) => acc + h, 0);
    meanHours = Math.round((sum / totalWorkers) * 100) / 100;

    const variance = hourValues.reduce((acc, h) => acc + Math.pow(h - meanHours, 2), 0) / totalWorkers;
    standardDeviation = Math.round(Math.sqrt(variance) * 100) / 100;

    if (meanHours > 0) {
      // Coefficient of variation CV = stdDev / mean
      const cv = standardDeviation / meanHours;
      // Equity score maps CV: 0 -> 100, 1.0 -> 0
      equityScore = Math.max(0, Math.min(100, Math.round((1 - Math.min(cv, 1)) * 100)));
      explanation = `Mean worker hours: ${meanHours}h (std dev: ${standardDeviation}h). Equity score: ${equityScore}/100. ${
        equityScore >= 80 ? "Shifts are equitably distributed." : "Shift distribution shows disparity among active workers."
      }`;
    } else {
      equityScore = 100;
      explanation = "No hours currently logged across registered workers.";
    }
  }

  return {
    sector: config.sector,
    totalWorkers,
    meanHours,
    standardDeviation,
    equityScore,
    explanation,
    fatigueAlerts,
    workerDistribution: Array.from(workerHourMap.values()).map(r => ({
      workerId: r.workerId,
      workerName: r.workerName,
      totalHours: Math.round(r.totalHours * 100) / 100,
      shiftCount: r.shifts.length
    })),
    disclaimer: config.disclaimer
  };
}

