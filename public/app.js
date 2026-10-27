/**
 * FairShift Client Application
 * 
 * Interacts with the FairShift REST API to provide worker shift claiming,
 * transparent earnings estimation, safety/grievance reporting with audit history,
 * and employer fatigue/fairness indicators.
 * 
 * Pure vanilla ES6 — Zero external frontend frameworks or production dependencies.
 */

(function () {
  "use strict";

  // Application State
  const state = {
    activeSector: "construction",
    activeWorkerId: null,
    activeTab: "viewWorker",
    config: null,
    workers: [],
    shifts: [],
    metrics: null,
    reports: [],
    currentTrackedReport: null
  };

  // DOM Elements Cache
  const el = {
    btnSectorConstruction: document.getElementById("btnSectorConstruction"),
    btnSectorCollege: document.getElementById("btnSectorCollege"),
    tabWorker: document.getElementById("tabWorker"),
    tabEmployer: document.getElementById("tabEmployer"),
    tabReports: document.getElementById("tabReports"),
    viewWorker: document.getElementById("viewWorker"),
    viewEmployer: document.getElementById("viewEmployer"),
    viewReports: document.getElementById("viewReports"),
    workerSelect: document.getElementById("workerSelect"),
    workerBadges: document.getElementById("workerBadges"),
    workerShiftCount: document.getElementById("workerShiftCount"),
    workerTotalHours: document.getElementById("workerTotalHours"),
    workerHoursSub: document.getElementById("workerHoursSub"),
    workerGrossPay: document.getElementById("workerGrossPay"),
    workerRestRule: document.getElementById("workerRestRule"),
    shiftsContainer: document.getElementById("shiftsContainer"),
    btnRefreshShifts: document.getElementById("btnRefreshShifts"),
    btnRefreshMetrics: document.getElementById("btnRefreshMetrics"),
    equityScoreVal: document.getElementById("equityScoreVal"),
    equityExplanation: document.getElementById("equityExplanation"),
    statMeanHours: document.getElementById("statMeanHours"),
    statStdDev: document.getElementById("statStdDev"),
    statCrewCount: document.getElementById("statCrewCount"),
    fatigueAlertsContainer: document.getElementById("fatigueAlertsContainer"),
    createShiftForm: document.getElementById("createShiftForm"),
    shiftRole: document.getElementById("shiftRole"),
    shiftStartTime: document.getElementById("shiftStartTime"),
    shiftEndTime: document.getElementById("shiftEndTime"),
    newShiftSectorBadge: document.getElementById("newShiftSectorBadge"),
    btnResetShiftForm: document.getElementById("btnResetShiftForm"),
    rosterTableBody: document.getElementById("rosterTableBody"),
    submitReportForm: document.getElementById("submitReportForm"),
    reportSector: document.getElementById("reportSector"),
    reportSuccessBox: document.getElementById("reportSuccessBox"),
    newReportRefId: document.getElementById("newReportRefId"),
    trackReportForm: document.getElementById("trackReportForm"),
    lookupRefId: document.getElementById("lookupRefId"),
    reportResultBox: document.getElementById("reportResultBox"),
    resRefId: document.getElementById("resRefId"),
    resStatusBadge: document.getElementById("resStatusBadge"),
    resCreatedDate: document.getElementById("resCreatedDate"),
    resDescription: document.getElementById("resDescription"),
    transitionBox: document.getElementById("transitionBox"),
    nextStatusSelect: document.getElementById("nextStatusSelect"),
    statusNoteInput: document.getElementById("statusNoteInput"),
    btnApplyTransition: document.getElementById("btnApplyTransition"),
    resHistoryTimeline: document.getElementById("resHistoryTimeline"),
    publicReportsTable: document.getElementById("publicReportsTable"),
    toastContainer: document.getElementById("toastContainer"),
    liveAnnouncer: document.getElementById("liveAnnouncer")
  };

  // Toast & Screen Reader Announcer
  function showToast(message, type = "info") {
    if (el.liveAnnouncer) {
      el.liveAnnouncer.textContent = message;
    }

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.setAttribute("role", "alert");

    const icon = type === "success" ? "✅" : type === "error" ? "❌" : "ℹ️";
    toast.innerHTML = `<span aria-hidden="true">${icon}</span><span>${escapeHtml(message)}</span>`;

    el.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(10px)";
      toast.style.transition = "all 200ms ease";
      setTimeout(() => toast.remove(), 200);
    }, 4000);
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatDate(isoStr) {
    if (!isoStr) return "--";
    const d = new Date(isoStr);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  // API Call Wrapper
  async function apiFetch(endpoint, options = {}) {
    try {
      const headers = { ...options.headers };
      let body = options.body;
      if (body && typeof body === "object" && !(body instanceof FormData)) {
        body = JSON.stringify(body);
        headers["content-type"] = "application/json";
      }

      const res = await fetch(endpoint, { ...options, headers, body });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const errorMsg = data.error || `HTTP error ${res.status}`;
        const err = new Error(errorMsg);
        err.status = res.status;
        err.data = data;
        throw err;
      }

      return data;
    } catch (err) {
      console.error(`API Error on ${endpoint}:`, err);
      throw err;
    }
  }

  // Initial Data Fetch
  async function loadSectorData() {
    try {
      // 1. Fetch Config
      const configRes = await apiFetch(`/api/config?sector=${state.activeSector}`);
      state.config = configRes.config;

      // 2. Fetch Workers for Sector
      const workersRes = await apiFetch(`/api/workers?sector=${state.activeSector}`);
      state.workers = workersRes.workers || [];

      // Set active worker if not set or not in current sector
      const currentWorker = state.workers.find(w => w.id === state.activeWorkerId);
      if (!currentWorker && state.workers.length > 0) {
        state.activeWorkerId = state.workers[0].id;
      }

      // Update UI components
      renderSectorControls();
      renderWorkerSelector();
      renderWorkerSummary();

      // 3. Load Shifts, Metrics, and Reports
      await Promise.all([
        loadShifts(),
        loadMetrics(),
        loadPublicReports()
      ]);

      // Update Shift Form Sector Presets
      updateShiftFormDefaults();
    } catch (err) {
      showToast(`Failed loading sector data: ${err.message}`, "error");
    }
  }

  function renderSectorControls() {
    const isConstruction = state.activeSector === "construction";
    el.btnSectorConstruction.classList.toggle("active", isConstruction);
    el.btnSectorConstruction.setAttribute("aria-pressed", String(isConstruction));
    el.btnSectorCollege.classList.toggle("active", !isConstruction);
    el.btnSectorCollege.setAttribute("aria-pressed", String(!isConstruction));

    el.reportSector.value = state.activeSector;
    el.newShiftSectorBadge.textContent = isConstruction ? "Construction Site" : "College Work-Study";
    el.newShiftSectorBadge.className = `badge-role ${isConstruction ? "badge-cert" : ""}`;

    // Update Role dropdown options in Shift Form
    if (state.config && Array.isArray(state.config.allowedRoles)) {
      el.shiftRole.innerHTML = state.config.allowedRoles
        .map(role => `<option value="${escapeHtml(role)}">${escapeHtml(role)}</option>`)
        .join("");
    }
  }

  function renderWorkerSelector() {
    el.workerSelect.innerHTML = state.workers
      .map(w => `<option value="${w.id}" ${w.id === state.activeWorkerId ? "selected" : ""}>${escapeHtml(w.name)} (${escapeHtml(w.roles ? w.roles[0] : "Worker")})</option>`)
      .join("");

    renderWorkerBadges();
  }

  function renderWorkerBadges() {
    const worker = state.workers.find(w => w.id === state.activeWorkerId);
    if (!worker) {
      el.workerBadges.innerHTML = "";
      return;
    }

    const rolesHtml = (worker.roles || [])
      .map(r => `<span class="badge-role">${escapeHtml(r)}</span>`)
      .join("");
    const certsHtml = (worker.certifications || [])
      .map(c => `<span class="badge-cert">${escapeHtml(c)}</span>`)
      .join("");

    el.workerBadges.innerHTML = rolesHtml + certsHtml;
  }

  function renderWorkerSummary() {
    const worker = state.workers.find(w => w.id === state.activeWorkerId);
    const summary = worker?.summary || { totalHours: 0, totalGrossPay: 0, assignedShiftCount: 0 };
    const currency = state.config?.currencySymbol || "₹";

    el.workerShiftCount.textContent = summary.assignedShiftCount;
    el.workerTotalHours.innerHTML = `${summary.totalHours.toFixed(1)}<small>h</small>`;
    el.workerGrossPay.textContent = `${currency}${summary.totalGrossPay.toLocaleString()}`;

    if (state.activeSector === "college") {
      el.workerHoursSub.textContent = `Demo cap: ${state.config.maxWeeklyHoursDemoAssumption}h/week`;
      el.workerRestRule.innerHTML = `${state.config.minRestHoursDemoAssumption}.0<small>h</small>`;
    } else {
      el.workerHoursSub.textContent = `Demo guideline: ${state.config.maxWeeklyHoursDemoAssumption}h/week`;
      el.workerRestRule.innerHTML = `${state.config.minRestHoursDemoAssumption}.0<small>h</small>`;
    }
  }

  // Load & Render Shifts
  async function loadShifts(isManual = false) {
    el.shiftsContainer.innerHTML = `
      <div class="loading-state">
        <div class="spinner" aria-hidden="true"></div>
        <p>Loading available shifts...</p>
      </div>`;

    try {
      const url = `/api/shifts?sector=${state.activeSector}&workerId=${state.activeWorkerId || ""}`;
      const data = await apiFetch(url);
      state.shifts = data.shifts || [];
      renderShifts();
      if (isManual) {
        showToast("Shift marketplace updated.", "info");
      }
    } catch (err) {
      el.shiftsContainer.innerHTML = `
        <div class="loading-state">
          <p class="field-error">Error loading shifts: ${escapeHtml(err.message)}</p>
          <button class="btn btn-secondary btn-sm" onclick="window.fairshiftReload()">Retry</button>
        </div>`;
    }
  }

  function renderShifts() {
    if (state.shifts.length === 0) {
      el.shiftsContainer.innerHTML = `<p class="empty-hint">No active shifts found for this sector.</p>`;
      return;
    }

    const currency = state.config?.currencySymbol || "₹";

    el.shiftsContainer.innerHTML = state.shifts
      .map(shift => {
        const isAssigned = shift.isAssigned;
        const eligibility = shift.eligibility;
        const spotsLeft = shift.availableSpots;
        const cardClass = isAssigned ? "shift-card assigned" : "shift-card";

        // Build Eligibility Tag
        let eligibilityHtml = "";
        let buttonState = "";

        if (isAssigned) {
          eligibilityHtml = `<div class="shift-eligibility-box assigned-tag">✓ You are assigned to this shift.</div>`;
          buttonState = `<button type="button" class="btn btn-secondary btn-sm" disabled>Assigned</button>`;
        } else if (eligibility && !eligibility.eligible) {
          const reason = eligibility.blockers.join(" ");
          eligibilityHtml = `<div class="shift-eligibility-box blocked">⛔ Unavailable: ${escapeHtml(reason)}</div>`;
          buttonState = `<button type="button" class="btn btn-secondary btn-sm" disabled>Unavailable</button>`;
        } else {
          // Eligible, check for advisories
          if (eligibility && eligibility.advisories && eligibility.advisories.length > 0) {
            eligibilityHtml = `<div class="shift-eligibility-box advisory">⚠️ ${escapeHtml(eligibility.advisories[0])}</div>`;
          }
          buttonState = `<button type="button" class="btn btn-primary btn-sm btn-claim-shift" data-shift-id="${shift.id}">Claim Shift</button>`;
        }

        const certsBadge = (shift.requiredCertifications || [])
          .map(c => `<span class="badge-cert">${escapeHtml(c)}</span>`)
          .join("");

        return `
          <article class="${cardClass}" id="card-${shift.id}">
            <div class="shift-header">
              <div>
                <h3 class="shift-title">${escapeHtml(shift.title)}</h3>
                <div class="shift-meta-pills">
                  <span class="badge-role">${escapeHtml(shift.requiredRole || "General")}</span>
                  ${certsBadge}
                </div>
              </div>
            </div>

            <p class="metric-sub">${escapeHtml(shift.description || "")}</p>

            <div class="shift-time-box">
              <span class="shift-timing">📅 ${formatDate(shift.startTime)} → ${formatDate(shift.endTime)}</span>
              <span class="shift-duration">⏱️ ${shift.durationHours} hrs</span>
            </div>

            <div class="shift-pay-row">
              <span class="pay-rate">${currency}${shift.hourlyRate}/hr</span>
              <span class="pay-total">${currency}${shift.grossPayEstimate} Est. Gross</span>
            </div>

            ${eligibilityHtml}

            <div class="shift-actions">
              <span class="spots-count">${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} open (Cap: ${shift.capacity || 1})</span>
              ${buttonState}
            </div>
          </article>
        `;
      })
      .join("");

    // Attach Claim Event Listeners
    el.shiftsContainer.querySelectorAll(".btn-claim-shift").forEach(btn => {
      btn.addEventListener("click", () => handleClaimShift(btn.getAttribute("data-shift-id")));
    });
  }

  async function handleClaimShift(shiftId) {
    if (!state.activeWorkerId) {
      showToast("Please select a worker identity first", "error");
      return;
    }

    try {
      const res = await apiFetch(`/api/shifts/${encodeURIComponent(shiftId)}/claim`, {
        method: "POST",
        body: { workerId: state.activeWorkerId }
      });

      showToast("Shift successfully claimed! Schedule and pay updated.", "success");
      // Reload sector data to update metrics and hours
      await loadSectorData();
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  // Shift Creation
  function updateShiftFormDefaults() {
    const now = new Date();
    // Default to tomorrow 08:00
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8, 0, 0);
    const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 16, 0, 0);

    const formatForInput = d => {
      const pad = n => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    el.shiftStartTime.value = formatForInput(tomorrow);
    el.shiftEndTime.value = formatForInput(tomorrowEnd);
  }

  el.createShiftForm.addEventListener("submit", async e => {
    e.preventDefault();

    const title = document.getElementById("shiftTitle").value.trim();
    const role = el.shiftRole.value;
    const desc = document.getElementById("shiftDesc").value.trim();
    const startTime = el.shiftStartTime.value ? new Date(el.shiftStartTime.value).toISOString() : null;
    const endTime = el.shiftEndTime.value ? new Date(el.shiftEndTime.value).toISOString() : null;
    const rate = Number(document.getElementById("shiftHourlyRate").value);
    const capacity = Number(document.getElementById("shiftCapacity").value);
    const certsStr = document.getElementById("shiftCerts").value.trim();
    const certs = certsStr ? certsStr.split(",").map(c => c.trim()).filter(Boolean) : [];

    // Clear field errors
    document.getElementById("errShiftTitle").textContent = "";
    document.getElementById("errShiftStart").textContent = "";
    document.getElementById("errShiftEnd").textContent = "";
    document.getElementById("errShiftRate").textContent = "";

    let hasError = false;
    if (title.length < 3) {
      document.getElementById("errShiftTitle").textContent = "Title must be at least 3 characters";
      hasError = true;
    }
    if (!startTime) {
      document.getElementById("errShiftStart").textContent = "Start time is required";
      hasError = true;
    }
    if (!endTime) {
      document.getElementById("errShiftEnd").textContent = "End time is required";
      hasError = true;
    } else if (new Date(endTime) <= new Date(startTime)) {
      document.getElementById("errShiftEnd").textContent = "End time must be after start time";
      hasError = true;
    }
    if (Number.isNaN(rate) || rate < 0) {
      document.getElementById("errShiftRate").textContent = "Hourly rate must be a non-negative number";
      hasError = true;
    }

    if (hasError) return;

    const submitBtn = document.getElementById("btnSubmitShift");
    const originalSubmitHtml = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;" aria-hidden="true"></span> Publishing...`;

    try {
      const payload = {
        sector: state.activeSector,
        title,
        description: desc,
        startTime,
        endTime,
        hourlyRate: rate,
        capacity,
        requiredRole: role,
        requiredCertifications: certs
      };

      await apiFetch("/api/shifts", {
        method: "POST",
        body: payload
      });

      showToast("New shift published to demonstration marketplace!", "success");
      document.getElementById("shiftTitle").value = "";
      document.getElementById("shiftDesc").value = "";
      document.getElementById("shiftCerts").value = "";

      await Promise.all([loadShifts(), loadMetrics()]);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalSubmitHtml;
    }
  });

  el.btnResetShiftForm.addEventListener("click", () => {
    el.createShiftForm.reset();
    updateShiftFormDefaults();
  });

  // Admin Metrics & Roster
  async function loadMetrics(isManual = false) {
    const originalContent = el.btnRefreshMetrics ? el.btnRefreshMetrics.innerHTML : "";
    if (isManual && el.btnRefreshMetrics) {
      el.btnRefreshMetrics.disabled = true;
      el.btnRefreshMetrics.innerHTML = `<span class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;" aria-hidden="true"></span> Recalculating...`;
    }

    try {
      const [metricsData, workersData] = await Promise.all([
        apiFetch(`/api/admin/metrics?sector=${state.activeSector}`),
        apiFetch(`/api/workers?sector=${state.activeSector}`)
      ]);
      state.metrics = metricsData.metrics;
      if (workersData && Array.isArray(workersData.workers)) {
        state.workers = workersData.workers;
      }
      renderMetrics();

      if (isManual) {
        showToast("Roster metrics and fatigue indicators recalculated successfully.", "success");
      }
    } catch (err) {
      console.error("Failed to load metrics:", err);
      if (isManual) {
        showToast(`Failed to recalculate metrics: ${err.message}`, "error");
      }
    } finally {
      if (isManual && el.btnRefreshMetrics) {
        el.btnRefreshMetrics.disabled = false;
        el.btnRefreshMetrics.innerHTML = originalContent;
      }
    }
  }

  function renderMetrics() {
    if (!state.metrics) return;
    const m = state.metrics;

    el.equityScoreVal.textContent = m.equityScore;
    el.equityExplanation.textContent = m.explanation;
    el.statMeanHours.textContent = `${m.meanHours}h`;
    el.statStdDev.textContent = `±${m.standardDeviation}h`;
    el.statCrewCount.textContent = m.totalWorkers;

    // Render Alerts
    if (!m.fatigueAlerts || m.fatigueAlerts.length === 0) {
      el.fatigueAlertsContainer.innerHTML = `<p class="empty-hint">✓ No active fatigue or overlap warnings for this roster.</p>`;
    } else {
      el.fatigueAlertsContainer.innerHTML = m.fatigueAlerts
        .map(a => {
          const isOverlap = a.type === "OVERLAPPING_SHIFT_CONFLICT";
          const alertClass = isOverlap ? "alert-item overlap" : "alert-item fatigue";
          const icon = isOverlap ? "⛔" : "⚠️";
          return `
            <div class="${alertClass}">
              <strong>${icon} ${escapeHtml(a.workerName || "Worker")}:</strong> ${escapeHtml(a.explanation)}
            </div>
          `;
        })
        .join("");
    }

    // Render Roster Allocation Table
    renderRosterTable();
  }

  function renderRosterTable() {
    if (state.workers.length === 0) {
      el.rosterTableBody.innerHTML = `<tr><td colspan="6" class="text-center">No workers registered in this sector.</td></tr>`;
      return;
    }

    const currency = state.config?.currencySymbol || "₹";

    el.rosterTableBody.innerHTML = state.workers
      .map(w => {
        const summary = w.summary || { totalHours: 0, totalGrossPay: 0, assignedShiftCount: 0 };
        const roles = (w.roles || []).join(", ") || "--";
        const certs = (w.certifications || []).join(", ") || "--";
        const isExceeding = state.config && summary.totalHours > state.config.maxWeeklyHoursDemoAssumption;
        const statusBadge = isExceeding
          ? `<span class="badge-status under_review">Over Cap</span>`
          : `<span class="badge-status resolved">Normal</span>`;

        return `
          <tr>
            <td><strong>${escapeHtml(w.name)}</strong></td>
            <td>${escapeHtml(roles)}</td>
            <td><small>${escapeHtml(certs)}</small></td>
            <td><strong>${summary.totalHours.toFixed(1)}h</strong> (${summary.assignedShiftCount} shifts)</td>
            <td>${currency}${summary.totalGrossPay.toLocaleString()}</td>
            <td>${statusBadge}</td>
          </tr>
        `;
      })
      .join("");
  }

  // Safety & Grievance Reporting
  el.submitReportForm.addEventListener("submit", async e => {
    e.preventDefault();
    const type = document.getElementById("reportType").value;
    const description = document.getElementById("reportDescription").value.trim();
    const reporterName = document.getElementById("reporterName").value.trim();

    const errDesc = document.getElementById("errReportDesc");
    errDesc.textContent = "";

    if (description.length < 10) {
      errDesc.textContent = "Description must be at least 10 characters long.";
      return;
    }

    // Hide any previous success box before submitting
    el.reportSuccessBox.hidden = true;

    const btn = document.getElementById("btnSubmitReport");
    const originalBtnHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;" aria-hidden="true"></span> Filing...`;

    try {
      const res = await apiFetch("/api/reports", {
        method: "POST",
        body: {
          sector: state.activeSector,
          type,
          description,
          reporterName: reporterName || "Anonymous Worker",
          workerId: state.activeWorkerId
        }
      });

      const report = res.report;
      el.newReportRefId.textContent = report.referenceId;
      el.reportSuccessBox.hidden = false;
      document.getElementById("reportDescription").value = "";
      showToast(`Report filed! Reference ID: ${report.referenceId}`, "success");

      // Auto-fill lookup and refresh public registry
      el.lookupRefId.value = report.referenceId;
      await loadPublicReports();
      await handleTrackReport(report.referenceId);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalBtnHtml;
    }
  });

  // Track Report by ID
  el.trackReportForm.addEventListener("submit", async e => {
    e.preventDefault();
    const refId = el.lookupRefId.value.trim();
    if (!refId) return;
    await handleTrackReport(refId);
  });

  async function handleTrackReport(refId) {
    try {
      const res = await apiFetch(`/api/reports?refId=${encodeURIComponent(refId)}`);
      const report = res.reports ? res.reports[0] : null;
      if (!report) {
        showToast(`No report found with ID: ${refId}`, "error");
        return;
      }
      state.currentTrackedReport = report;
      renderTrackedReport(report);
    } catch (err) {
      showToast(err.message, "error");
      el.reportResultBox.hidden = true;
    }
  }

  function renderTrackedReport(report) {
    el.reportResultBox.hidden = false;
    el.resRefId.textContent = report.referenceId;

    const statusKey = (report.status || "SUBMITTED").toLowerCase();
    el.resStatusBadge.textContent = report.status;
    el.resStatusBadge.className = `badge-status ${statusKey}`;
    el.resCreatedDate.textContent = `Filed on ${formatDate(report.createdAt)}`;
    el.resDescription.textContent = report.description;

    // Supervisor Transition Options
    const nextTransitions = {
      SUBMITTED: ["UNDER_REVIEW", "DISMISSED"],
      UNDER_REVIEW: ["ACTION_TAKEN", "RESOLVED", "DISMISSED"],
      ACTION_TAKEN: ["RESOLVED"],
      RESOLVED: [],
      DISMISSED: []
    };

    const allowed = nextTransitions[report.status] || [];
    if (allowed.length === 0) {
      el.transitionBox.hidden = true;
    } else {
      el.transitionBox.hidden = false;
      el.nextStatusSelect.innerHTML = allowed
        .map(st => `<option value="${st}">${st}</option>`)
        .join("");
    }

    // Render Timeline
    const history = report.statusHistory || [];
    el.resHistoryTimeline.innerHTML = history
      .map(h => `
        <li class="history-item">
          <span class="hist-status">${escapeHtml(h.status)}</span>
          <span class="hist-meta"> • ${formatDate(h.timestamp)} by ${escapeHtml(h.actor || "User")}</span>
          <p class="hist-note">${escapeHtml(h.note || "No note recorded.")}</p>
        </li>
      `)
      .join("");
  }

  el.btnApplyTransition.addEventListener("click", async () => {
    if (!state.currentTrackedReport) return;
    const refId = state.currentTrackedReport.referenceId;
    const nextStatus = el.nextStatusSelect.value;
    const note = el.statusNoteInput.value.trim();

    try {
      const res = await apiFetch(`/api/reports/${encodeURIComponent(refId)}/status`, {
        method: "PATCH",
        body: {
          status: nextStatus,
          actor: "Site Supervisor",
          note: note || `State transitioned to ${nextStatus}`
        }
      });

      showToast(`Report updated to ${nextStatus}`, "success");
      el.statusNoteInput.value = "";
      state.currentTrackedReport = res.report;
      renderTrackedReport(res.report);
      await loadPublicReports();
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  // Public Reports Registry Table
  async function loadPublicReports() {
    try {
      const res = await apiFetch(`/api/reports?sector=${state.activeSector}`);
      state.reports = res.reports || [];
      renderPublicReports();
    } catch (err) {
      console.error("Failed to load public reports:", err);
    }
  }

  function renderPublicReports() {
    if (state.reports.length === 0) {
      el.publicReportsTable.innerHTML = `<tr><td colspan="7" class="text-center">No reports filed in this sector.</td></tr>`;
      return;
    }

    el.publicReportsTable.innerHTML = state.reports
      .map(r => {
        const statusKey = (r.status || "SUBMITTED").toLowerCase();
        return `
          <tr>
            <td><strong><code>${escapeHtml(r.referenceId)}</code></strong></td>
            <td>${escapeHtml(r.sector)}</td>
            <td><span class="badge-role">${escapeHtml(r.type)}</span></td>
            <td><span class="badge-status ${statusKey}">${escapeHtml(r.status)}</span></td>
            <td>${escapeHtml(r.descriptionPreview || "")}</td>
            <td>${formatDate(r.createdAt)}</td>
            <td>
              <button type="button" class="btn btn-secondary btn-sm btn-inspect-report" data-ref-id="${r.referenceId}">
                Inspect
              </button>
            </td>
          </tr>
        `;
      })
      .join("");

    el.publicReportsTable.querySelectorAll(".btn-inspect-report").forEach(btn => {
      btn.addEventListener("click", () => {
        const refId = btn.getAttribute("data-ref-id");
        el.lookupRefId.value = refId;
        // Navigate to Safety & Grievances tab so the result box is visible
        switchTab("viewReports");
        handleTrackReport(refId);
      });
    });
  }

  // Navigation Tab Switching
  function switchTab(targetId) {
    state.activeTab = targetId;

    const tabs = [
      { tab: el.tabWorker, view: el.viewWorker, id: "viewWorker" },
      { tab: el.tabEmployer, view: el.viewEmployer, id: "viewEmployer" },
      { tab: el.tabReports, view: el.viewReports, id: "viewReports" }
    ];

    tabs.forEach(({ tab, view, id }) => {
      const isActive = id === targetId;
      tab.classList.toggle("active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
      view.classList.toggle("active", isActive);
      view.hidden = !isActive;
    });
  }

  // Event Listeners Setup
  function setupEventListeners() {
    // Sector Buttons
    el.btnSectorConstruction.addEventListener("click", () => {
      if (state.activeSector !== "construction") {
        state.activeSector = "construction";
        loadSectorData();
      }
    });

    el.btnSectorCollege.addEventListener("click", () => {
      if (state.activeSector !== "college") {
        state.activeSector = "college";
        loadSectorData();
      }
    });

    // Nav Tabs
    el.tabWorker.addEventListener("click", () => switchTab("viewWorker"));
    el.tabEmployer.addEventListener("click", () => switchTab("viewEmployer"));
    el.tabReports.addEventListener("click", () => switchTab("viewReports"));

    // Worker Selection
    el.workerSelect.addEventListener("change", () => {
      state.activeWorkerId = el.workerSelect.value;
      renderWorkerBadges();
      renderWorkerSummary();
      loadShifts();
    });

    // Refresh Buttons
    el.btnRefreshShifts.addEventListener("click", () => loadShifts(true));
    el.btnRefreshMetrics.addEventListener("click", () => loadMetrics(true));

    // Window global reload for errors
    window.fairshiftReload = () => loadSectorData();
  }

  // Application Entry Point
  document.addEventListener("DOMContentLoaded", () => {
    setupEventListeners();
    loadSectorData();
  });
})();

