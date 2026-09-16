/**
 * Main Application Logic & UI Handler
 * Supports Trainees, Employees, Purchases, Notifications, Check-In Requests, Security Gate,
 * Custom In-App Deletions, American Date Formatting, Task Delegation, and 2-Stage Onboarding.
 */

const ACCESS_PASSWORD = "Legacy#Vault8492!";
const AUTH_STORAGE_KEY = "legacy_portal_auth_v2";

document.addEventListener("DOMContentLoaded", async () => {
  // Invalidate any previous sessions from old password
  localStorage.removeItem("legacy_portal_auth_v1");
  sessionStorage.removeItem("legacy_portal_auth_v1");

  // --- SECURITY GATE AUTHENTICATION ---
  const authGate = document.getElementById("auth-gate");
  const authForm = document.getElementById("auth-form");
  const authPasswordInput = document.getElementById("auth-password");
  const authError = document.getElementById("auth-error");
  const btnTogglePw = document.getElementById("btn-toggle-pw");
  const btnLockPortal = document.getElementById("btn-lock-portal");

  function checkAuth() {
    const isAuth = sessionStorage.getItem(AUTH_STORAGE_KEY) === "true" || localStorage.getItem(AUTH_STORAGE_KEY) === "true";
    if (isAuth) {
      authGate.classList.add("unlocked");
    } else {
      authGate.classList.remove("unlocked");
      if (authPasswordInput) authPasswordInput.focus();
    }
  }

  // Handle Login Form Submit
  authForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const entered = authPasswordInput.value.trim();
    if (entered === ACCESS_PASSWORD) {
      sessionStorage.setItem(AUTH_STORAGE_KEY, "true");
      localStorage.setItem(AUTH_STORAGE_KEY, "true");
      authError.style.display = "none";
      authGate.classList.add("unlocked");
      authPasswordInput.value = "";
    } else {
      authError.style.display = "block";
      authPasswordInput.value = "";
      authPasswordInput.focus();
    }
  });

  // Toggle Password Visibility
  btnTogglePw.addEventListener("click", () => {
    if (authPasswordInput.type === "password") {
      authPasswordInput.type = "text";
      btnTogglePw.textContent = "🙈";
    } else {
      authPasswordInput.type = "password";
      btnTogglePw.textContent = "👁️";
    }
  });

  // Lock Portal Button
  btnLockPortal.addEventListener("click", () => {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(AUTH_STORAGE_KEY);
    authError.style.display = "none";
    authGate.classList.remove("unlocked");
    authPasswordInput.value = "";
    authPasswordInput.focus();
  });

  // Check initial authentication
  checkAuth();

  // Initialize Data Store
  await window.store.init();

  // State Management
  let currentTab = "trainees"; // "trainees" | "employees" | "purchases" | "archived"
  let searchQuery = "";
  let responsivenessFilter = "all"; // "all" | "green" | "yellow" | "red" | "onboarding"
  let trainerFilter = "all";
  let positionFilter = "all";
  let activeRecordId = null;
  const selectedRecordIds = new Set();
  let filteredRecordsCache = [];

  // DOM Elements
  const tabTraineesBtn = document.getElementById("tab-trainees");
  const tabEmployeesBtn = document.getElementById("tab-employees");
  const tabInterviewsBtn = document.getElementById("tab-interviews");
  const tabOutreachBtn = document.getElementById("tab-outreach");
  const tabPurchasesBtn = document.getElementById("tab-purchases");
  const tabArchivedBtn = document.getElementById("tab-archived");
  const btnOutreachAllLaunch = document.getElementById("btn-outreach-all-launch");
  const btnAddInterview = document.getElementById("btn-add-interview");
  const interviewModal = document.getElementById("interview-modal");
  const interviewForm = document.getElementById("interview-form");
  const convertTraineeModal = document.getElementById("convert-trainee-modal");
  const btnConfirmConvertTrainee = document.getElementById("btn-confirm-convert-trainee");
  let activeConvertCandidateId = null;

  const searchInput = document.getElementById("search-input");
  const responsivenessSelect = document.getElementById("filter-responsiveness");
  const trainerSelect = document.getElementById("filter-trainer");
  const positionSelect = document.getElementById("filter-position");
  const btnClearArchived = document.getElementById("btn-clear-archived");

  const recordsTableHead = document.getElementById("records-thead");
  const recordsTableBody = document.getElementById("records-tbody");
  const tableTitle = document.getElementById("table-title");
  const tableCountBadge = document.getElementById("table-count-badge");

  // Cloud Sync Elements
  const btnCloudSync = document.getElementById("btn-cloud-sync");
  const cloudSyncText = document.getElementById("cloud-sync-text");
  const cloudSyncIcon = document.getElementById("cloud-sync-icon");

  // Stat Counters
  const countTraineesEl = document.getElementById("stat-trainees-count");
  const countEmployeesEl = document.getElementById("stat-employees-count");
  const countInterviewsEl = document.getElementById("stat-interviews-count");
  const countPurchasesEl = document.getElementById("stat-purchases-count");
  const countYellowEl = document.getElementById("stat-yellow-count");
  const countRedEl = document.getElementById("stat-red-count");
  const countArchivedEl = document.getElementById("stat-archived-count");

  // Notification Elements
  const notifBellBtn = document.getElementById("btn-notif-bell");
  const notifBadge = document.getElementById("notif-badge");
  const notifDrawer = document.getElementById("notif-drawer");
  const notifList = document.getElementById("notif-list");
  const notifCountText = document.getElementById("notif-count-text");

  // Payment Schedule Elements
  const paymentScheduleList = document.getElementById("payment-schedule-list");
  const btnAddInstallment = document.getElementById("btn-add-installment");

  // Custom In-App Confirmation Modal Handlers
  const confirmModal = document.getElementById("confirm-modal");
  let confirmCallback = null;

  function showConfirmModal(title, message, confirmText, onConfirm) {
    document.getElementById("confirm-modal-title").textContent = title || "⚠️ Confirm Action";
    document.getElementById("confirm-modal-message").textContent = message;
    document.getElementById("btn-confirm-execute").textContent = confirmText || "Confirm";
    confirmCallback = onConfirm;
    openModal(confirmModal);
  }

  document.getElementById("btn-confirm-execute").addEventListener("click", async () => {
    if (confirmCallback) {
      await confirmCallback();
      confirmCallback = null;
    }
    closeModal(confirmModal);
  });

  // Cloud Sync Status Update
  function updateCloudSyncBadge(status = "synced") {
    if (!window.store.isServerlessAvailable) {
      cloudSyncIcon.textContent = "💻";
      cloudSyncText.textContent = "Local Mode";
      btnCloudSync.style.opacity = "0.7";
      return;
    }

    if (status === "syncing") {
      cloudSyncIcon.textContent = "🔄";
      cloudSyncText.textContent = "Syncing...";
    } else if (status === "synced") {
      cloudSyncIcon.textContent = "☁️";
      cloudSyncText.textContent = "Cloud Synced";
      btnCloudSync.style.opacity = "1";
    }
  }

  // Manual Cloud Sync Trigger
  btnCloudSync.addEventListener("click", async () => {
    updateCloudSyncBadge("syncing");
    const changed = await window.store.syncWithCloud();
    updateCloudSyncBadge("synced");
    if (changed) {
      render();
    }
  });

  // Background Cloud Polling (Every 10s + Window Focus)
  setInterval(async () => {
    if (window.store.isServerlessAvailable) {
      const changed = await window.store.syncWithCloud();
      if (changed) {
        render();
      }
    }
  }, 10000);

  window.addEventListener("focus", async () => {
    if (window.store.isServerlessAvailable) {
      const changed = await window.store.syncWithCloud();
      if (changed) {
        render();
      }
    }
  });

  // Notification Bell Toggle
  notifBellBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    notifDrawer.classList.toggle("show");
  });

  document.addEventListener("click", (e) => {
    if (!notifDrawer.contains(e.target) && !notifBellBtn.contains(e.target)) {
      notifDrawer.classList.remove("show");
    }
  });

  // Stat Cards (clickable to filter)
  document.getElementById("card-trainees").addEventListener("click", () => switchTab("trainees"));
  document.getElementById("card-employees").addEventListener("click", () => switchTab("employees"));
  document.getElementById("card-purchases").addEventListener("click", () => switchTab("purchases"));
  document.getElementById("card-yellow").addEventListener("click", () => {
    responsivenessSelect.value = "yellow";
    responsivenessFilter = "yellow";
    render();
  });
  document.getElementById("card-red").addEventListener("click", () => {
    responsivenessSelect.value = "red";
    responsivenessFilter = "red";
    render();
  });
  document.getElementById("card-archived").addEventListener("click", () => switchTab("archived"));

  // Filters
  searchInput.addEventListener("input", (e) => {
    searchQuery = e.target.value.toLowerCase();
    render();
  });

  responsivenessSelect.addEventListener("change", (e) => {
    responsivenessFilter = e.target.value;
    render();
  });

  trainerSelect.addEventListener("change", (e) => {
    trainerFilter = e.target.value;
    render();
  });

  positionSelect.addEventListener("change", (e) => {
    positionFilter = e.target.value;
    render();
  });

  // Tab switching
  tabTraineesBtn.addEventListener("click", () => switchTab("trainees"));
  tabEmployeesBtn.addEventListener("click", () => switchTab("employees"));
  if (tabInterviewsBtn) tabInterviewsBtn.addEventListener("click", () => switchTab("interviews"));
  if (tabOutreachBtn) tabOutreachBtn.addEventListener("click", () => switchTab("outreach"));
  tabPurchasesBtn.addEventListener("click", () => switchTab("purchases"));
  tabArchivedBtn.addEventListener("click", () => switchTab("archived"));

  function switchTab(tab) {
    currentTab = tab;
    selectedRecordIds.clear();
    [tabTraineesBtn, tabEmployeesBtn, tabInterviewsBtn, tabOutreachBtn, tabPurchasesBtn, tabArchivedBtn].forEach(btn => {
      if (btn) btn.classList.remove("active");
    });
    if (tab === "trainees" && tabTraineesBtn) tabTraineesBtn.classList.add("active");
    if (tab === "employees" && tabEmployeesBtn) tabEmployeesBtn.classList.add("active");
    if (tab === "interviews" && tabInterviewsBtn) tabInterviewsBtn.classList.add("active");
    if (tab === "outreach" && tabOutreachBtn) tabOutreachBtn.classList.add("active");
    if (tab === "purchases" && tabPurchasesBtn) tabPurchasesBtn.classList.add("active");
    if (tab === "archived" && tabArchivedBtn) tabArchivedBtn.classList.add("active");

    render();
  }

  // Quick Launch All Outreach Button
  if (btnOutreachAllLaunch) {
    btnOutreachAllLaunch.addEventListener("click", () => {
      if (!filteredRecordsCache || filteredRecordsCache.length === 0) {
        alert("No employees in current outreach list.");
        return;
      }
      filteredRecordsCache.forEach(r => selectedRecordIds.add(r.id));
      updateBulkActionBar();
      openAIOutreachModal(Array.from(selectedRecordIds));
    });
  }

  // Stat Card Quick Navigation
  const cardTrainees = document.getElementById("card-trainees");
  const cardEmployees = document.getElementById("card-employees");
  const cardInterviews = document.getElementById("card-interviews");
  const cardPurchases = document.getElementById("card-purchases");
  const cardYellow = document.getElementById("card-yellow");
  const cardRed = document.getElementById("card-red");
  const cardArchived = document.getElementById("card-archived");

  if (cardTrainees) cardTrainees.addEventListener("click", () => switchTab("trainees"));
  if (cardEmployees) cardEmployees.addEventListener("click", () => switchTab("employees"));
  if (cardInterviews) cardInterviews.addEventListener("click", () => switchTab("interviews"));
  if (cardPurchases) cardPurchases.addEventListener("click", () => switchTab("purchases"));
  if (cardYellow) cardYellow.addEventListener("click", () => switchTab("outreach"));
  if (cardRed) cardRed.addEventListener("click", () => switchTab("outreach"));
  if (cardArchived) cardArchived.addEventListener("click", () => switchTab("archived"));

  // Populate Filter Dropdowns
  function updateFilterOptions() {
    const allRecords = window.store.getAllRecords();

    const defaultTrainers = [
      "Aiden Rosenski",
      "Damilare Lawal",
      "Damon",
      "Dontreal Strong",
      "Nasya Aiden G. Del Rosario",
      "Samvel",
      "Seifeldin Gaber"
    ];
    const extractedTrainers = [];
    allRecords.forEach(r => {
      if (r.trainer) extractedTrainers.push(r.trainer.trim());
      if (r.manager) r.manager.split(/[,&/]+/).forEach(m => extractedTrainers.push(m.trim()));
      if (r.promotionalManager) r.promotionalManager.split(/[,&/]+/).forEach(m => extractedTrainers.push(m.trim()));
      if (r.soldBy) r.soldBy.split(/[,&/]+/).forEach(s => extractedTrainers.push(s.trim()));
    });
    const trainers = Array.from(new Set([...defaultTrainers, ...extractedTrainers.filter(Boolean)])).sort();

    const defaultPositions = [
      "Talent Manager",
      "Lead Coordinator",
      "Video Editor",
      "Graphic Designer",
      "Promotional Services",
      "Video Editing Services",
      "Other"
    ];
    const extractedPositions = allRecords.map(r => r.position || r.service).filter(Boolean);
    const positions = Array.from(new Set([...defaultPositions, ...extractedPositions])).sort();

    const currentTrainer = trainerSelect.value;
    const currentPosition = positionSelect.value;

    trainerSelect.innerHTML = `<option value="all">All Trainers / Managers</option>` +
      trainers.map(t => `<option value="${t}">${t}</option>`).join("");
    trainerSelect.value = currentTrainer || "all";

    positionSelect.innerHTML = `<option value="all">All Roles / Services</option>` +
      positions.map(p => `<option value="${p}">${p}</option>`).join("");
    positionSelect.value = currentPosition || "all";
  }

  // Render Stats Counters
  function renderStats() {
    const allRecords = window.store.getAllRecords();
    const trainees = allRecords.filter(r => r.type === "trainee");
    const employees = allRecords.filter(r => r.type === "employee");
    const purchases = allRecords.filter(r => r.type === "purchase");
    const archived = allRecords.filter(r => r.type === "archived");
    const interviews = allRecords.filter(r => r.type === "interview");

    const yellowCount = allRecords.filter(r => r.type !== "archived" && r.responsiveness === "yellow").length;
    const redCount = allRecords.filter(r => r.type !== "archived" && r.responsiveness === "red").length;

    countTraineesEl.textContent = trainees.length;
    countEmployeesEl.textContent = employees.length;
    if (countInterviewsEl) countInterviewsEl.textContent = interviews.length;
    countPurchasesEl.textContent = purchases.length;
    countYellowEl.textContent = yellowCount;
    countRedEl.textContent = redCount;
    countArchivedEl.textContent = archived.length;

    document.getElementById("badge-trainees-count").textContent = trainees.length;
    document.getElementById("badge-employees-count").textContent = employees.length;
    const badgeInterviews = document.getElementById("badge-interviews-count");
    if (badgeInterviews) badgeInterviews.textContent = interviews.length;
    document.getElementById("badge-purchases-count").textContent = purchases.length;
    document.getElementById("badge-archived-count").textContent = archived.length;

    const needsOutreach = window.store.getNeedsOutreach();
    const badgeOutreach = document.getElementById("badge-outreach-count");
    if (badgeOutreach) {
      badgeOutreach.textContent = needsOutreach.length;
      if (needsOutreach.length > 0) {
        badgeOutreach.style.background = "#ef4444";
        badgeOutreach.style.color = "#ffffff";
      } else {
        badgeOutreach.style.background = "var(--badge-bg)";
        badgeOutreach.style.color = "var(--text-muted)";
      }
    }

    // Show/Hide Clear All Archived button
    if (currentTab === "archived" && archived.length > 0) {
      btnClearArchived.style.display = "inline-flex";
    } else {
      btnClearArchived.style.display = "none";
    }
  }

  // Notification Engine with Priority Sorting
  function evaluateNotifications() {
    const allRecords = window.store.getAllRecords();
    const today = new Date();
    const notifications = [];

    allRecords.forEach(r => {
      if (r.type === "archived") return;

      // High Priority Check-In Requests
      if (r.checkInRequest) {
        notifications.push({
          id: r.id,
          type: "request",
          recordType: r.type,
          title: `📢 Check-In Requested: ${r.name || r.clientName}`,
          desc: `Assigned to: ${r.checkInRequest.assignedTo} (Requested by ${r.checkInRequest.requestedBy}). Reason: "${r.checkInRequest.note}"`,
          days: 0,
          priority: 1
        });
      }

      const lastCheckInDate = r.lastCheckIn ? new Date(r.lastCheckIn) : null;
      let daysElapsed = 999;
      if (lastCheckInDate && !isNaN(lastCheckInDate.getTime())) {
        const diffTime = Math.abs(today - lastCheckInDate);
        daysElapsed = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      }

      // Rule 1: Trainees and Employees outreach required (>= 7 days / 1 week)
      if ((r.type === "trainee" || r.type === "employee") && daysElapsed >= 7) {
        notifications.push({
          id: r.id,
          type: "outreach",
          recordType: r.type,
          title: `⏰ 1-Week Outreach Due: ${r.name}`,
          desc: `No check-in recorded for ${daysElapsed} days (Last: ${formatDate(r.lastCheckIn)}). Reach out to this ${r.type}.`,
          days: daysElapsed,
          priority: 3
        });
      }

      // Rule 2: Payment Alerts for Purchases (1 Day Overdue or Due Today)
      if (r.type === "purchase") {
        if (r.paymentSchedule && r.paymentSchedule.length > 0) {
          r.paymentSchedule.forEach(inst => {
            if (inst.status !== "Paid" && inst.dueDate) {
              const dueD = new Date(inst.dueDate + "T00:00:00");
              const currD = new Date(today.toISOString().split("T")[0] + "T00:00:00");
              if (!isNaN(dueD.getTime())) {
                const diffDays = Math.round((currD - dueD) / (1000 * 60 * 60 * 24));
                
                if (diffDays === 0) {
                  notifications.push({
                    id: r.id,
                    type: "payment-due-today",
                    recordType: "purchase",
                    title: `💰 Payment Due Today: ${r.clientName}`,
                    desc: `"${inst.label || 'Payment'}" ($${inst.amount}) is due today (${formatDate(inst.dueDate)}).`,
                    days: 0,
                    priority: 2
                  });
                } else if (diffDays >= 1) {
                  notifications.push({
                    id: r.id,
                    type: "payment-overdue",
                    recordType: "purchase",
                    title: `🚨 Payment Overdue (1+ Day): ${r.clientName}`,
                    desc: `"${inst.label || 'Payment'}" ($${inst.amount}) is ${diffDays} day${diffDays > 1 ? 's' : ''} past due (${formatDate(inst.dueDate)}).`,
                    days: diffDays,
                    priority: 1
                  });
                }
              }
            }
          });
        } else {
          const isPaid = (r.paymentStatus || "").toLowerCase().includes("paid in full");
          if (!isPaid && daysElapsed >= 1) {
            notifications.push({
              id: r.id,
              type: "payment-overdue",
              recordType: "purchase",
              title: `🚨 Payment Overdue: ${r.clientName}`,
              desc: `Payment status "${r.paymentStatus}" unpaid. No check-in logged for ${daysElapsed} days.`,
              days: daysElapsed,
              priority: 1
            });
          }
        }
      }
    });

    notifications.sort((a, b) => (a.priority - b.priority) || (b.days - a.days));

    notifBadge.textContent = notifications.length;
    notifCountText.textContent = `${notifications.length} active alerts`;
    if (notifications.length > 0) {
      notifBadge.classList.add("has-alerts");
    } else {
      notifBadge.classList.remove("has-alerts");
    }

    if (notifications.length === 0) {
      notifList.innerHTML = `<p style="padding:1rem; text-align:center; color:var(--text-muted); font-size:0.85rem;">No active alerts! All check-ins and payments are up to date.</p>`;
    } else {
      notifList.innerHTML = notifications.map(n => {
        let cardClass = "notif-outreach";
        let actionButtons = `
          <button class="btn btn-sm btn-warning" onclick="openCheckInFromNotif('${n.id}', '${n.recordType}')">
            Check In Now
          </button>
        `;

        if (n.type === "request") {
          cardClass = "notif-requested";
          actionButtons = `
            <button class="btn btn-sm btn-purple" onclick="openCheckInFromNotif('${n.id}', '${n.recordType}')">
              Complete Check-In
            </button>
          `;
        } else if (n.type === "payment-due-today") {
          cardClass = "notif-payment-due-today";
          actionButtons = `
            <button class="btn btn-sm btn-primary" onclick="openPaymentsFromNotif('${n.id}')">
              💳 Payments
            </button>
            <button class="btn btn-sm btn-secondary" onclick="openCheckInFromNotif('${n.id}', '${n.recordType}')">
              Check In
            </button>
          `;
        } else if (n.type === "payment-overdue" || n.type === "payment") {
          cardClass = "notif-payment-overdue";
          actionButtons = `
            <button class="btn btn-sm btn-danger" onclick="openPaymentsFromNotif('${n.id}')">
              💳 Payments
            </button>
            <button class="btn btn-sm btn-secondary" onclick="openCheckInFromNotif('${n.id}', '${n.recordType}')">
              Check In
            </button>
          `;
        }

        const daysText = n.days === 0 ? (n.type === 'request' ? '📢 Requested' : 'Today') : `${n.days}d ago`;

        return `
          <div class="notif-item ${cardClass}">
            <div class="notif-title">
              <span>${escapeHtml(n.title)}</span>
              <small style="color:var(--text-muted); font-weight:700;">${daysText}</small>
            </div>
            <div class="notif-desc">${escapeHtml(n.desc)}</div>
            <div style="margin-top:6px; display:flex; gap:0.4rem;">
              ${actionButtons}
            </div>
          </div>
        `;
      }).join("");
    }
  }

  // Open Payments from Notification
  window.openPaymentsFromNotif = (id) => {
    notifDrawer.classList.remove("show");
    switchTab("purchases");
    openQuickPaymentModal(id);
  };

  // Open Check-In from Notification
  window.openCheckInFromNotif = (id, type) => {
    notifDrawer.classList.remove("show");
    if (type === "purchase") {
      switchTab("purchases");
    } else if (type === "employee") {
      switchTab("employees");
    } else {
      switchTab("trainees");
    }
    openCheckInModal(id);
  };

  // Main Render Function
  function render() {
    updateFilterOptions();
    renderStats();
    evaluateNotifications();
    updateCloudSyncBadge("synced");

    let records = [];
    let tabLabel = "Trainees";

    if (currentTab === "trainees") {
      records = window.store.getTrainees();
      tabLabel = "Trainees";
      tableTitle.textContent = "Trainees Directory";
      renderPersonTableHead();
      if (btnOutreachAllLaunch) btnOutreachAllLaunch.style.display = "none";
    } else if (currentTab === "employees") {
      records = window.store.getEmployees();
      tabLabel = "Active Employees";
      tableTitle.textContent = "Active Employees Directory";
      renderPersonTableHead();
      if (btnOutreachAllLaunch) btnOutreachAllLaunch.style.display = "none";
    } else if (currentTab === "interviews") {
      records = window.store.getInterviews();
      tabLabel = "Meetings & Interviews";
      tableTitle.textContent = "📅 Meetings & Interviews Schedule";
      renderInterviewTableHead();
      if (btnOutreachAllLaunch) btnOutreachAllLaunch.style.display = "none";
    } else if (currentTab === "outreach") {
      records = window.store.getNeedsOutreach();
      tabLabel = "Employees Needing Outreach";
      tableTitle.textContent = "⚡ Employees Needing Outreach";
      renderPersonTableHead();
      if (btnOutreachAllLaunch) btnOutreachAllLaunch.style.display = records.length > 0 ? "inline-flex" : "none";
    } else if (currentTab === "purchases") {
      records = window.store.getPurchases();
      tabLabel = "Purchases";
      tableTitle.textContent = "Purchase & Sales Tracker";
      renderPurchaseTableHead();
      if (btnOutreachAllLaunch) btnOutreachAllLaunch.style.display = "none";
    } else if (currentTab === "archived") {
      records = window.store.getArchived();
      tabLabel = "Archived Personnel";
      tableTitle.textContent = "Fired & Removed Personnel Archive";
      renderPersonTableHead();
      if (btnOutreachAllLaunch) btnOutreachAllLaunch.style.display = "none";
    }

    const totalInTab = records.length;

    // Filter Records
    records = records.filter(r => {
      const matchSearch = !searchQuery ||
        (r.name && r.name.toLowerCase().includes(searchQuery)) ||
        (r.clientName && r.clientName.toLowerCase().includes(searchQuery)) ||
        (r.email && r.email.toLowerCase().includes(searchQuery)) ||
        (r.clientEmail && r.clientEmail.toLowerCase().includes(searchQuery)) ||
        (r.purchaseCode && r.purchaseCode.toLowerCase().includes(searchQuery)) ||
        (r.service && r.service.toLowerCase().includes(searchQuery)) ||
        (r.notes && r.notes.toLowerCase().includes(searchQuery)) ||
        (r.manager && r.manager.toLowerCase().includes(searchQuery)) ||
        (r.promotionalManager && r.promotionalManager.toLowerCase().includes(searchQuery)) ||
        (r.soldBy && r.soldBy.toLowerCase().includes(searchQuery)) ||
        (r.assignedEditor && r.assignedEditor.toLowerCase().includes(searchQuery)) ||
        (r.assignedDesigner && r.assignedDesigner.toLowerCase().includes(searchQuery)) ||
        (r.interviewer && r.interviewer.toLowerCase().includes(searchQuery)) ||
        (r.position && r.position.toLowerCase().includes(searchQuery)) ||
        (r.meetingType && r.meetingType.toLowerCase().includes(searchQuery)) ||
        (r.meetingLink && r.meetingLink.toLowerCase().includes(searchQuery)) ||
        (r.forHandle && r.forHandle.toLowerCase().includes(searchQuery));

      let matchResponsiveness = true;
      if (responsivenessFilter === "onboarding") {
        matchResponsiveness = r.trainingStatus === "Needs Onboarding";
      } else if (responsivenessFilter !== "all") {
        matchResponsiveness = r.responsiveness === responsivenessFilter;
      }

      const matchTrainer = trainerFilter === "all" ||
        r.trainer === trainerFilter ||
        (r.interviewer && r.interviewer.toLowerCase().includes(trainerFilter.toLowerCase())) ||
        (r.manager && r.manager.toLowerCase().includes(trainerFilter.toLowerCase())) ||
        (r.promotionalManager && r.promotionalManager.toLowerCase().includes(trainerFilter.toLowerCase())) ||
        (r.soldBy && r.soldBy.toLowerCase().includes(trainerFilter.toLowerCase()));

      let matchPosition = true;
      if (positionFilter !== "all") {
        if (r.type === "purchase") {
          const serviceMatch = r.service && r.service.toLowerCase().includes(positionFilter.toLowerCase());
          const editorMatch = (positionFilter === "Video Editor" || positionFilter === "Video Editing Services") && (Boolean(r.assignedEditor) || (r.service && r.service.toLowerCase().includes("video")));
          const designerMatch = positionFilter === "Graphic Designer" && (Boolean(r.assignedDesigner) || (r.service && r.service.toLowerCase().includes("design")));
          matchPosition = serviceMatch || editorMatch || designerMatch;
        } else {
          matchPosition = r.position === positionFilter ||
            (r.meetingType && r.meetingType.toLowerCase().includes(positionFilter.toLowerCase())) ||
            (r.service && r.service.toLowerCase().includes(positionFilter.toLowerCase()));
        }
      }

      return matchSearch && matchResponsiveness && matchTrainer && matchPosition;
    });

    filteredRecordsCache = records;

    // Update QOL Counter Badge
    if (records.length === totalInTab) {
      tableCountBadge.textContent = `Showing ${records.length} ${tabLabel}`;
    } else {
      tableCountBadge.textContent = `Showing ${records.length} of ${totalInTab} ${tabLabel}`;
    }

    if (records.length === 0) {
      recordsTableBody.innerHTML = `
        <tr>
          <td colspan="5" class="empty-state">
            <h3>No records found</h3>
            <p>Try adjusting your search filters or add a new entry.</p>
          </td>
        </tr>
      `;
      updateBulkActionBar();
      return;
    }

    if (currentTab === "purchases") {
      renderPurchaseTableBody(records);
    } else if (currentTab === "interviews") {
      renderInterviewTableBody(records);
    } else {
      renderPersonTableBody(records);
    }

    // Bind row checkbox events
    document.querySelectorAll(".row-select-item").forEach(cb => {
      cb.addEventListener("change", () => {
        const id = cb.getAttribute("data-id");
        if (cb.checked) {
          selectedRecordIds.add(id);
        } else {
          selectedRecordIds.delete(id);
        }
        updateBulkActionBar();
        const selectAllCb = document.getElementById("th-select-all");
        if (selectAllCb) {
          selectAllCb.checked = filteredRecordsCache.length > 0 && filteredRecordsCache.every(r => selectedRecordIds.has(r.id));
        }
      });
    });

    // Bind select all checkbox
    const selectAllCb = document.getElementById("th-select-all");
    if (selectAllCb) {
      selectAllCb.addEventListener("change", () => {
        if (selectAllCb.checked) {
          filteredRecordsCache.forEach(r => selectedRecordIds.add(r.id));
        } else {
          filteredRecordsCache.forEach(r => selectedRecordIds.delete(r.id));
        }
        render();
      });
    }

    updateBulkActionBar();
  }

  function updateBulkActionBar() {
    const bar = document.getElementById("bulk-action-bar");
    const countEl = document.getElementById("bulk-selected-count");
    if (!bar || !countEl) return;

    const count = selectedRecordIds.size;
    countEl.textContent = count;
    if (count > 0 && (currentTab === "trainees" || currentTab === "employees" || currentTab === "interviews" || currentTab === "outreach" || currentTab === "archived")) {
      bar.style.display = "flex";
    } else {
      bar.style.display = "none";
    }
  }

  // Render Personnel Table Headers (with Row Selection Checkbox)
  function renderPersonTableHead() {
    const isAllSelected = filteredRecordsCache.length > 0 && filteredRecordsCache.every(r => selectedRecordIds.has(r.id));
    recordsTableHead.innerHTML = `
      <tr>
        <th style="width: 38px; text-align:center;">
          <input type="checkbox" id="th-select-all" class="row-select-checkbox" ${isAllSelected ? 'checked' : ''} title="Select All in Current View">
        </th>
        <th style="width: 25%;">Person & Role</th>
        <th style="width: 17%;">Pipeline & Health</th>
        <th style="width: 28%;">Trainer, Activity & Notes</th>
        <th style="width: 28%;">Actions</th>
      </tr>
    `;
  }

  // Render Purchase Table Headers (Clean 4-Column Layout)
  function renderPurchaseTableHead() {
    recordsTableHead.innerHTML = `
      <tr>
        <th style="width: 28%;">Client & Service</th>
        <th style="width: 20%;">Financials & Staff</th>
        <th style="width: 30%;">Contract, Activity & Next Steps</th>
        <th style="width: 22%;">Actions</th>
      </tr>
    `;
  }

  // Render Interview Table Headers
  function renderInterviewTableHead() {
    const isAllSelected = filteredRecordsCache.length > 0 && filteredRecordsCache.every(r => selectedRecordIds.has(r.id));
    recordsTableHead.innerHTML = `
      <tr>
        <th style="width: 38px; text-align:center;">
          <input type="checkbox" id="th-select-all" class="row-select-checkbox" ${isAllSelected ? 'checked' : ''} title="Select All in Current View">
        </th>
        <th style="width: 25%;">Meeting / Candidate & Topic</th>
        <th style="width: 25%;">Schedule, Status & Meet Link</th>
        <th style="width: 25%;">Host / Lead & Contact</th>
        <th style="width: 25%;">Actions</th>
      </tr>
    `;
  }

  // Render Personnel Table Body
  function renderPersonTableBody(records) {
    recordsTableBody.innerHTML = records.map(r => {
      const rowColorClass = `row-${r.responsiveness || 'green'}`;
      const isChecked = selectedRecordIds.has(r.id);
      
      let responsivenessBadge = `<span class="badge badge-green">🟢 Active</span>`;
      if (r.responsiveness === "yellow") {
        responsivenessBadge = `<span class="badge badge-yellow">🟡 Unresponsive</span>`;
      } else if (r.responsiveness === "red") {
        responsivenessBadge = `<span class="badge badge-red">🔴 Fire Risk</span>`;
      }

      // Role badge for editors/designers
      let roleBadge = "";
      if (r.position === "Video Editor") {
        roleBadge = `<span class="badge badge-editor" style="margin-left:4px;">🎬 Video Editor</span>`;
      } else if (r.position === "Graphic Designer") {
        roleBadge = `<span class="badge badge-designer" style="margin-left:4px;">🎨 Designer</span>`;
      }

      // Pipeline badge (In Training, Needs Onboarding, Active, Archived)
      let pipelineBadge = `<span class="badge badge-status">${escapeHtml(r.activeStatus || 'Active')}</span>`;
      if (r.type === 'trainee') {
        if (r.trainingStatus === 'Needs Onboarding') {
          pipelineBadge = `<span class="badge badge-onboarding">📋 Needs Onboarding</span>`;
        } else {
          pipelineBadge = `<span class="badge badge-status">⏳ In Training</span>`;
        }
      } else if (r.type === 'archived') {
        pipelineBadge = `<span class="badge badge-red">${escapeHtml(r.archivedReason || 'Fired / Removed')}</span>`;
      }

      const formattedLastCheckIn = r.lastCheckIn ? formatDate(r.lastCheckIn) : "N/A";
      const checkedInByStr = r.lastCheckedInBy ? ` <span style="color:var(--text-muted)">by ${escapeHtml(r.lastCheckedInBy)}</span>` : "";

      const requestBadge = r.checkInRequest ? `
        <div style="margin-bottom:4px;">
          <span class="badge badge-requested">📢 Requested for ${escapeHtml(r.checkInRequest.assignedTo)}</span>
        </div>
      ` : "";

      return `
        <tr class="${rowColorClass}" data-id="${r.id}">
          <td style="text-align:center;">
            <input type="checkbox" class="row-select-checkbox row-select-item" data-id="${r.id}" ${isChecked ? 'checked' : ''}>
          </td>
          <td>
            <span class="person-name">${escapeHtml(r.name)}</span>
            <span class="person-sub">${escapeHtml(r.position)} ${roleBadge}</span>
            <div style="font-size:0.775rem; margin-top:3px;">
              ${r.email ? `<a href="mailto:${escapeHtml(r.email)}" style="color:var(--primary); text-decoration:none;">${escapeHtml(r.email)}</a>` : ''}
              ${r.phone && r.phone !== 'N/A' ? `<span style="color:var(--text-muted);"> • ${escapeHtml(r.phone)}</span>` : ''}
              ${r.discord && r.discord !== 'N/A' ? `<br><small style="color:var(--text-muted);">Discord: ${escapeHtml(r.discord)}</small>` : ''}
            </div>
          </td>
          <td>
            <div style="margin-bottom:4px;">${pipelineBadge}</div>
            <div>${responsivenessBadge}</div>
          </td>
          <td>
            ${requestBadge}
            <div style="font-size:0.8rem; margin-bottom:3px;">
              <strong>Trainer:</strong> ${escapeHtml(r.trainer || 'N/A')} • 
              <strong>Last Check-In:</strong> ${formattedLastCheckIn}${checkedInByStr}
            </div>
            ${r.notes ? `<div style="font-size:0.775rem; color:var(--text-main); line-clamp: 2; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;" title="${escapeHtml(r.notes)}">${escapeHtml(r.notes)}</div>` : '<em style="font-size:0.75rem; color:var(--text-muted)">No notes yet</em>'}
            ${r.history && r.history.length > 0 ? `<div style="margin-top:2px;"><a href="#" onclick="openHistoryModal('${r.id}'); return false;" style="font-size:0.75rem; color:var(--primary); font-weight:600;">History (${r.history.length})</a></div>` : ''}
          </td>
          <td>
            <div class="action-buttons">
              ${r.type !== 'archived' ? `
                <button class="btn btn-sm btn-secondary" onclick="openAIReportModal('${r.id}')" title="Generate AI Performance Report with LM Studio">
                  🤖 Report
                </button>

                <button class="btn btn-sm btn-success" onclick="openAIOutreachModal(['${r.id}'])" title="Send WhatsApp Message with AI">
                  💬 WhatsApp
                </button>

                <button class="btn btn-sm btn-secondary" onclick="openCheckInModal('${r.id}')" title="Log Check-In">
                  Check In
                </button>

                <button class="btn btn-sm btn-purple" onclick="openRequestCheckInModal('${r.id}')" title="Request Check-In">
                  📢 Request
                </button>

                ${r.type === 'trainee' ? (
                  r.trainingStatus === 'Needs Onboarding' ? `
                    <button class="btn btn-sm btn-success" onclick="promoteRecord('${r.id}')" title="Promote to Active Employee">
                      🎓 Promote
                    </button>
                  ` : `
                    <button class="btn btn-sm btn-warning" onclick="moveToOnboarding('${r.id}')" title="Move to Needs Onboarding">
                      📋 Onboarding
                    </button>
                  `
                ) : ''}

                <button class="btn btn-sm btn-secondary" onclick="openEditModal('${r.id}')" title="Edit Details">
                  Edit
                </button>

                <button class="btn btn-sm btn-danger" onclick="archiveRecordPrompt('${r.id}')" title="Fire or Remove Person">
                  Remove
                </button>
              ` : `
                <button class="btn btn-sm btn-secondary" onclick="openAIReportModal('${r.id}')" title="Generate AI Performance Report">
                  🤖 Report
                </button>

                <button class="btn btn-sm btn-success" onclick="restoreRecord('${r.id}')" title="Restore Person to Active List">
                  Restore
                </button>

                <button class="btn btn-sm btn-danger" onclick="deleteArchivedPermanently('${r.id}')" title="Permanently Delete Person">
                  🗑️ Delete
                </button>
              `}
            </div>
          </td>
        </tr>
      `;
    }).join("");
  }

  // Helper for ordinal numbers (1st, 2nd, 3rd, 4th...)
  function getOrdinalNumber(n) {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // Render Purchase Table Body (Clean 4-Column Layout, No Sideways Scrollbar)
  function renderPurchaseTableBody(records) {
    recordsTableBody.innerHTML = records.map(r => {
      const rowColorClass = `row-${r.responsiveness || 'green'}`;
      
      let paymentBadges = `<span class="badge badge-green">🟢 Paid in full</span>`;
      
      if (r.paymentSchedule && r.paymentSchedule.length > 0) {
        let paidAmt = 0;
        let unpaidAmt = 0;
        let dueAmt = 0;
        r.paymentSchedule.forEach(inst => {
          const a = parseFloat(inst.amount) || 0;
          if (inst.status === "Paid") paidAmt += a;
          else if (inst.status === "Unpaid") unpaidAmt += a;
          else dueAmt += a;
        });

        if (unpaidAmt > 0 && dueAmt > 0) {
          paymentBadges = `
            <div style="display:flex; flex-direction:column; gap:2px; margin-top:2px;">
              <span class="badge badge-red">🔴 Unpaid: $${unpaidAmt}</span>
              <span class="badge badge-yellow">🟡 Due: $${dueAmt}</span>
            </div>
          `;
        } else if (unpaidAmt > 0) {
          paymentBadges = `<div style="margin-top:2px;"><span class="badge badge-red">🔴 Unpaid: $${unpaidAmt}</span></div>`;
        } else if (dueAmt > 0) {
          paymentBadges = `<div style="margin-top:2px;"><span class="badge badge-yellow">🟡 Due: $${dueAmt}</span></div>`;
        } else if (paidAmt > 0) {
          paymentBadges = `<div style="margin-top:2px;"><span class="badge badge-green">🟢 Paid in full</span></div>`;
        }
      } else {
        const isPaid = (r.paymentStatus || "").toLowerCase().includes("paid in full");
        if (isPaid) {
          paymentBadges = `<div style="margin-top:2px;"><span class="badge badge-green">🟢 ${escapeHtml(r.paymentStatus || 'Paid in full')}</span></div>`;
        } else if ((r.paymentStatus || "").toLowerCase().includes("unpaid")) {
          paymentBadges = `<div style="margin-top:2px;"><span class="badge badge-red">🔴 ${escapeHtml(r.paymentStatus)}</span></div>`;
        } else {
          paymentBadges = `<div style="margin-top:2px;"><span class="badge badge-yellow">🟡 ${escapeHtml(r.paymentStatus || 'Due')}</span></div>`;
        }
      }

      const formattedLastCheckIn = r.lastCheckIn ? formatDate(r.lastCheckIn) : "N/A";
      const checkedInByStr = r.lastCheckedInBy ? ` <span style="color:var(--text-muted)">by ${escapeHtml(r.lastCheckedInBy)}</span>` : "";

      const contractLink = r.contract && r.contract !== "N/A" ? 
        `<a href="${escapeHtml(r.contract)}" target="_blank" style="color:var(--primary); font-size:0.775rem; font-weight:600; text-decoration:underline;">📄 Contract</a>` : 
        `<span style="color:var(--text-muted); font-size:0.75rem;">No Contract</span>`;

      const requestBadge = r.checkInRequest ? `
        <div style="margin-bottom:4px;">
          <span class="badge badge-requested">📢 Requested for ${escapeHtml(r.checkInRequest.assignedTo)}</span>
        </div>
      ` : "";

      const rawManagers = r.manager || r.promotionalManager || "";
      const managerList = rawManagers.split(/[,&/]+/).map(m => m.trim()).filter(Boolean);
      const managerBadges = managerList.length > 0 ?
        managerList.map(m => `<span class="badge badge-status" style="font-size:0.7rem; background:#ede9fe; color:#5b21b6; border-color:#ddd6fe;">Mgr: ${escapeHtml(m)}</span>`).join(" ") :
        "";

      return `
        <tr class="${rowColorClass}" data-id="${r.id}">
          <td>
            <span class="person-name">${escapeHtml(r.clientName)}</span>
            <div style="font-size:0.8rem; font-weight:600; color:var(--text-main);">${escapeHtml(r.service || 'N/A')}</div>
            <div style="font-size:0.75rem; color:var(--text-muted); font-family:monospace; margin-top:2px;">
              ${escapeHtml(r.purchaseCode || 'N/A')}
              ${r.clientEmail ? `<br><a href="mailto:${escapeHtml(r.clientEmail)}" style="color:var(--primary);">${escapeHtml(r.clientEmail)}</a>` : ''}
            </div>
          </td>
          <td>
            <div style="font-size:1.05rem; font-weight:bold; color:var(--text-main);">${escapeHtml(r.amountDue || '$0')}</div>
            ${paymentBadges}
            <div style="margin-top:3px; display:flex; flex-direction:column; gap:2px;">
              ${r.soldBy && r.soldBy !== 'N/A' ? `<span class="badge badge-soldby">Sold By: ${escapeHtml(r.soldBy)}</span>` : ''}
              ${managerBadges}
              ${r.forHandle ? `<span class="badge badge-status" style="font-size:0.7rem;">For: ${escapeHtml(r.forHandle)}</span>` : ''}
            </div>
          </td>
          <td>
            ${requestBadge}
            <div style="font-size:0.775rem; margin-bottom:3px;">
              <strong>Check-In:</strong> ${formattedLastCheckIn}${checkedInByStr} • ${contractLink}
            </div>
            ${r.assignedEditor ? `
              <div style="margin-bottom:2px;">
                <span class="badge badge-editor">🎬 Editor: ${escapeHtml(r.assignedEditor)}</span>
                ${r.editorTask ? `<small style="color:var(--text-muted); font-size:0.725rem;"> (${escapeHtml(r.editorTask)})</small>` : ''}
              </div>
            ` : ''}
            ${r.assignedDesigner ? `
              <div style="margin-bottom:2px;">
                <span class="badge badge-designer">🎨 Designer: ${escapeHtml(r.assignedDesigner)}</span>
                ${r.designerTask ? `<small style="color:var(--text-muted); font-size:0.725rem;"> (${escapeHtml(r.designerTask)})</small>` : ''}
              </div>
            ` : ''}
            ${r.nextActionItem ? `<div style="font-size:0.775rem; font-weight:600; color:#1e293b; margin-top:2px;">Next: ${escapeHtml(r.nextActionItem)}</div>` : ''}
            ${r.history && r.history.length > 0 ? `<div style="margin-top:2px;"><a href="#" onclick="openHistoryModal('${r.id}'); return false;" style="font-size:0.75rem; color:var(--primary); font-weight:600;">History (${r.history.length})</a></div>` : ''}
          </td>
          <td>
            <div class="action-buttons">
              <button class="btn btn-sm btn-success" onclick="openQuickPaymentModal('${r.id}')" title="Manage Payment Dates & Statuses">
                💳 Payments
              </button>
              <button class="btn btn-sm btn-secondary" onclick="openCheckInModal('${r.id}')" title="Log Check-In">
                Check In
              </button>
              <button class="btn btn-sm btn-purple" onclick="openRequestCheckInModal('${r.id}')" title="Request Check-In">
                📢 Request
              </button>
              <button class="btn btn-sm btn-secondary" onclick="openEditPurchaseModal('${r.id}')" title="Edit Purchase">
                Edit
              </button>
              <button class="btn btn-sm btn-danger" onclick="deleteRecordPrompt('${r.id}')" title="Delete Purchase">
                Delete
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  }

  // Render Interview Table Body
  function renderInterviewTableBody(records) {
    recordsTableBody.innerHTML = records.map(r => {
      const isSelected = selectedRecordIds.has(r.id);
      const rowColor = r.responsiveness || "green";

      // Format Interview Date
      let formattedDate = "Not scheduled";
      if (r.interviewDate) {
        try {
          const d = new Date(r.interviewDate);
          formattedDate = d.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          });
        } catch (e) {
          formattedDate = r.interviewDate;
        }
      }

      // Status Badge Style
      let statusBadgeColor = "badge-status";
      if (r.interviewStatus === "Passed") statusBadgeColor = "badge-role-designer";
      else if (r.interviewStatus === "Completed") statusBadgeColor = "badge-role-editor";
      else if (r.interviewStatus === "Rejected" || r.interviewStatus === "No Show" || r.interviewStatus === "Cancelled") statusBadgeColor = "badge-role-talent";

      const cleanPhone = (r.phone || "").replace(/[^0-9]/g, "");
      const waLink = cleanPhone ? `https://wa.me/${cleanPhone}` : null;
      const portfolioUrl = r.portfolioUrl ? r.portfolioUrl : null;
      const meetingLink = (r.meetingLink || "").trim();
      const meetingType = r.meetingType || "Candidate Interview";

      let typeBadge = `<span class="badge" style="background:#ede9fe; color:#5b21b6; border:1px solid #ddd6fe; font-size:0.725rem;">🎓 Candidate Interview</span>`;
      if (meetingType === "Client Meeting") {
        typeBadge = `<span class="badge" style="background:#ecfdf5; color:#065f46; border:1px solid #a7f3d0; font-size:0.725rem;">💼 Client Meeting</span>`;
      } else if (meetingType === "Team / Internal Meeting") {
        typeBadge = `<span class="badge" style="background:#fef3c7; color:#92400e; border:1px solid #fde68a; font-size:0.725rem;">👥 Team Meeting</span>`;
      } else if (meetingType === "General Meeting") {
        typeBadge = `<span class="badge" style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1; font-size:0.725rem;">📅 Meeting</span>`;
      }

      return `
        <tr class="status-${rowColor} ${isSelected ? 'row-selected' : ''}">
          <td style="text-align:center;">
            <input type="checkbox" class="row-select-item" data-id="${r.id}" ${isSelected ? 'checked' : ''}>
          </td>
          <td>
            <div style="font-weight: 700; color: var(--text-main); font-size: 0.95rem;">
              ${escapeHtml(r.name)}
            </div>
            <div style="display:flex; align-items:center; gap:0.4rem; margin-top:0.25rem; flex-wrap:wrap;">
              ${typeBadge}
              <span class="badge badge-role-manager" style="font-size:0.75rem;">${escapeHtml(r.position || 'Topic / Role')}</span>
              ${portfolioUrl ? `
                <a href="${escapeHtml(portfolioUrl)}" target="_blank" rel="noopener noreferrer" class="badge" style="background:#e0f2fe; color:#0369a1; text-decoration:none; font-size:0.7rem;">
                  🔗 Docs / Drive
                </a>
              ` : ''}
            </div>
            ${r.notes ? `
              <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.35rem; max-width:320px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(r.notes)}">
                📝 ${escapeHtml(r.notes)}
              </div>
            ` : ''}
          </td>

          <td>
            <div style="font-weight: 600; color: var(--text-main); font-size: 0.85rem;">
              📅 ${escapeHtml(formattedDate)}
            </div>
            <div style="margin-top: 0.3rem; display:flex; align-items:center; gap:0.35rem; flex-wrap:wrap;">
              <span class="badge ${statusBadgeColor}" style="font-size:0.75rem;">
                ${escapeHtml(r.interviewStatus || 'Scheduled')}
              </span>
            </div>
            ${meetingLink ? `
              <div style="margin-top: 0.45rem;">
                <a href="${escapeHtml(meetingLink)}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-meet" style="font-size:0.75rem; padding:3px 9px;" title="Join Google Meet / Meeting Call">
                  🎥 Join Google Meet
                </a>
              </div>
            ` : `
              <div style="margin-top: 0.35rem;">
                <button class="btn btn-sm btn-secondary" onclick="openInterviewModal('${r.id}')" style="font-size:0.7rem; padding:2px 7px; color:var(--text-muted); opacity:0.85;" title="Attach Google Meet Link">
                  + Add Meet Link
                </button>
              </div>
            `}
          </td>

          <td>
            <div style="font-size: 0.85rem; color: var(--text-main); font-weight: 600;">
              👤 Host: ${escapeHtml(r.interviewer || 'Management')}
            </div>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.2rem;">
              ✉️ ${escapeHtml(r.email || 'No email')}
            </div>
            ${r.phone ? `
              <div style="margin-top: 0.2rem; display:flex; align-items:center; gap:0.35rem;">
                <span style="font-size:0.8rem; color:var(--text-muted);">📞 ${escapeHtml(r.phone)}</span>
                ${waLink ? `
                  <a href="${waLink}" target="_blank" class="badge" style="background:#dcfce7; color:#15803d; text-decoration:none; font-size:0.7rem;" title="Chat on WhatsApp">
                    💬 WhatsApp
                  </a>
                ` : ''}
              </div>
            ` : ''}
          </td>

          <td>
            <div style="display:flex; gap:0.35rem; flex-wrap:wrap; align-items:center;">
              ${(meetingType === "Candidate Interview" || !r.meetingType) ? `
                <button class="btn btn-sm btn-success" onclick="openConvertTraineeModal('${r.id}')" title="Passed candidate interview? Convert directly to Trainee">
                  🎓 Convert to Trainee
                </button>
              ` : ''}
              <button class="btn btn-sm btn-secondary" onclick="openInterviewModal('${r.id}')" title="Edit Meeting Details">
                ✏️ Edit
              </button>
              <button class="btn btn-sm btn-danger" onclick="archiveRecord('${r.id}')" title="Archive Meeting">
                📁 Archive
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  }

  // --- PAYMENT SCHEDULE BUILDER & QUICK MANAGER ---

  function renderInstallmentRows(schedule = []) {
    paymentScheduleList.innerHTML = schedule.map((inst, index) => `
      <div class="installment-item-row" data-index="${index}">
        <input type="text" class="inst-label" value="${escapeHtml(inst.label || '')}" placeholder="Label (e.g. 1st Payment)">
        <input type="number" step="0.01" class="inst-amount" value="${inst.amount || 0}" placeholder="Amount ($)">
        <input type="date" class="inst-date" value="${inst.dueDate || ''}">
        <select class="inst-status">
          <option value="Paid" ${inst.status === 'Paid' ? 'selected' : ''}>🟢 Paid</option>
          <option value="Due" ${inst.status === 'Due' ? 'selected' : ''}>🟡 Due</option>
          <option value="Unpaid" ${inst.status === 'Unpaid' ? 'selected' : ''}>🔴 Unpaid</option>
        </select>
        <button type="button" class="btn btn-sm btn-danger btn-remove-inst" style="padding:2px 6px;">&times;</button>
      </div>
    `).join("");

    paymentScheduleList.querySelectorAll(".btn-remove-inst").forEach(btn => {
      btn.addEventListener("click", () => {
        btn.closest(".installment-item-row").remove();
      });
    });
  }

  btnAddInstallment.addEventListener("click", () => {
    const nextNum = paymentScheduleList.children.length + 1;
    const labelText = `${getOrdinalNumber(nextNum)} Payment`;
    const newRow = document.createElement("div");
    newRow.className = "installment-item-row";
    newRow.innerHTML = `
      <input type="text" class="inst-label" value="${labelText}" placeholder="Label">
      <input type="number" step="0.01" class="inst-amount" value="25.00" placeholder="Amount ($)">
      <input type="date" class="inst-date" value="${new Date().toISOString().split("T")[0]}">
      <select class="inst-status">
        <option value="Paid">🟢 Paid</option>
        <option value="Due" selected>🟡 Due</option>
        <option value="Unpaid">🔴 Unpaid</option>
      </select>
      <button type="button" class="btn btn-sm btn-danger btn-remove-inst" style="padding:2px 6px;">&times;</button>
    `;
    newRow.querySelector(".btn-remove-inst").addEventListener("click", () => newRow.remove());
    paymentScheduleList.appendChild(newRow);
  });

  function getScheduleFromForm() {
    const rows = paymentScheduleList.querySelectorAll(".installment-item-row");
    const schedule = [];
    rows.forEach((row, i) => {
      schedule.push({
        id: "ps-" + (i + 1) + "-" + Date.now(),
        label: row.querySelector(".inst-label").value || `${getOrdinalNumber(i + 1)} Payment`,
        amount: parseFloat(row.querySelector(".inst-amount").value) || 0,
        dueDate: row.querySelector(".inst-date").value,
        status: row.querySelector(".inst-status").value
      });
    });
    return schedule;
  }

  const paymentScheduleModal = document.getElementById("payment-schedule-modal");

  window.openQuickPaymentModal = (id) => {
    const record = window.store.getRecordById(id);
    if (!record || record.type !== "purchase") return;

    activeRecordId = id;
    document.getElementById("payment-client-name").textContent = record.clientName;
    renderQuickPaymentList(record);
    openModal(paymentScheduleModal);
  };

  function renderQuickPaymentList(record) {
    const schedule = record.paymentSchedule || [];

    let totalVal = 0;
    let paidVal = 0;
    let unpaidVal = 0;
    let dueVal = 0;

    schedule.forEach(inst => {
      const amt = parseFloat(inst.amount) || 0;
      totalVal += amt;
      if (inst.status === "Paid") {
        paidVal += amt;
      } else if (inst.status === "Unpaid") {
        unpaidVal += amt;
      } else {
        dueVal += amt;
      }
    });

    document.getElementById("summary-total-amount").textContent = `$${totalVal.toFixed(2)}`;
    document.getElementById("summary-paid-amount").textContent = `$${paidVal.toFixed(2)}`;
    
    let dueSummaryHtml = `$${(unpaidVal + dueVal).toFixed(2)}`;
    if (unpaidVal > 0 && dueVal > 0) {
      dueSummaryHtml = `<span style="color:var(--status-red-text); font-weight:700;">Unpaid: $${unpaidVal.toFixed(2)}</span> &bull; <span style="color:var(--status-yellow-text); font-weight:700;">Due: $${dueVal.toFixed(2)}</span>`;
    } else if (unpaidVal > 0) {
      dueSummaryHtml = `<span style="color:var(--status-red-text); font-weight:700;">Unpaid: $${unpaidVal.toFixed(2)}</span>`;
    } else if (dueVal > 0) {
      dueSummaryHtml = `<span style="color:var(--status-yellow-text); font-weight:700;">Due: $${dueVal.toFixed(2)}</span>`;
    }
    document.getElementById("summary-due-amount").innerHTML = dueSummaryHtml;

    const listEl = document.getElementById("quick-payment-list");
    if (schedule.length === 0) {
      listEl.innerHTML = `<p style="text-align:center; color:var(--text-muted); padding:1rem;">No payment schedule set for this purchase. Edit purchase to add payment milestones.</p>`;
      return;
    }

    listEl.innerHTML = schedule.map(inst => `
      <div class="quick-installment-item">
        <div>
          <strong>${escapeHtml(inst.label || 'Payment')}</strong> - 
          <span style="font-weight:700;">$${parseFloat(inst.amount || 0).toFixed(2)}</span>
          <br><small style="color:var(--text-muted);">Due: ${formatDate(inst.dueDate)}</small>
        </div>
        <div class="status-pill-group">
          <button class="status-pill-btn ${inst.status === 'Paid' ? 'active-paid' : ''}" onclick="toggleInstallment('${record.id}', '${inst.id}', 'Paid')">
            🟢 Paid
          </button>
          <button class="status-pill-btn ${inst.status === 'Due' ? 'active-due' : ''}" onclick="toggleInstallment('${record.id}', '${inst.id}', 'Due')">
            🟡 Due
          </button>
          <button class="status-pill-btn ${inst.status === 'Unpaid' ? 'active-unpaid' : ''}" onclick="toggleInstallment('${record.id}', '${inst.id}', 'Unpaid')">
            🔴 Unpaid
          </button>
        </div>
      </div>
    `).join("");
  }

  window.toggleInstallment = async (purchaseId, installmentId, newStatus) => {
    const updated = await window.store.toggleInstallmentStatus(purchaseId, installmentId, newStatus);
    if (updated) {
      renderQuickPaymentList(updated);
      render();
    }
  };

  // American Date Formatting (MM/DD/YYYY)
  function formatDate(dateStr) {
    if (!dateStr || dateStr === "N/A") return "N/A";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
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

  // --- MODAL HANDLERS ---
  const personModal = document.getElementById("person-modal");
  const purchaseModal = document.getElementById("purchase-modal");
  const checkinModal = document.getElementById("checkin-modal");
  const requestCheckinModal = document.getElementById("request-checkin-modal");
  const historyModal = document.getElementById("history-modal");
  const backupModal = document.getElementById("backup-modal");

  const personForm = document.getElementById("person-form");
  const purchaseForm = document.getElementById("purchase-form");
  const checkinForm = document.getElementById("checkin-form");
  const requestCheckinForm = document.getElementById("request-checkin-form");

  // --- LIVE DUPLICATE DETECTION FOR EMPLOYEES & TRAINEES ---
  const duplicateAlertBox = document.getElementById("person-duplicate-alert");
  const fieldNameInput = document.getElementById("field-name");
  const fieldEmailInput = document.getElementById("field-email");
  const fieldPhoneInput = document.getElementById("field-phone");
  const fieldDiscordInput = document.getElementById("field-discord");

  function checkPersonDuplicates() {
    const personId = document.getElementById("person-id").value;
    const personData = {
      name: fieldNameInput.value,
      email: fieldEmailInput.value,
      phone: fieldPhoneInput.value,
      discord: fieldDiscordInput.value
    };

    const matches = window.store.findDuplicates(personData, personId || null);

    if (matches.length > 0) {
      duplicateAlertBox.style.display = "block";
      duplicateAlertBox.innerHTML = `
        <div class="duplicate-alert-header">
          <span>⚠️ Potential Duplicate Person Detected (${matches.length})</span>
        </div>
        <div>A person with matching details already exists in the system:</div>
        ${matches.map(m => {
          const r = m.record;
          const roleLabel = r.type === 'employee' ? 'Active Employee' : (r.type === 'trainee' ? 'Trainee' : 'Archived / Fired');
          return `
            <div class="duplicate-matched-item">
              <div>
                <strong>${escapeHtml(r.name)}</strong> - <span class="badge badge-status">${escapeHtml(roleLabel)}</span>
                <br><small style="color:#b45309;">${m.reasons.join(" • ")}</small>
                ${r.trainer ? `<br><small style="color:var(--text-muted);">Trainer: ${escapeHtml(r.trainer)}</small>` : ''}
              </div>
              <button type="button" class="btn btn-sm btn-secondary" onclick="openEditModal('${r.id}')">
                View / Edit Existing
              </button>
            </div>
          `;
        }).join("")}
      `;
      return matches;
    } else {
      duplicateAlertBox.style.display = "none";
      duplicateAlertBox.innerHTML = "";
      return [];
    }
  }

  // Live input listeners for duplicate detection
  [fieldNameInput, fieldEmailInput, fieldPhoneInput, fieldDiscordInput].forEach(input => {
    if (input) {
      input.addEventListener("input", checkPersonDuplicates);
      input.addEventListener("blur", checkPersonDuplicates);
    }
  });

  // Open Add Person Modal
  document.getElementById("btn-add-person").addEventListener("click", () => {
    activeRecordId = null;
    document.getElementById("person-modal-title").textContent = "Add New Person";
    personForm.reset();
    document.getElementById("person-id").value = "";
    document.getElementById("field-start-date").value = new Date().toISOString().split("T")[0];
    if (duplicateAlertBox) {
      duplicateAlertBox.style.display = "none";
      duplicateAlertBox.innerHTML = "";
    }
    openModal(personModal);
  });

  // Open Add Purchase Modal
  document.getElementById("btn-add-purchase").addEventListener("click", () => {
    activeRecordId = null;
    document.getElementById("purchase-modal-title").textContent = "Add New Purchase Record";
    purchaseForm.reset();
    document.getElementById("purchase-id").value = "";
    document.getElementById("field-purchase-date").value = new Date().toISOString().split("T")[0];
    renderInstallmentRows([
      { label: "1st Payment", amount: 100.00, dueDate: new Date().toISOString().split("T")[0], status: "Paid" }
    ]);
    openModal(purchaseModal);
  });

  // Edit Person
  window.openEditModal = (id) => {
    const record = window.store.getRecordById(id);
    if (!record) return;

    activeRecordId = id;
    document.getElementById("person-modal-title").textContent = `Edit ${record.name}`;
    document.getElementById("person-id").value = record.id;
    document.getElementById("field-name").value = record.name || "";
    document.getElementById("field-type").value = record.type || "trainee";
    document.getElementById("field-position").value = record.position || "Talent Manager";
    document.getElementById("field-trainer").value = record.trainer || "";
    document.getElementById("field-start-date").value = record.startDate || "";
    document.getElementById("field-email").value = record.email || "";
    document.getElementById("field-phone").value = record.phone || "";
    document.getElementById("field-discord").value = record.discord || "";
    document.getElementById("field-responsiveness").value = record.responsiveness || "green";
    document.getElementById("field-expected-completion").value = record.expectedCompletion || "";
    document.getElementById("field-notes").value = record.notes || "";

    if (duplicateAlertBox) {
      duplicateAlertBox.style.display = "none";
      duplicateAlertBox.innerHTML = "";
    }

    openModal(personModal);
  };

  // Edit Purchase
  window.openEditPurchaseModal = (id) => {
    const record = window.store.getRecordById(id);
    if (!record) return;

    activeRecordId = id;
    document.getElementById("purchase-modal-title").textContent = `Edit Purchase: ${record.clientName}`;
    document.getElementById("purchase-id").value = record.id;
    document.getElementById("field-purchase-code").value = record.purchaseCode || "";
    document.getElementById("field-client-name").value = record.clientName || "";
    document.getElementById("field-client-email").value = record.clientEmail || "";
    document.getElementById("field-service").value = record.service || "";
    document.getElementById("field-sold-by").value = record.soldBy || "";
    document.getElementById("field-manager").value = record.manager || record.promotionalManager || "";
    document.getElementById("field-purchase-date").value = record.purchaseDate || "";
    document.getElementById("field-purchase-color").value = record.responsiveness || "green";
    document.getElementById("field-contract").value = record.contract || "";
    document.getElementById("field-for-handle").value = record.forHandle || "";
    document.getElementById("field-assigned-editor").value = record.assignedEditor || "";
    document.getElementById("field-editor-task").value = record.editorTask || "";
    document.getElementById("field-assigned-designer").value = record.assignedDesigner || "";
    document.getElementById("field-designer-task").value = record.designerTask || "";
    document.getElementById("field-next-action").value = record.nextActionItem || "";
    document.getElementById("field-purchase-notes").value = record.notes || "";

    renderInstallmentRows(record.paymentSchedule || []);

    openModal(purchaseModal);
  };

  // Save Person Form with Duplicate Check Safeguard
  personForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("person-id").value;
    const formData = {
      name: document.getElementById("field-name").value,
      type: document.getElementById("field-type").value,
      position: document.getElementById("field-position").value,
      trainer: document.getElementById("field-trainer").value,
      startDate: document.getElementById("field-start-date").value,
      email: document.getElementById("field-email").value,
      phone: document.getElementById("field-phone").value,
      discord: document.getElementById("field-discord").value,
      responsiveness: document.getElementById("field-responsiveness").value,
      expectedCompletion: document.getElementById("field-expected-completion").value,
      notes: document.getElementById("field-notes").value,
      lastCheckedInBy: "Manager"
    };

    // If new record, check for duplicates before saving
    if (!id) {
      const duplicates = window.store.findDuplicates(formData);
      if (duplicates.length > 0) {
        const topMatch = duplicates[0];
        showConfirmModal(
          "⚠️ Duplicate Person Detected",
          `"${topMatch.record.name}" is already listed in the database as a ${topMatch.record.type} (matched: ${topMatch.reasons.join(", ")}). Are you sure you want to create a duplicate record?`,
          "Yes, Create Duplicate",
          async () => {
            await window.store.addRecord(formData);
            closeModal(personModal);
            render();
          }
        );
        return;
      }
    }

    if (id) {
      await window.store.updateRecord(id, formData);
    } else {
      await window.store.addRecord(formData);
    }

    closeModal(personModal);
    render();
  });

  // Save Purchase Form
  purchaseForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const schedule = getScheduleFromForm();

    let totalAmount = 0;
    let paidAmount = 0;
    let unpaidAmount = 0;
    let dueAmount = 0;
    let hasOverdue = false;
    const todayStr = new Date().toISOString().split("T")[0];

    schedule.forEach(item => {
      const val = parseFloat(item.amount) || 0;
      totalAmount += val;
      if (item.status === "Paid") {
        paidAmount += val;
      } else if (item.status === "Unpaid") {
        unpaidAmount += val;
        if (item.dueDate && item.dueDate < todayStr) {
          hasOverdue = true;
        }
      } else {
        dueAmount += val;
        if (item.dueDate && item.dueDate < todayStr) {
          hasOverdue = true;
        }
      }
    });

    let autoPaymentStatus = "Paid in full";
    let autoResponsiveness = "green";
    if (unpaidAmount > 0 && dueAmount > 0) {
      autoPaymentStatus = `Unpaid $${unpaidAmount} | Due $${dueAmount}`;
      autoResponsiveness = "red";
    } else if (unpaidAmount > 0) {
      autoPaymentStatus = `Unpaid $${unpaidAmount}`;
      autoResponsiveness = "red";
    } else if (dueAmount > 0) {
      autoPaymentStatus = `Due $${dueAmount}`;
      autoResponsiveness = hasOverdue ? "red" : "yellow";
    }

    const managerVal = document.getElementById("field-manager").value;
    const formData = {
      type: "purchase",
      purchaseCode: document.getElementById("field-purchase-code").value || "N/A",
      clientName: document.getElementById("field-client-name").value,
      name: document.getElementById("field-client-name").value,
      clientEmail: document.getElementById("field-client-email").value,
      email: document.getElementById("field-client-email").value,
      service: document.getElementById("field-service").value,
      amountDue: `$${totalAmount}`,
      paymentStatus: autoPaymentStatus,
      purchaseDate: document.getElementById("field-purchase-date").value,
      responsiveness: document.getElementById("field-purchase-color").value || autoResponsiveness,
      contract: document.getElementById("field-contract").value,
      forHandle: document.getElementById("field-for-handle").value,
      soldBy: document.getElementById("field-sold-by").value,
      manager: managerVal,
      promotionalManager: managerVal,
      assignedEditor: document.getElementById("field-assigned-editor").value,
      editorTask: document.getElementById("field-editor-task").value,
      assignedDesigner: document.getElementById("field-assigned-designer").value,
      designerTask: document.getElementById("field-designer-task").value,
      nextActionItem: document.getElementById("field-next-action").value,
      notes: document.getElementById("field-purchase-notes").value,
      paymentSchedule: schedule,
      lastCheckedInBy: "Manager"
    };

    const id = document.getElementById("purchase-id").value;
    if (id) {
      await window.store.updateRecord(id, formData);
    } else {
      await window.store.addRecord(formData);
    }

    closeModal(purchaseModal);
    render();
  });

  // --- INTERVIEWS & CANDIDATE PIPELINE ---

  // Open Interview Modal
  window.openInterviewModal = (id) => {
    const titleEl = document.getElementById("interview-modal-title");
    const saveBtn = document.getElementById("btn-save-interview");
    const idInput = document.getElementById("interview-id");

    if (id) {
      const record = window.store.getRecordById(id);
      if (!record) return;

      titleEl.textContent = `Edit Meeting / Interview: ${record.name}`;
      saveBtn.textContent = "Save Changes";
      idInput.value = id;

      const typeSelect = document.getElementById("field-meeting-type");
      if (typeSelect) typeSelect.value = record.meetingType || "Candidate Interview";

      document.getElementById("field-candidate-name").value = record.name || "";
      document.getElementById("field-candidate-position").value = record.position || "";
      document.getElementById("field-candidate-interviewer").value = record.interviewer || "Aiden Rosenski";
      document.getElementById("field-interview-date").value = record.interviewDate || "";
      document.getElementById("field-interview-status").value = record.interviewStatus || "Scheduled";

      const linkInput = document.getElementById("field-meeting-link");
      if (linkInput) linkInput.value = record.meetingLink || "";

      document.getElementById("field-candidate-email").value = record.email || "";
      document.getElementById("field-candidate-phone").value = record.phone || "";
      document.getElementById("field-candidate-portfolio").value = record.portfolioUrl || "";
      document.getElementById("field-candidate-color").value = record.responsiveness || "green";
      document.getElementById("field-candidate-notes").value = record.notes || "";
    } else {
      titleEl.textContent = "Schedule Meeting / Interview";
      saveBtn.textContent = "Schedule Meeting";
      idInput.value = "";
      if (interviewForm) interviewForm.reset();

      const typeSelect = document.getElementById("field-meeting-type");
      if (typeSelect) typeSelect.value = "Candidate Interview";

      document.getElementById("field-candidate-interviewer").value = "Aiden Rosenski";
      document.getElementById("field-interview-status").value = "Scheduled";

      const linkInput = document.getElementById("field-meeting-link");
      if (linkInput) linkInput.value = "";

      document.getElementById("field-candidate-color").value = "green";

      const d = new Date();
      d.setHours(d.getHours() + 1, 0, 0, 0);
      const pad = (n) => String(n).padStart(2, '0');
      const localIso = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      document.getElementById("field-interview-date").value = localIso;
    }

    openModal(interviewModal);
  };

  if (btnAddInterview) {
    btnAddInterview.addEventListener("click", () => {
      openInterviewModal();
    });
  }

  if (interviewForm) {
    interviewForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("interview-id").value;
      const typeSelect = document.getElementById("field-meeting-type");
      const linkInput = document.getElementById("field-meeting-link");

      const formData = {
        type: "interview",
        meetingType: typeSelect ? typeSelect.value : "Candidate Interview",
        name: document.getElementById("field-candidate-name").value.trim(),
        position: document.getElementById("field-candidate-position").value.trim(),
        interviewer: document.getElementById("field-candidate-interviewer").value,
        interviewDate: document.getElementById("field-interview-date").value,
        interviewStatus: document.getElementById("field-interview-status").value,
        meetingLink: linkInput ? linkInput.value.trim() : "",
        email: document.getElementById("field-candidate-email").value.trim(),
        phone: document.getElementById("field-candidate-phone").value.trim(),
        portfolioUrl: document.getElementById("field-candidate-portfolio").value.trim(),
        responsiveness: document.getElementById("field-candidate-color").value,
        notes: document.getElementById("field-candidate-notes").value.trim()
      };

      if (id) {
        await window.store.updateRecord(id, formData);
      } else {
        await window.store.addRecord(formData);
      }

      closeModal(interviewModal);
      if (currentTab !== "interviews") {
        switchTab("interviews");
      } else {
        render();
      }
    });
  }

  // Convert Candidate to Trainee Modal
  window.openConvertTraineeModal = (id) => {
    const record = window.store.getRecordById(id);
    if (!record) return;

    activeConvertCandidateId = id;
    document.getElementById("convert-candidate-name").textContent = record.name;
    document.getElementById("convert-assigned-trainer").value = record.interviewer || "Aiden Rosenski";
    openModal(convertTraineeModal);
  };

  if (btnConfirmConvertTrainee) {
    btnConfirmConvertTrainee.addEventListener("click", async () => {
      if (!activeConvertCandidateId) return;
      const trainer = document.getElementById("convert-assigned-trainer").value;
      const record = window.store.getRecordById(activeConvertCandidateId);
      const name = record ? record.name : "Candidate";

      await window.store.convertToTrainee(activeConvertCandidateId, trainer);
      closeModal(convertTraineeModal);
      activeConvertCandidateId = null;

      switchTab("trainees");
      alert(`🎉 ${name} has been successfully converted into an active Trainee under ${trainer}!`);
    });
  }

  // Open Check-in Modal
  window.openCheckInModal = (id) => {
    const record = window.store.getRecordById(id);
    if (!record) return;

    activeRecordId = id;
    document.getElementById("checkin-person-name").textContent = record.name || record.clientName;
    document.getElementById("checkin-date").value = new Date().toISOString().split("T")[0];
    document.getElementById("checkin-by").value = record.lastCheckedInBy || record.trainer || record.manager || "Manager";
    document.getElementById("checkin-responsiveness").value = record.responsiveness || "green";
    document.getElementById("checkin-note").value = "";

    const purchaseGroup = document.getElementById("group-purchase-checkin-fields");
    if (record.type === "purchase") {
      purchaseGroup.style.display = "block";
      document.getElementById("checkin-manager").value = record.manager || record.promotionalManager || "Nasya Aiden G. Del Rosario";
      document.getElementById("checkin-sold-by").value = record.soldBy || "Damilare Lawal";
    } else {
      purchaseGroup.style.display = "none";
    }

    openModal(checkinModal);
  };

  // Submit Check-in Form
  checkinForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!activeRecordId) return;

    const record = window.store.getRecordById(activeRecordId);
    const checkedInBy = document.getElementById("checkin-by").value;
    const noteText = document.getElementById("checkin-note").value;
    const responsiveness = document.getElementById("checkin-responsiveness").value;
    
    let manager = null;
    let soldBy = null;
    if (record && record.type === "purchase") {
      manager = document.getElementById("checkin-manager").value;
      soldBy = document.getElementById("checkin-sold-by").value;
    }

    await window.store.addCheckIn(activeRecordId, checkedInBy, noteText, responsiveness, manager, soldBy);
    closeModal(checkinModal);
    render();
  });

  // Request Check-In Modal
  window.openRequestCheckInModal = (id) => {
    const record = window.store.getRecordById(id);
    if (!record) return;

    activeRecordId = id;
    document.getElementById("request-target-name").textContent = record.name || record.clientName;
    document.getElementById("request-record-id").value = id;
    document.getElementById("request-assigned-to").value = record.trainer || record.manager || record.promotionalManager || "Aiden Rosenski";
    document.getElementById("request-by-name").value = "Manager";
    document.getElementById("request-note").value = "";

    openModal(requestCheckinModal);
  };

  requestCheckinForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("request-record-id").value;
    const assignedTo = document.getElementById("request-assigned-to").value;
    const requestedBy = document.getElementById("request-by-name").value;
    const note = document.getElementById("request-note").value;

    await window.store.requestCheckIn(id, assignedTo, note, requestedBy);
    closeModal(requestCheckinModal);
    render();
  });

  // 2-STAGE ONBOARDING & PROMOTION WORKFLOW
  window.moveToOnboarding = async (id) => {
    await window.store.moveToOnboarding(id);
    render();
  };

  window.promoteRecord = async (id) => {
    await window.store.promoteToEmployee(id);
    render();
  };

  // IN-APP CONFIRMATION ACTIONS (ZERO BROWSER POPUPS)
  window.archiveRecordPrompt = (id) => {
    const record = window.store.getRecordById(id);
    showConfirmModal(
      "⚠️ Remove / Fire Person",
      `Are you sure you want to remove ${record ? record.name : "this person"} and move them to the Fired & Removed archive?`,
      "Yes, Remove",
      async () => {
        await window.store.archiveRecord(id, "Removed / Fired");
        render();
      }
    );
  };

  window.restoreRecord = async (id) => {
    await window.store.restoreRecord(id);
    render();
  };

  window.deleteRecordPrompt = (id) => {
    const record = window.store.getRecordById(id);
    showConfirmModal(
      "🗑️ Delete Purchase Record",
      `Are you sure you want to permanently delete the purchase for ${record ? record.clientName : "this client"}? This action cannot be undone.`,
      "Yes, Delete",
      async () => {
        await window.store.deletePermanently(id);
        render();
      }
    );
  };

  // Permanent Delete for Archived Records (with in-app modal)
  window.deleteArchivedPermanently = (id) => {
    const record = window.store.getRecordById(id);
    showConfirmModal(
      "🗑️ Permanently Delete Record",
      `Are you sure you want to permanently delete ${record ? record.name : "this person"} from the system? They will be completely erased.`,
      "Yes, Delete Forever",
      async () => {
        await window.store.deletePermanently(id);
        render();
      }
    );
  };

  // Clear All Archived Button Handler (with in-app modal)
  btnClearArchived.addEventListener("click", () => {
    showConfirmModal(
      "🗑️ Clear All Fired Records",
      "Are you sure you want to permanently delete ALL records from the Fired & Removed list? This action cannot be undone.",
      "Yes, Purge All",
      async () => {
        await window.store.clearArchivedRecords();
        render();
      }
    );
  });

  // Open History / Notes Modal
  window.openHistoryModal = (id) => {
    const record = window.store.getRecordById(id);
    if (!record) return;

    document.getElementById("history-person-name").textContent = record.name || record.clientName;
    const historyList = document.getElementById("history-list");

    if (!record.history || record.history.length === 0) {
      historyList.innerHTML = `<p style="color:var(--text-muted)">No previous check-in notes logged.</p>`;
    } else {
      historyList.innerHTML = record.history.map(item => `
        <div class="timeline-item">
          <div class="timeline-meta">
            <span>By: ${escapeHtml(item.author || 'Manager')}</span>
            <span>${formatDate(item.date)}</span>
          </div>
          <div>${escapeHtml(item.note)}</div>
        </div>
      `).join("");
    }

    openModal(historyModal);
  };

  // Modal Open / Close Helpers
  function openModal(modal) {
    modal.classList.add("show");
  }

  function closeModal(modal) {
    modal.classList.remove("show");
  }

  document.querySelectorAll(".close-btn, .btn-close-modal").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".modal-backdrop").forEach(m => closeModal(m));
    });
  });

  // Render Rolling Snapshots List
  function renderSnapshotList() {
    const listEl = document.getElementById("snapshot-history-list");
    if (!listEl) return;

    const snapshots = window.store.getSnapshots();
    if (snapshots.length === 0) {
      listEl.innerHTML = `<p style="color:var(--text-muted); font-size:0.775rem; text-align:center; padding:0.5rem;">No snapshots recorded yet.</p>`;
      return;
    }

    listEl.innerHTML = snapshots.map(s => `
      <div class="snapshot-item">
        <div class="snapshot-meta">
          <span class="snapshot-title">${escapeHtml(s.reason)} (${s.count} records)</span>
          <span class="snapshot-time">${new Date(s.timestamp).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>
        </div>
        <button type="button" class="btn btn-sm btn-secondary" onclick="rollbackToSnapshot('${s.id}')" title="Restore this exact version of your database">
          ↩️ Restore
        </button>
      </div>
    `).join("");
  }

  window.rollbackToSnapshot = (snapshotId) => {
    const snapshots = window.store.getSnapshots();
    const snap = snapshots.find(s => s.id === snapshotId);
    if (!snap) return;

    showConfirmModal(
      "↩️ Restore Backup Snapshot",
      `Are you sure you want to restore the snapshot from "${snap.reason}" (${snap.count} records, saved at ${new Date(snap.timestamp).toLocaleTimeString()})? Current state will be replaced with this snapshot.`,
      "Yes, Restore Snapshot",
      async () => {
        const success = await window.store.restoreSnapshot(snapshotId);
        if (success) {
          closeModal(backupModal);
          render();
        }
      }
    );
  };

  // Backup & Data Sync Modal (Protected with Admin Password: RINADMIN123)
  const CLOUD_DB_ADMIN_PASSWORD = "RINADMIN123";

  document.getElementById("btn-backup").addEventListener("click", () => {
    const entered = prompt("🔒 Admin Access Required for Cloud DB.\nPlease enter the Admin Password:");
    if (entered === null) return; // User clicked Cancel

    if (entered.trim() !== CLOUD_DB_ADMIN_PASSWORD) {
      alert("❌ Access Denied: Incorrect Admin Password.");
      return;
    }

    const statusTextEl = document.getElementById("modal-cloud-status-text");
    if (window.store.isServerlessAvailable) {
      statusTextEl.textContent = "🟢 Neon PostgreSQL Database Connected (Ohio us-east-2)";
      statusTextEl.style.color = "var(--status-green-text)";
    } else {
      statusTextEl.textContent = "🟡 Running in Local Storage Mode (Offline / Local Dev)";
      statusTextEl.style.color = "var(--status-yellow-text)";
    }
    renderSnapshotList();
    openModal(backupModal);
  });

  // Force Push Local to Cloud
  document.getElementById("btn-force-push").addEventListener("click", async () => {
    const btn = document.getElementById("btn-force-push");
    btn.textContent = "Uploading...";
    btn.disabled = true;
    const ok = await window.store.forcePushToCloud();
    btn.disabled = false;
    btn.textContent = "⬆️ Push Local Data to Cloud";
    if (ok) {
      alert("Successfully force-pushed all records to Neon PostgreSQL Database!");
      render();
    } else {
      alert("Cloud push completed. Note: If running locally without Netlify CLI, data is saved in local cache.");
    }
  });

  // Force Pull Fresh Data from Cloud
  document.getElementById("btn-force-pull").addEventListener("click", async () => {
    const btn = document.getElementById("btn-force-pull");
    btn.textContent = "Pulling...";
    btn.disabled = true;
    const ok = await window.store.forcePullFromCloud();
    btn.disabled = false;
    btn.textContent = "⬇️ Pull Fresh Cloud Data";
    if (ok) {
      alert("Fresh records successfully pulled from Neon PostgreSQL Database!");
    } else {
      alert("Cloud sync check completed!");
    }
    render();
  });

  document.getElementById("btn-export-json").addEventListener("click", () => {
    const jsonStr = window.store.exportJSON();
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Legacy_Management_Backup_${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById("btn-import-json").addEventListener("click", () => {
    const fileInput = document.getElementById("import-file-input");
    fileInput.click();
    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (file) {
        const text = await file.text();
        const success = await window.store.importJSON(text);
        if (success) {
          alert("Data imported successfully!");
          closeModal(backupModal);
          render();
        } else {
          alert("Error importing data. Check file format.");
        }
      }
    };
  });

  document.getElementById("btn-reset-seed").addEventListener("click", async () => {
    if (confirm("Clear all records in the database? You can restore anytime from your JSON backup file or snapshots.")) {
      await window.store.clearDatabase();
      closeModal(backupModal);
      render();
    }
  });

  // ==========================================
  // --- AI HUB & WHATSAPP OUTREACH INTEGRATION ---
  // ==========================================

  const aiOutreachModal = document.getElementById("ai-outreach-modal");
  const aiReportModal = document.getElementById("ai-report-modal");
  const aiSettingsModal = document.getElementById("ai-settings-modal");

  const aiStatusIndicator = document.getElementById("ai-status-indicator");
  const aiEndpointInput = document.getElementById("ai-endpoint-input");
  const aiModalStatusText = document.getElementById("ai-modal-status-text");
  const aiModalModelText = document.getElementById("ai-modal-model-text");

  let currentOutreachRecipients = [];
  let currentReportPersonId = null;

  // --- AI Connection Monitoring ---
  async function refreshAIConnectionUI() {
    if (!aiStatusIndicator) return;
    aiStatusIndicator.textContent = "Checking...";
    aiStatusIndicator.className = "ai-status-pill offline";

    const res = await window.aiService.testConnection();
    if (res.success) {
      aiStatusIndicator.textContent = "🟢 Online";
      aiStatusIndicator.className = "ai-status-pill online";
      aiStatusIndicator.title = `LM Studio Connected (${window.aiService.model})`;

      if (aiModalStatusText) {
        aiModalStatusText.textContent = "🟢 Connected & Active";
        aiModalStatusText.style.color = "#15803d";
      }
      if (aiModalModelText) {
        aiModalModelText.textContent = `Model: ${window.aiService.model || 'LM Studio Local'} • Mode: ${res.mode || 'Connected'}`;
      }
    } else {
      aiStatusIndicator.textContent = "🔴 Offline";
      aiStatusIndicator.className = "ai-status-pill offline";
      aiStatusIndicator.title = "LM Studio offline or tunnel inactive. Click to configure.";

      if (aiModalStatusText) {
        aiModalStatusText.textContent = "🔴 Offline / Tunnel Not Reachable";
        aiModalStatusText.style.color = "#b91c1c";
      }
      if (aiModalModelText) {
        aiModalModelText.textContent = "Endpoint: " + window.aiService.getEndpoint();
      }
    }
  }

  // Open AI Settings Modal
  document.getElementById("btn-ai-hub").addEventListener("click", () => {
    aiEndpointInput.value = window.aiService.getEndpoint();
    refreshAIConnectionUI();
    openModal(aiSettingsModal);
  });

  const btnOpenSettingsFromOutreach = document.getElementById("btn-open-ai-settings-from-outreach");
  if (btnOpenSettingsFromOutreach) {
    btnOpenSettingsFromOutreach.addEventListener("click", () => {
      aiEndpointInput.value = window.aiService.getEndpoint();
      refreshAIConnectionUI();
      openModal(aiSettingsModal);
    });
  }

  // Test AI Connection Button
  document.getElementById("btn-test-ai-connection").addEventListener("click", async () => {
    const newUrl = aiEndpointInput.value;
    window.aiService.setEndpoint(newUrl);
    const btn = document.getElementById("btn-test-ai-connection");
    btn.textContent = "Testing...";
    btn.disabled = true;

    await refreshAIConnectionUI();

    btn.disabled = false;
    btn.textContent = "🔌 Test Connection";
    if (window.aiService.isConnected) {
      alert(`Success! Connected to LM Studio.\nActive Model: ${window.aiService.model}`);
    } else {
      alert(`Could not connect to LM Studio at ${window.aiService.getEndpoint()}.\nPlease check that LM Studio local server and Ngrok are running.`);
    }
  });

  document.getElementById("btn-set-default-ngrok").addEventListener("click", () => {
    aiEndpointInput.value = "https://strangely-disarray-diary.ngrok-free.dev";
    window.aiService.setEndpoint("https://strangely-disarray-diary.ngrok-free.dev");
    refreshAIConnectionUI();
  });

  document.getElementById("btn-set-localhost").addEventListener("click", () => {
    aiEndpointInput.value = "http://localhost:1234";
    window.aiService.setEndpoint("http://localhost:1234");
    refreshAIConnectionUI();
  });

  // --- Bulk Action Bar Buttons ---
  document.getElementById("btn-bulk-deselect").addEventListener("click", () => {
    selectedRecordIds.clear();
    render();
  });

  document.getElementById("btn-bulk-outreach").addEventListener("click", () => {
    if (selectedRecordIds.size === 0) return;
    openAIOutreachModal(Array.from(selectedRecordIds));
  });

  document.getElementById("btn-bulk-reports").addEventListener("click", () => {
    if (selectedRecordIds.size === 0) return;
    const firstId = Array.from(selectedRecordIds)[0];
    openAIReportModal(firstId);
  });

  // --- AI WHATSAPP OUTREACH MODAL ---
  window.openAIOutreachModal = (idsArray) => {
    if (!idsArray || idsArray.length === 0) return;

    currentOutreachRecipients = idsArray
      .map(id => window.store.getRecordById(id))
      .filter(Boolean);

    if (currentOutreachRecipients.length === 0) return;

    document.getElementById("ai-outreach-recipient-count").textContent = currentOutreachRecipients.length;

    // Render chips
    const chipsContainer = document.getElementById("ai-outreach-recipient-chips");
    chipsContainer.innerHTML = currentOutreachRecipients.map(p => {
      const statusIcon = p.responsiveness === "red" ? "🔴" : (p.responsiveness === "yellow" ? "🟡" : "🟢");
      return `
        <span class="recipient-chip" data-id="${p.id}">
          <span>${statusIcon} ${escapeHtml(p.name)}</span>
          <span style="font-size:0.7rem; color:var(--text-muted);">(${escapeHtml(p.position || p.type)})</span>
          <span class="remove-chip" onclick="removeOutreachRecipient('${p.id}')">&times;</span>
        </span>
      `;
    }).join("");

    // Breakdown
    const redCount = currentOutreachRecipients.filter(p => p.responsiveness === "red").length;
    const yellowCount = currentOutreachRecipients.filter(p => p.responsiveness === "yellow").length;
    const onboardingCount = currentOutreachRecipients.filter(p => p.trainingStatus === "Needs Onboarding").length;
    
    const breakdownParts = [];
    if (redCount > 0) breakdownParts.push(`🔴 ${redCount} Critical`);
    if (yellowCount > 0) breakdownParts.push(`🟡 ${yellowCount} Unresponsive`);
    if (onboardingCount > 0) breakdownParts.push(`📋 ${onboardingCount} Onboarding`);
    document.getElementById("ai-outreach-role-breakdown").textContent = breakdownParts.join(" • ");

    // Reset results & progress
    document.getElementById("ai-outreach-results-section").style.display = "none";
    document.getElementById("ai-outreach-cards-list").innerHTML = "";
    document.getElementById("ai-outreach-progress").style.display = "none";

    openModal(aiOutreachModal);
  };

  window.removeOutreachRecipient = (id) => {
    currentOutreachRecipients = currentOutreachRecipients.filter(p => p.id !== id);
    selectedRecordIds.delete(id);
    if (currentOutreachRecipients.length === 0) {
      closeModal(aiOutreachModal);
      render();
      return;
    }
    openAIOutreachModal(currentOutreachRecipients.map(p => p.id));
  };

  // Generate WhatsApp Messages Button
  document.getElementById("btn-generate-outreach").addEventListener("click", async () => {
    if (currentOutreachRecipients.length === 0) {
      alert("Please select at least one recipient.");
      return;
    }

    const promptText = document.getElementById("ai-outreach-prompt").value.trim();
    const tone = document.getElementById("ai-outreach-tone").value;

    const progressEl = document.getElementById("ai-outreach-progress");
    const progressTextEl = document.getElementById("ai-outreach-progress-text");
    const resultsSection = document.getElementById("ai-outreach-results-section");
    const cardsList = document.getElementById("ai-outreach-cards-list");
    const btnGen = document.getElementById("btn-generate-outreach");

    progressEl.style.display = "block";
    resultsSection.style.display = "none";
    btnGen.disabled = true;
    btnGen.textContent = "⏳ Generating...";

    try {
      const results = await window.aiService.generateBulkWhatsAppMessages(
        currentOutreachRecipients,
        promptText,
        tone,
        (current, total, name) => {
          progressTextEl.textContent = `Generating personalized message for ${name} (${current}/${total})...`;
        }
      );

      progressEl.style.display = "none";
      resultsSection.style.display = "block";
      btnGen.disabled = false;
      btnGen.textContent = "✨ Generate Messages";

      document.getElementById("ai-outreach-results-count").textContent = results.length;

      // Initialize Rapid Dispatcher State
      rapidDispatchList = results;
      rapidDispatchIndex = 0;
      updateRapidDispatchUI();

      cardsList.innerHTML = results.map(res => {
        const p = res.person;
        const cleanPhone = (p.phone || "").replace(/\D/g, "");
        const statusBadge = p.responsiveness === "red" 
          ? '<span class="badge badge-red">🔴 Critical</span>'
          : (p.responsiveness === "yellow" ? '<span class="badge badge-yellow">🟡 Unresponsive</span>' : '<span class="badge badge-green">🟢 Active</span>');

        return `
          <div class="outreach-card" id="outreach-card-${p.id}">
            <div class="outreach-card-header">
              <div>
                <strong>${escapeHtml(p.name)}</strong> • <span style="font-size:0.775rem; color:var(--text-muted);">${escapeHtml(p.position || 'Talent Manager')}</span> ${statusBadge}
                ${p.phone && p.phone !== 'N/A' ? `<br><small style="color:var(--text-muted);">📱 ${escapeHtml(p.phone)}</small>` : '<br><small style="color:#ef4444;">⚠️ No Phone Number on file</small>'}
              </div>
              <span style="font-size:0.75rem; color:var(--text-muted);">Trainer: ${escapeHtml(p.trainer || 'Management')}</span>
            </div>

            <textarea class="outreach-card-textarea" id="msg-text-${p.id}">${escapeHtml(res.message)}</textarea>

            <div class="outreach-card-actions">
              <button type="button" class="btn btn-sm btn-secondary" onclick="copyOutreachMessage('${p.id}')" title="Copy message text">
                📋 Copy Text
              </button>

              ${cleanPhone ? `
                <button type="button" class="btn btn-sm btn-success" onclick="launchWhatsApp('${p.id}', '${cleanPhone}')" title="Open directly in WhatsApp">
                  📲 Open in WhatsApp
                </button>
              ` : `
                <button type="button" class="btn btn-sm btn-secondary" disabled title="Add a phone number to enable 1-click WhatsApp">
                  📱 Missing Phone
                </button>
              `}

              <button type="button" class="btn btn-sm btn-primary" onclick="logOutreachCheckIn('${p.id}')" title="Record this outreach into database check-in history">
                ✅ Log Check-In
              </button>
            </div>
          </div>
        `;
      }).join("");

    } catch (e) {
      progressEl.style.display = "none";
      btnGen.disabled = false;
      btnGen.textContent = "✨ Generate Messages";
      alert("Error communicating with LM Studio: " + e.message + "\nPlease make sure your Ngrok tunnel is running.");
    }
  });

  let rapidDispatchList = [];
  let rapidDispatchIndex = 0;

  function updateRapidDispatchUI() {
    const textEl = document.getElementById("rapid-dispatch-target-text");
    const sendBtn = document.getElementById("btn-rapid-send-next");
    const skipBtn = document.getElementById("btn-rapid-skip-next");
    if (!textEl || !sendBtn) return;

    if (!rapidDispatchList || rapidDispatchList.length === 0) {
      textEl.textContent = "No messages generated yet";
      sendBtn.disabled = true;
      if (skipBtn) skipBtn.disabled = true;
      return;
    }

    if (rapidDispatchIndex >= rapidDispatchList.length) {
      textEl.textContent = `🎉 All ${rapidDispatchList.length} messages dispatched & logged!`;
      sendBtn.textContent = "✅ Dispatch Complete";
      sendBtn.disabled = true;
      if (skipBtn) skipBtn.disabled = true;
      return;
    }

    const item = rapidDispatchList[rapidDispatchIndex];
    const p = item.person;
    const cleanPhone = (p.phone || "").replace(/\D/g, "");
    
    textEl.innerHTML = `Next: <strong>${escapeHtml(p.name)}</strong> (${cleanPhone ? `📱 ${escapeHtml(p.phone)}` : '⚠️ Missing Phone'}) &nbsp;<span style="color:#94a3b8;">[${rapidDispatchIndex + 1} of ${rapidDispatchList.length}]</span>`;
    sendBtn.textContent = `📲 Open & Step Next (${rapidDispatchIndex + 1}/${rapidDispatchList.length}) →`;
    sendBtn.disabled = !cleanPhone;
    if (skipBtn) skipBtn.disabled = false;

    // Highlight active card
    document.querySelectorAll(".outreach-card").forEach(c => c.style.outline = "none");
    const activeCard = document.getElementById(`outreach-card-${p.id}`);
    if (activeCard) {
      activeCard.style.outline = "2px solid #3b82f6";
      activeCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  document.getElementById("btn-rapid-send-next").addEventListener("click", () => {
    if (rapidDispatchIndex >= rapidDispatchList.length) return;
    const item = rapidDispatchList[rapidDispatchIndex];
    const p = item.person;
    const cleanPhone = (p.phone || "").replace(/\D/g, "");
    if (!cleanPhone) {
      alert(`No valid phone number for ${p.name}. Skipping.`);
      rapidDispatchIndex++;
      updateRapidDispatchUI();
      return;
    }

    // Launch WhatsApp
    launchWhatsApp(p.id, cleanPhone);

    // Auto log check-in
    logOutreachCheckIn(p.id);

    // Advance
    rapidDispatchIndex++;
    updateRapidDispatchUI();
  });

  document.getElementById("btn-rapid-skip-next").addEventListener("click", () => {
    if (rapidDispatchIndex < rapidDispatchList.length) {
      rapidDispatchIndex++;
      updateRapidDispatchUI();
    }
  });

  window.copyOutreachMessage = (personId) => {
    const textarea = document.getElementById(`msg-text-${personId}`);
    if (textarea) {
      navigator.clipboard.writeText(textarea.value);
      alert("Message copied to clipboard!");
    }
  };

  window.launchWhatsApp = (personId, cleanPhone) => {
    const textarea = document.getElementById(`msg-text-${personId}`);
    const msg = textarea ? textarea.value : "";
    const encoded = encodeURIComponent(msg);
    const waUrl = `https://wa.me/${cleanPhone}?text=${encoded}`;
    window.open(waUrl, "_blank");
  };

  window.logOutreachCheckIn = async (personId) => {
    const textarea = document.getElementById(`msg-text-${personId}`);
    const msg = textarea ? textarea.value : "AI WhatsApp Outreach Sent";
    const person = window.store.getRecordById(personId);
    if (!person) return;

    await window.store.addCheckIn(
      personId,
      "Manager (WhatsApp AI)",
      `📲 Sent WhatsApp Outreach: "${msg.substring(0, 120)}..."`,
      person.responsiveness
    );

    const card = document.getElementById(`outreach-card-${personId}`);
    if (card) {
      card.style.background = "#f0fdf4";
      card.style.borderColor = "#22c55e";
    }
    alert(`Logged outreach check-in for ${person.name}!`);
    render();
  };

  // --- AI EMPLOYEE PERFORMANCE REPORT MODAL ---
  window.openAIReportModal = async (personId) => {
    const person = window.store.getRecordById(personId);
    if (!person) return;

    currentReportPersonId = personId;
    document.getElementById("ai-report-person-name").textContent = person.name;
    document.getElementById("ai-report-person-meta").textContent = `${person.position || 'Talent Manager'} • Trainer: ${person.trainer || 'Management'} • Status: ${person.trainingStatus || 'Active'}`;

    const loadingEl = document.getElementById("ai-report-loading");
    const contentEl = document.getElementById("ai-report-content");

    loadingEl.style.display = "block";
    contentEl.style.display = "none";
    contentEl.textContent = "";

    openModal(aiReportModal);

    try {
      const report = await window.aiService.generateEmployeeReport(person);
      loadingEl.style.display = "none";
      contentEl.style.display = "block";
      contentEl.textContent = report;
    } catch (e) {
      loadingEl.style.display = "none";
      contentEl.style.display = "block";
      contentEl.textContent = `⚠️ Error generating report: ${e.message}\n\nPlease check your LM Studio connection at ${window.aiService.getEndpoint()}.`;
    }
  };

  document.getElementById("btn-regenerate-report").addEventListener("click", () => {
    if (currentReportPersonId) {
      openAIReportModal(currentReportPersonId);
    }
  });

  document.getElementById("btn-copy-report").addEventListener("click", () => {
    const contentEl = document.getElementById("ai-report-content");
    if (contentEl && contentEl.textContent) {
      navigator.clipboard.writeText(contentEl.textContent);
      alert("Performance report copied to clipboard!");
    }
  });

  document.getElementById("btn-save-report-history").addEventListener("click", async () => {
    const contentEl = document.getElementById("ai-report-content");
    if (!currentReportPersonId || !contentEl || !contentEl.textContent) return;

    const person = window.store.getRecordById(currentReportPersonId);
    if (person) {
      await window.store.addCheckIn(
        currentReportPersonId,
        "AI Diagnostic Report",
        `📄 AI Performance Report Generated:\n${contentEl.textContent.substring(0, 300)}...`,
        person.responsiveness
      );
      alert(`Report saved to ${person.name}'s check-in history!`);
      render();
    }
  });

  // Initial Render & Connection Check
  render();
  refreshAIConnectionUI();
});

