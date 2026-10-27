/**
 * FairShift In-Memory Demonstration Store
 * 
 * Manages in-memory shift, worker, and report state for construction and college sectors.
 * 
 * DISCLAIMER & STORAGE NOTICE:
 * All data is stored in memory for demonstration purposes. State resets whenever the server restarts.
 * Rest interval (11h) and student hour cap (20h) are demonstration assumptions, not statutory rules.
 */

import {
  DEFAULT_CONFIGS,
  DEMO_DISCLAIMER,
  REPORT_STATUSES,
  ValueError,
  evaluateShiftEligibility,
  calculateShiftEarnings,
  calculateWorkerSummary,
  createSafetyOrGrievanceReport,
  transitionReportStatus,
  calculateFairnessAndFatigueMetrics
} from "./fairshift.js";

export const STORAGE_NOTICE =
  "In-memory demonstration store. Data resets on server restart. No persistent database attached.";

export function getInitialSeedData() {
  const workers = [
    // Construction workers
    {
      id: "w_c1",
      sector: "construction",
      name: "Aarav Sharma",
      roles: ["Scaffolder", "General Laborer"],
      certifications: ["OSHA-10", "Scaffolding Safety"]
    },
    {
      id: "w_c2",
      sector: "construction",
      name: "Sunil Kumar",
      roles: ["Mason", "General Laborer"],
      certifications: ["OSHA-10", "Masonry Level 2"]
    },
    {
      id: "w_c3",
      sector: "construction",
      name: "Deepak Verma",
      roles: ["Electrician"],
      certifications: ["OSHA-10", "Electrical Safety"]
    },
    {
      id: "w_c4",
      sector: "construction",
      name: "Vikram Singh",
      roles: ["Crane Operator"],
      certifications: ["Heavy Machinery", "OSHA-10"]
    },
    // College workers
    {
      id: "w_u1",
      sector: "college",
      name: "Priya Verma",
      roles: ["Library Proctor", "Computer Lab Assistant"],
      certifications: ["FERPA Basics"]
    },
    {
      id: "w_u2",
      sector: "college",
      name: "Rohan Mehta",
      roles: ["Teaching Assistant", "Computer Lab Assistant"],
      certifications: ["FERPA Basics"]
    },
    {
      id: "w_u3",
      sector: "college",
      name: "Ananya Iyer",
      roles: ["Campus Dining Staff"],
      certifications: ["Food Safety Basics"]
    },
    {
      id: "w_u4",
      sector: "college",
      name: "Kavita Rao",
      roles: ["Research Aide"],
      certifications: ["Lab Safety"]
    }
  ];

  const shifts = [
    // Construction Shifts
    {
      id: "s_c1",
      sector: "construction",
      title: "Tower B Scaffolding Staging",
      description: "Erect secondary scaffold frames along northern facade.",
      startTime: "2026-10-28T08:00:00Z",
      endTime: "2026-10-28T16:00:00Z",
      hourlyRate: 350,
      capacity: 2,
      requiredRole: "Scaffolder",
      requiredCertifications: ["Scaffolding Safety"],
      assignedWorkerIds: ["w_c1"]
    },
    {
      id: "s_c2",
      sector: "construction",
      title: "Foundation Slab Pouring",
      description: "Assist concrete pour and structural vibrator operation.",
      startTime: "2026-10-28T08:00:00Z",
      endTime: "2026-10-28T16:00:00Z",
      hourlyRate: 320,
      capacity: 3,
      requiredRole: "Mason",
      requiredCertifications: [],
      assignedWorkerIds: ["w_c2"]
    },
    {
      id: "s_c3",
      sector: "construction",
      title: "Main Conduit Electrical Rough-in",
      description: "Install 4-inch conduit sleeves through Level 2 penetrations.",
      startTime: "2026-10-29T09:00:00Z",
      endTime: "2026-10-29T17:00:00Z",
      hourlyRate: 380,
      capacity: 1,
      requiredRole: "Electrician",
      requiredCertifications: ["Electrical Safety"],
      assignedWorkerIds: []
    },
    {
      id: "s_c4",
      sector: "construction",
      title: "Night Site Perimeter Inspection",
      description: "Security walk and floodlight check along southern trench.",
      startTime: "2026-10-28T22:00:00Z",
      endTime: "2026-10-29T04:00:00Z",
      hourlyRate: 400,
      capacity: 1,
      requiredRole: "General Laborer",
      requiredCertifications: ["OSHA-10"],
      assignedWorkerIds: []
    },
    // College Shifts
    {
      id: "s_u1",
      sector: "college",
      title: "Central Library Information Desk",
      description: "Manage reserves checkout and quiet-study floor monitor.",
      startTime: "2026-10-28T08:00:00Z",
      endTime: "2026-10-28T12:00:00Z",
      hourlyRate: 150,
      capacity: 2,
      requiredRole: "Library Proctor",
      requiredCertifications: [],
      assignedWorkerIds: ["w_u1"]
    },
    {
      id: "s_u2",
      sector: "college",
      title: "Turing Lab Linux Workstations",
      description: "Assist freshmen with SSH access and compiler setup.",
      startTime: "2026-10-28T13:00:00Z",
      endTime: "2026-10-28T17:00:00Z",
      hourlyRate: 180,
      capacity: 1,
      requiredRole: "Computer Lab Assistant",
      requiredCertifications: ["FERPA Basics"],
      assignedWorkerIds: []
    },
    {
      id: "s_u3",
      sector: "college",
      title: "Dining Commons Lunch Rush",
      description: "Tray staging, beverage station restocking, and line support.",
      startTime: "2026-10-29T11:00:00Z",
      endTime: "2026-10-29T15:00:00Z",
      hourlyRate: 140,
      capacity: 3,
      requiredRole: "Campus Dining Staff",
      requiredCertifications: [],
      assignedWorkerIds: ["w_u3"]
    },
    {
      id: "s_u4",
      sector: "college",
      title: "Archives Evening Cataloging",
      description: "Scan thesis deposits and update digital repository tags.",
      startTime: "2026-10-29T17:00:00Z",
      endTime: "2026-10-29T21:00:00Z",
      hourlyRate: 160,
      capacity: 1,
      requiredRole: "Library Proctor",
      requiredCertifications: [],
      assignedWorkerIds: []
    }
  ];

  const reports = [
    {
      referenceId: "FS-SAFE-0001",
      sector: "construction",
      type: "safety_hazard",
      description: "Missing toe-boards along northern scaffold platform hoistway.",
      reporterName: "Aarav Sharma",
      workerId: "w_c1",
      status: REPORT_STATUSES.UNDER_REVIEW,
      createdAt: "2026-10-27T08:30:00Z",
      updatedAt: "2026-10-27T09:15:00Z",
      statusHistory: [
        {
          status: REPORT_STATUSES.SUBMITTED,
          timestamp: "2026-10-27T08:30:00Z",
          actor: "Aarav Sharma",
          note: "Report submitted into tracking system."
        },
        {
          fromStatus: REPORT_STATUSES.SUBMITTED,
          status: REPORT_STATUSES.UNDER_REVIEW,
          timestamp: "2026-10-27T09:15:00Z",
          actor: "Safety Supervisor Rao",
          note: "Inspecting northern facade hoistway."
        }
      ]
    },
    {
      referenceId: "FS-GRIEV-0001",
      sector: "college",
      type: "scheduling_bias",
      description: "Consecutive late-night closing shifts assigned during calculus midterm week.",
      reporterName: "Priya Verma",
      workerId: "w_u1",
      status: REPORT_STATUSES.SUBMITTED,
      createdAt: "2026-10-27T09:00:00Z",
      updatedAt: "2026-10-27T09:00:00Z",
      statusHistory: [
        {
          status: REPORT_STATUSES.SUBMITTED,
          timestamp: "2026-10-27T09:00:00Z",
          actor: "Priya Verma",
          note: "Report submitted into tracking system."
        }
      ]
    }
  ];

  return { workers, shifts, reports };
}

