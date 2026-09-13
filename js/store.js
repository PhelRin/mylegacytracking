/**
 * Data Storage Engine
 * Handles dual-mode persistence (Netlify Serverless DB / Blobs + LocalStorage fallback)
 * with strict anti-reset protection, timestamp-based record merging, rolling automated snapshots,
 * duplicate detection, check-in request delegation, onboarding pipeline, and task assignments.
 */

const STORAGE_KEY = "legacy_mgmt_records_v2";
const UPDATED_AT_KEY = "legacy_mgmt_updated_at_v2";
const SNAPSHOTS_KEY = "legacy_mgmt_snapshots_v1";
const NETLIFY_API_URL = "/.netlify/functions/db";
const MAX_SNAPSHOTS = 10;

const VAULT_BACKUP_KEY = "legacy_mgmt_vault_backup";

/**
 * Checks if a record is an exact match for the original hardcoded demo entry.
 */
function isLegacyDemoRecord(r) {
  if (!r) return true;
  // Only target the exact old mock demo items if they ever appear
  if (r.id === "tr-1" && r.name === "Tomisin Joseph" && r.notes === "Should be done by tuesday") return true;
  if (r.id === "tr-2" && r.name === "Ayanda Gatsha" && r.notes && r.notes.includes("Completely unresponsive")) return true;
  if (r.clientName === "Acme Corp" && r.purchaseCode === "PUR-2026-0001") return true;
  return false;
}

class DataStore {
  constructor() {
    this.records = [];
    this.lastUpdated = 0;
    this.isServerlessAvailable = false;
    this.lastSyncTime = null;
    this.storageType = "local";
  }

  async init() {
    // 1. Read existing local storage first
    this.lastUpdated = parseInt(localStorage.getItem(UPDATED_AT_KEY) || "0", 10);
    const local = localStorage.getItem(STORAGE_KEY);

    if (local) {
      try {
        const parsed = JSON.parse(local);
        this.records = Array.isArray(parsed) ? parsed.filter(r => !isLegacyDemoRecord(r)) : [];
        this.ensurePaymentSchedules();
      } catch (err) {
        console.error("Failed to parse LocalStorage data", err);
        this.records = [];
      }
    }

    // Fallback: If primary local storage is empty, check vault mirror or v1 cache
    if (this.records.length === 0) {
      const vault = localStorage.getItem(VAULT_BACKUP_KEY) || localStorage.getItem("legacy_mgmt_records_v1");
      if (vault) {
        try {
          const parsedVault = JSON.parse(vault);
          if (Array.isArray(parsedVault) && parsedVault.length > 0) {
            this.records = parsedVault.filter(r => !isLegacyDemoRecord(r));
            this.lastUpdated = Date.now();
            this.ensurePaymentSchedules();
            this.saveToLocal();
            console.log(`Protected recovery: restored ${this.records.length} records from vault backup.`);
          }
        } catch (e) {}
      }
    }

    // 2. Fetch authoritative cloud state from Netlify Functions / Blobs
    try {
      const res = await fetch(NETLIFY_API_URL, { method: "GET" });
      if (res.ok) {
        this.isServerlessAvailable = true;
        const cloudPayload = await res.json();
        const rawCloudData = Array.isArray(cloudPayload) ? cloudPayload : (cloudPayload.records || []);
        const cloudUpdated = cloudPayload.lastUpdated || 0;
        const cloudData = (rawCloudData || []).filter(r => !isLegacyDemoRecord(r));

        if (cloudData.length > 0 && cloudUpdated > this.lastUpdated) {
          // Cloud has newer authoritative non-empty state
          this.records = cloudData;
          this.lastUpdated = cloudUpdated;
          this.ensurePaymentSchedules();
          this.saveToLocal();
          this.createSnapshot("Startup Cloud Sync");
          this.lastSyncTime = new Date();
          this.storageType = cloudPayload.storage || "neon-postgres";
          console.log(`Loaded ${this.records.length} authoritative records from Neon Database.`);
          return this.records;
        } else if (this.records.length > 0 && (cloudData.length === 0 || this.lastUpdated >= cloudUpdated)) {
          // Local has authoritative state, sync local up to cloud
          await this.saveToServerless();
          this.storageType = cloudPayload.storage || "neon-postgres";
          console.log("Synchronized local authoritative state to Neon DB.");
          return this.records;
        } else if (cloudData.length > 0 && this.records.length === 0) {
          // Local was empty, adopt cloud
          this.records = cloudData;
          this.lastUpdated = cloudUpdated || Date.now();
          this.ensurePaymentSchedules();
          this.saveToLocal();
          this.storageType = cloudPayload.storage || "neon-postgres";
          return this.records;
        }
      }
    } catch (e) {
      console.log("Netlify Serverless API offline or not reachable. Running in local mode.", e);
      this.isServerlessAvailable = false;
      this.storageType = "local";
    }

    return this.records;
  }

  /**
   * Syncs latest data from Netlify Cloud Database for multi-browser real-time updates.
   * Strictly avoids overwriting valid local data with an empty cloud response.
   */
  async syncWithCloud() {
    if (!this.isServerlessAvailable) return false;

    try {
      const res = await fetch(NETLIFY_API_URL, { method: "GET" });
      if (res.ok) {
        const cloudPayload = await res.json();
        const rawCloudData = Array.isArray(cloudPayload) ? cloudPayload : (cloudPayload.records || []);
        const cloudUpdated = cloudPayload.lastUpdated || 0;
        const cloudData = (rawCloudData || []).filter(r => !isLegacyDemoRecord(r));

        // ONLY adopt cloud if cloud ACTUALLY has records and is newer!
        if (cloudData.length > 0 && cloudUpdated > this.lastUpdated) {
          const prevJson = JSON.stringify(this.records);
          this.records = cloudData;
          this.lastUpdated = cloudUpdated;
          this.ensurePaymentSchedules();
          this.saveToLocal();
          this.lastSyncTime = new Date();
          const newJson = JSON.stringify(this.records);

          if (prevJson !== newJson) {
            console.log("Live Cloud sync: adopted updated cloud revision.");
            return true;
          }
        } else if (this.records.length > 0 && cloudData.length === 0) {
          // PROTECTION: Cloud was cold or empty, push local state to restore cloud!
          console.log("Cloud was cold/empty, pushing local state to restore cloud.");
          await this.saveToServerless();
        }
      }
    } catch (e) {
      console.warn("Cloud sync fetch failed", e);
    }
    return false;
  }

  // --- AUTOMATED ROLLING SNAPSHOTS ---