export function createStore() {
  let { workers, shifts, reports } = getInitialSeedData();
  let shiftCounter = 100;
  let reportCounter = 10;

  return {
    reset() {
      const data = getInitialSeedData();
      workers = data.workers;
      shifts = data.shifts;
      reports = data.reports;
      shiftCounter = 100;
      reportCounter = 10;
    },

    getSectorConfig(sector = "construction") {
      const config = DEFAULT_CONFIGS[sector] || DEFAULT_CONFIGS.construction;
      return {
        ...config,
        storageNotice: STORAGE_NOTICE,
        availableSectors: Object.keys(DEFAULT_CONFIGS)
      };
    },

    getAllConfigs() {
      return {
        configs: DEFAULT_CONFIGS,
        disclaimer: DEMO_DISCLAIMER,
        storageNotice: STORAGE_NOTICE
      };
    },

    getWorkers(sector) {
      const list = sector ? workers.filter(w => w.sector === sector) : [...workers];
      return list.map(w => {
        const sectorCfg = DEFAULT_CONFIGS[w.sector] || DEFAULT_CONFIGS.construction;
        const summary = calculateWorkerSummary(w.id, shifts, sectorCfg);
        return {
          ...w,
          summary
        };
      });
    },

    getWorkerById(id) {
      return workers.find(w => w.id === id) || null;
    },

    getShifts(sector, workerId) {
      let filtered = sector ? shifts.filter(s => s.sector === sector) : [...shifts];
      const worker = workerId ? this.getWorkerById(workerId) : null;
      const workerAssigned = workerId
        ? shifts.filter(s => Array.isArray(s.assignedWorkerIds) && s.assignedWorkerIds.includes(workerId))
        : [];

      return filtered.map(shift => {
        const earnings = calculateShiftEarnings(shift);
        const assignedWorkerIds = shift.assignedWorkerIds || [];
        const isAssigned = workerId ? assignedWorkerIds.includes(workerId) : false;

        let eligibility = null;
        if (worker) {
          eligibility = evaluateShiftEligibility(worker, shift, workerAssigned, { sector: shift.sector });
        }

        return {
          ...shift,
          durationHours: earnings.hours,
          grossPayEstimate: earnings.grossPay,
          isAssigned,
          availableSpots: Math.max(0, (shift.capacity || 1) - assignedWorkerIds.length),
          eligibility
        };
      });
    },

    getShiftById(id) {
      return shifts.find(s => s.id === id) || null;
    },

    createShift(shiftData) {
      if (!shiftData || typeof shiftData !== "object") {
        throw new ValueError("Shift data must be an object");
      }
      const sector = shiftData.sector || "construction";
      if (!DEFAULT_CONFIGS[sector]) {
        throw new ValueError(`Invalid sector: ${sector}`);
      }
      if (!shiftData.title || typeof shiftData.title !== "string" || shiftData.title.trim().length < 3) {
        throw new ValueError("Shift title must be at least 3 characters");
      }

      // Validates timestamps and duration
      calculateShiftEarnings({
        startTime: shiftData.startTime,
        endTime: shiftData.endTime,
        hourlyRate: shiftData.hourlyRate
      });

      let capacity = 1;
      if (shiftData.capacity !== undefined) {
        if (!Number.isInteger(shiftData.capacity) || shiftData.capacity < 0) {
          throw new ValueError("Shift capacity must be a non-negative integer");
        }
        capacity = shiftData.capacity;
      }

      shiftCounter += 1;
      const newShift = {
        id: `s_${sector[0]}_${shiftCounter}`,
        sector,
        title: shiftData.title.trim(),
        description: (shiftData.description || "").trim(),
        startTime: shiftData.startTime,
        endTime: shiftData.endTime,
        hourlyRate: Number(shiftData.hourlyRate),
        capacity,
        requiredRole: shiftData.requiredRole || null,
        requiredCertifications: Array.isArray(shiftData.requiredCertifications)
          ? shiftData.requiredCertifications
          : [],
        assignedWorkerIds: []
      };

      shifts.push(newShift);
      return newShift;
    },

    claimShift(shiftId, workerId) {
      const shift = this.getShiftById(shiftId);
      if (!shift) {
        const err = new ValueError(`Shift not found: ${shiftId}`);
        err.statusCode = 404;
        throw err;
      }
      const worker = this.getWorkerById(workerId);
      if (!worker) {
        const err = new ValueError(`Worker not found: ${workerId}`);
        err.statusCode = 404;
        throw err;
      }

      const workerAssigned = shifts.filter(
        s => Array.isArray(s.assignedWorkerIds) && s.assignedWorkerIds.includes(workerId)
      );

      const evalResult = evaluateShiftEligibility(worker, shift, workerAssigned, { sector: shift.sector });

      if (!evalResult.eligible) {
        const err = new ValueError(`Eligibility check failed: ${evalResult.blockers.join(" ")}`);
        err.statusCode = 409; // Conflict
        err.evaluation = evalResult;
        throw err;
      }

      if (!Array.isArray(shift.assignedWorkerIds)) {
        shift.assignedWorkerIds = [];
      }
      shift.assignedWorkerIds.push(workerId);

      return {
        claimed: true,
        shiftId: shift.id,
        workerId: worker.id,
        assignedWorkerCount: shift.assignedWorkerIds.length,
        capacity: shift.capacity,
        advisories: evalResult.advisories
      };
    },

    getReports(sector, refId) {
      if (refId) {
        const found = reports.find(r => r.referenceId === refId);
        if (!found) return null;
        // Exact reference ID lookup provides full report details with audit history
        return {
          referenceId: found.referenceId,
          sector: found.sector,
          type: found.type,
          status: found.status,
          description: found.description,
          createdAt: found.createdAt,
          updatedAt: found.updatedAt,
          statusHistory: found.statusHistory,
          privacyNotice: "Report details retrieved by reference ID. Reporter identity redacted in demonstration mode."
        };
      }

      let filtered = sector ? reports.filter(r => r.sector === sector) : reports;
      // Public listing scrubs reporter personal info and truncates sensitive descriptions
      return filtered.map(r => ({
        referenceId: r.referenceId,
        sector: r.sector,
        type: r.type,
        status: r.status,
        descriptionPreview: r.description.length > 50 ? `${r.description.slice(0, 47)}...` : r.description,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        historyCount: r.statusHistory ? r.statusHistory.length : 1
      }));
    },

    createReport(reportData) {
      reportCounter += 1;
      const report = createSafetyOrGrievanceReport(reportData, reportCounter);
      reports.push(report);
      return report;
    },

    updateReportStatus(refId, nextStatus, { actor = "Admin", note = "" } = {}) {
      const report = reports.find(r => r.referenceId === refId);
      if (!report) {
        const err = new ValueError(`Report not found: ${refId}`);
        err.statusCode = 404;
        throw err;
      }
      return transitionReportStatus(report, nextStatus, { actor, note });
    },

    getAdminMetrics(sector = "construction") {
      const sectorWorkers = this.getWorkers(sector);
      const sectorShifts = shifts.filter(s => s.sector === sector);
      const metrics = calculateFairnessAndFatigueMetrics(sectorWorkers, sectorShifts, { sector });
      return {
        ...metrics,
        storageNotice: STORAGE_NOTICE
      };
    }
  };
}