  createSnapshot(reason = "Auto Backup") {
    try {
      const existingSnapshots = this.getSnapshots();
      const newSnapshot = {
        id: "snap-" + Date.now(),
        timestamp: new Date().toISOString(),
        reason: reason,
        count: this.records.length,
        data: JSON.parse(JSON.stringify(this.records))
      };

      existingSnapshots.unshift(newSnapshot);
      if (existingSnapshots.length > MAX_SNAPSHOTS) {
        existingSnapshots.splice(MAX_SNAPSHOTS);
      }

      localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(existingSnapshots));
    } catch (e) {
      console.warn("Failed to create snapshot in localStorage", e);
    }
  }

  getSnapshots() {
    try {
      const raw = localStorage.getItem(SNAPSHOTS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  async restoreSnapshot(snapshotId) {
    const snapshots = this.getSnapshots();
    const snap = snapshots.find(s => s.id === snapshotId);
    if (snap && Array.isArray(snap.data)) {
      this.records = snap.data;
      await this.save();
      this.createSnapshot(`Restored from Snapshot (${new Date(snap.timestamp).toLocaleTimeString()})`);
      return true;
    }
    return false;
  }

  // --- AUTOMATIC DUPLICATE SCANNER (FOR EMPLOYEES & TRAINEES) ---

  /**
   * Scans existing personnel for potential duplicates based on Name, Email, Phone, and Discord.
   * Returns an array of matched records and reasons.
   */
  findDuplicates(personData, excludeId = null) {
    if (!personData) return [];

    const normalizeText = (str) => (str || "").toLowerCase().trim().replace(/\s+/g, " ");
    const normalizeDigits = (str) => (str || "").replace(/\D/g, "");

    const inputName = normalizeText(personData.name);
    const inputEmail = normalizeText(personData.email);
    const inputPhoneDigits = normalizeDigits(personData.phone);
    const inputDiscord = normalizeText(personData.discord);

    const matches = [];

    this.records.forEach(r => {
      // Exclude purchase records and the current record being edited
      if (r.type === "purchase" || (excludeId && r.id === excludeId)) return;

      const matchedReasons = [];

      // 1. Name Match
      if (inputName && inputName.length >= 3) {
        const existName = normalizeText(r.name);
        if (existName === inputName) {
          matchedReasons.push(`Matching Name ("${r.name}")`);
        }
      }

      // 2. Email Match
      if (inputEmail && inputEmail.length >= 4 && inputEmail !== "n/a") {
        const existEmail = normalizeText(r.email);
        if (existEmail === inputEmail) {
          matchedReasons.push(`Matching Email ("${r.email}")`);
        }
      }

      // 3. Phone Number Match (compare last 7-10 digits)
      if (inputPhoneDigits && inputPhoneDigits.length >= 7) {
        const existPhoneDigits = normalizeDigits(r.phone);
        if (existPhoneDigits && existPhoneDigits.length >= 7) {
          if (
            existPhoneDigits === inputPhoneDigits ||
            existPhoneDigits.endsWith(inputPhoneDigits.slice(-8)) ||
            inputPhoneDigits.endsWith(existPhoneDigits.slice(-8))
          ) {
            matchedReasons.push(`Matching Phone ("${r.phone}")`);
          }
        }
      }

      // 4. Discord Match
      if (inputDiscord && inputDiscord.length >= 3 && inputDiscord !== "n/a") {
        const existDiscord = normalizeText(r.discord);
        if (existDiscord === inputDiscord) {
          matchedReasons.push(`Matching Discord ("${r.discord}")`);
        }
      }

      if (matchedReasons.length > 0) {
        matches.push({
          record: r,
          reasons: matchedReasons
        });
      }
    });

    return matches;
  }

  ensurePaymentSchedules() {
    let changed = false;
    this.records.forEach(r => {
      if (r.type === "purchase") {
        if (!r.paymentSchedule || !Array.isArray(r.paymentSchedule)) {
          r.paymentSchedule = [];
          changed = true;
        }
        if (!r.manager && r.promotionalManager) {
          r.manager = r.promotionalManager;
          changed = true;
        }
      }
    });

    if (changed) {
      this.saveToLocal();
    }
  }

  getAllRecords() {
    return this.records;
  }

  getTrainees() {
    return this.records.filter(r => r.type === "trainee");
  }

  getEmployees() {
    return this.records.filter(r => r.type === "employee");
  }

  getPurchases() {
    return this.records.filter(r => r.type === "purchase");
  }

  getArchived() {
    return this.records.filter(r => r.type === "archived");
  }

  getInterviews() {
    return this.records.filter(r => r.type === "interview").sort((a, b) => {
      const dateA = a.interviewDate ? new Date(a.interviewDate).getTime() : 0;
      const dateB = b.interviewDate ? new Date(b.interviewDate).getTime() : 0;
      if (dateA && dateB) return dateA - dateB;
      if (dateA) return -1;
      if (dateB) return 1;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });
  }

  async convertToTrainee(id, trainerName = "Aiden Rosenski") {
    const record = this.getRecordById(id);
    if (!record) return null;

    record.type = "trainee";
    record.trainer = trainerName;
    record.trainingStatus = "In Progress";
    record.activeStatus = "Active";
    record.startDate = new Date().toISOString().split("T")[0];
    record.updatedAt = new Date().toISOString();

    if (!Array.isArray(record.history)) {
      record.history = [];
    }
    record.history.push({
      date: new Date().toISOString().split("T")[0],
      author: "Manager",
      note: `🎓 Passed candidate interview and converted to active Trainee (Trainer: ${trainerName}).`
    });

    await this.save();
    return record;
  }

  getNeedsOutreach() {
    const today = new Date();
    return this.records.filter(r => {
      if (r.type !== "trainee" && r.type !== "employee") return false;
      if (r.checkInRequest) return true;
      if (r.responsiveness === "yellow" || r.responsiveness === "red") return true;
      if (!r.lastCheckIn) return true;
      const d = new Date(r.lastCheckIn);
      if (isNaN(d.getTime())) return true;
      const diffDays = Math.floor(Math.abs(today - d) / (1000 * 60 * 60 * 24));
      return diffDays >= 7;
    }).sort((a, b) => {
      const getPriority = (rec) => {
        if (rec.checkInRequest) return 100;
        if (rec.responsiveness === "red") return 80;
        if (rec.responsiveness === "yellow") return 60;
        return 40;
      };
      return getPriority(b) - getPriority(a);
    });
  }

  getRecordById(id) {
    return this.records.find(r => r.id === id);
  }

  async save() {
    this.lastUpdated = Date.now();
    this.saveToLocal();
    this.createSnapshot("User Change Saved");
    if (this.isServerlessAvailable) {
      await this.saveToServerless();
    }
  }

  async saveToServerless() {
    try {
      const res = await fetch(NETLIFY_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          records: this.records,
          lastUpdated: this.lastUpdated || Date.now(),
          timestamp: new Date().toISOString()
        })
      });
      if (res.ok) {
        this.lastSyncTime = new Date();
        return true;
      }
    } catch (e) {
      console.warn("Failed to save to Netlify Serverless DB", e);
    }
    return false;
  }

  saveToLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.records));
      localStorage.setItem(UPDATED_AT_KEY, String(this.lastUpdated || Date.now()));
      if (this.records.length > 0) {
        localStorage.setItem(VAULT_BACKUP_KEY, JSON.stringify(this.records));
      }
    } catch (e) {
      console.warn("Failed to save to localStorage", e);
    }
  }

  async forcePushToCloud() {
    this.lastUpdated = Date.now();
    this.saveToLocal();
    return await this.saveToServerless();
  }

  async forcePullFromCloud() {
    try {
      const res = await fetch(NETLIFY_API_URL, { method: "GET" });
      if (res.ok) {
        const cloudPayload = await res.json();
        const rawCloudData = Array.isArray(cloudPayload) ? cloudPayload : (cloudPayload.records || []);
        this.records = (rawCloudData || []).filter(r => !isLegacyDemoRecord(r));
        this.lastUpdated = cloudPayload.lastUpdated || Date.now();
        this.ensurePaymentSchedules();
        this.saveToLocal();
        this.lastSyncTime = new Date();
        return true;
      }
    } catch (e) {
      console.warn("Failed to force pull from cloud", e);
    }
    return false;
  }

  async addRecord(recordData) {
    const nowIso = new Date().toISOString();
    const newRecord = {
      id: recordData.id || "rec-" + Date.now() + "-" + Math.random().toString(36).substr(2, 4),
      type: recordData.type || "trainee",
      name: recordData.name || recordData.clientName || "Unnamed",
      position: recordData.position || "Talent Manager",
      startDate: recordData.startDate || recordData.purchaseDate || nowIso.split("T")[0],
      trainer: recordData.trainer || "N/A",
      trainingStatus: recordData.trainingStatus || "In Progress",
      activeStatus: recordData.activeStatus || "Active",
      email: recordData.email || recordData.clientEmail || "",
      phone: recordData.phone || "",
      discord: recordData.discord || "N/A",
      lastCheckIn: recordData.lastCheckIn || nowIso.split("T")[0],
      lastCheckedInBy: recordData.lastCheckedInBy || "Manager",
      expectedCompletion: recordData.expectedCompletion || "2 Weeks at most",
      responsiveness: recordData.responsiveness || "green",
      notes: recordData.notes || "",
      history: recordData.history || [],
      createdAt: nowIso,
      updatedAt: nowIso,

      // Purchase specific fields
      purchaseCode: recordData.purchaseCode || "N/A",
      clientName: recordData.clientName || recordData.name || "",
      clientEmail: recordData.clientEmail || recordData.email || "",
      service: recordData.service || "",
      amountDue: recordData.amountDue || "$0",
      paymentStatus: recordData.paymentStatus || "Paid in full",
      contract: recordData.contract || "",
      forHandle: recordData.forHandle || "",
      nextActionItem: recordData.nextActionItem || "",
      soldBy: recordData.soldBy || "N/A",
      manager: recordData.manager || recordData.promotionalManager || "N/A",
      promotionalManager: recordData.manager || recordData.promotionalManager || "N/A",
      assignedEditor: recordData.assignedEditor || "",
      editorTask: recordData.editorTask || "",
      assignedDesigner: recordData.assignedDesigner || "",
      designerTask: recordData.designerTask || "",
      paymentSchedule: recordData.paymentSchedule || []
    };

    if (recordData.notes) {
      newRecord.history.push({
        date: nowIso.split("T")[0],
        author: recordData.lastCheckedInBy || "System",
        note: recordData.notes
      });
    }

    this.records.unshift(newRecord);
    await this.save();
    return newRecord;
  }

  async updateRecord(id, updatedFields) {
    const idx = this.records.findIndex(r => r.id === id);
    if (idx !== -1) {
      this.records[idx] = {
        ...this.records[idx],
        ...updatedFields,
        updatedAt: new Date().toISOString()
      };
      await this.save();
      return this.records[idx];
    }
    return null;
  }

  async requestCheckIn(id, assignedTo, note, requestedBy = "Manager") {
    const record = this.getRecordById(id);
    if (record) {
      const today = new Date().toISOString().split("T")[0];
      record.checkInRequest = {
        assignedTo: assignedTo || "Any Manager",
        note: note || "Check-in requested",
        requestedBy: requestedBy || "Manager",
        requestedDate: today
      };
      record.updatedAt = new Date().toISOString();

      record.history.unshift({
        date: today,
        author: requestedBy || "Manager",
        note: `📢 Requested check-in delegated to ${assignedTo || 'Manager'}: ${note || 'No note'}`
      });

      await this.save();
      return record;
    }
    return null;
  }

  async updatePaymentSchedule(purchaseId, paymentSchedule) {
    const record = this.getRecordById(purchaseId);
    if (record && record.type === "purchase") {
      record.paymentSchedule = paymentSchedule;
      record.updatedAt = new Date().toISOString();

      let totalAmount = 0;
      let paidAmount = 0;
      let unpaidAmount = 0;
      let dueAmount = 0;
      let hasOverdue = false;
      const todayStr = new Date().toISOString().split("T")[0];

      paymentSchedule.forEach(item => {
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
          // "Due"
          dueAmount += val;
          if (item.dueDate && item.dueDate < todayStr) {
            hasOverdue = true;
          }
        }
      });

      if (unpaidAmount > 0 && dueAmount > 0) {
        record.paymentStatus = `Unpaid $${unpaidAmount} | Due $${dueAmount}`;
        record.responsiveness = "red";
      } else if (unpaidAmount > 0) {
        record.paymentStatus = `Unpaid $${unpaidAmount}`;
        record.responsiveness = "red";
      } else if (dueAmount > 0) {
        record.paymentStatus = `Due $${dueAmount}`;
        record.responsiveness = hasOverdue ? "red" : "yellow";
      } else if (totalAmount > 0) {
        record.paymentStatus = "Paid in full";
        record.responsiveness = "green";
      }

      record.amountDue = `$${totalAmount}`;

      await this.save();
      return record;
    }
    return null;
  }

  async toggleInstallmentStatus(purchaseId, installmentId, newStatus) {
    const record = this.getRecordById(purchaseId);
    if (record && record.paymentSchedule) {
      const inst = record.paymentSchedule.find(p => p.id === installmentId);
      if (inst) {
        inst.status = newStatus;
        const today = new Date().toISOString().split("T")[0];
        record.history.unshift({
          date: today,
          author: "Manager",
          note: `Updated "${inst.label || 'Payment'}" status to ${newStatus}.`
        });
        return await this.updatePaymentSchedule(purchaseId, record.paymentSchedule);
      }
    }
    return null;
  }

  async moveToOnboarding(id) {
    const record = this.getRecordById(id);
    if (record && record.type === "trainee") {
      record.trainingStatus = "Needs Onboarding";
      record.updatedAt = new Date().toISOString();
      const today = new Date().toISOString().split("T")[0];
      record.history.unshift({
        date: today,
        author: "Management",
        note: "Moved from Training to Needs Onboarding stage."
      });
      await this.save();
      return record;
    }
    return null;
  }

  async promoteToEmployee(id) {
    const record = this.getRecordById(id);
    if (record) {
      record.type = "employee";
      record.activeStatus = "Active";
      record.trainingStatus = "Completed";
      record.updatedAt = new Date().toISOString();
      const today = new Date().toISOString().split("T")[0];
      record.history.unshift({
        date: today,
        author: "Management",
        note: "Onboarding complete. Promoted to Active Employee."
      });
      await this.save();
      return record;
    }
    return null;
  }

  async archiveRecord(id, reason = "Removed / Fired") {
    const record = this.getRecordById(id);
    if (record) {
      const prevType = record.type;
      record.type = "archived";
      record.archivedReason = reason;
      record.archivedFrom = prevType;
      record.updatedAt = new Date().toISOString();
      const today = new Date().toISOString().split("T")[0];
      record.history.unshift({
        date: today,
        author: "Management",
        note: `Archived record (${reason}). Previously ${prevType}.`
      });
      await this.save();
      return record;
    }
    return null;
  }

  async restoreRecord(id, targetType = "trainee") {
    const record = this.getRecordById(id);
    if (record) {
      record.type = targetType || (record.archivedFrom || "trainee");
      delete record.archivedReason;
      record.updatedAt = new Date().toISOString();
      const today = new Date().toISOString().split("T")[0];
      record.history.unshift({
        date: today,
        author: "Management",
        note: `Restored record to ${record.type}.`
      });
      await this.save();
      return record;
    }
    return null;
  }

  async deletePermanently(id) {
    this.records = this.records.filter(r => r.id !== id);
    await this.save();
  }

  async clearArchivedRecords() {
    this.records = this.records.filter(r => r.type !== "archived");
    await this.save();
  }

  async addCheckIn(id, checkedInBy, noteText, newResponsiveness, manager = null, soldBy = null) {
    const record = this.getRecordById(id);
    if (record) {
      const today = new Date().toISOString().split("T")[0];
      record.lastCheckIn = today;
      record.lastCheckedInBy = checkedInBy || "Manager";
      record.updatedAt = new Date().toISOString();

      if (record.checkInRequest) {
        delete record.checkInRequest;
      }

      if (newResponsiveness) {
        record.responsiveness = newResponsiveness;
      }
      if (manager) {
        record.manager = manager;
        record.promotionalManager = manager;
      }
      if (soldBy) {
        record.soldBy = soldBy;
      }
      
      let noteLog = noteText || "";
      if (manager) {
        noteLog = `[Manager: ${manager}] ${noteLog}`;
      }

      if (noteLog && noteLog.trim()) {
        record.notes = noteText || record.notes;
        record.history.unshift({
          date: today,
          author: checkedInBy || "Manager",
          note: noteLog
        });
      }
      await this.save();
      return record;
    }
    return null;
  }

  exportJSON() {
    return JSON.stringify(this.records, null, 2);
  }

  async importJSON(jsonData) {
    try {
      const parsed = JSON.parse(jsonData);
      if (Array.isArray(parsed)) {
        this.records = parsed.filter(r => !isLegacyDemoRecord(r));
        this.ensurePaymentSchedules();
        await this.save();
        this.createSnapshot("Imported True JSON Backup");
        return true;
      }
    } catch (e) {
      console.error("Invalid JSON data", e);
    }
    return false;
  }

  async clearDatabase() {
    this.records = [];
    await this.save();
    this.createSnapshot("Cleared Database");
  }
}

window.store = new DataStore();
