/* ============================================================
   Breeden's Point — app.js
   Handles: gate (passcodes), calendar rendering, claim creation,
   and Firebase sync.
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---------- Firebase config (yours) ----------
const firebaseConfig = {
  apiKey: "AIzaSyByVBVR6MDtMMa7KF7ueX0bqICiZjRGHeo",
  authDomain: "breeden-point.firebaseapp.com",
  projectId: "breeden-point",
  storageBucket: "breeden-point.firebasestorage.app",
  messagingSenderId: "834676292206",
  appId: "1:834676292206:web:47bd95c3b10e7cb34d047f"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ---------- Passcodes ----------
// Change these to whatever you want. Family code = full access.
// Guest code = calendar + house info only, no names visible on family claims.
const FAMILY_CODE = "8008";
const GUEST_CODE = "0001";

// ---------- Session helpers (stored in sessionStorage) ----------
// sessionStorage = cleared when browser tab closes. Good fit for "soft" gate.
function setMode(mode) {
  sessionStorage.setItem("bp_mode", mode); // "family" | "guest"
}
function getMode() {
  return sessionStorage.getItem("bp_mode");
}
function clearMode() {
  sessionStorage.removeItem("bp_mode");
}

// ============================================================
//  LANDING PAGE LOGIC (gate)
// ============================================================
const gateForm = document.getElementById("gate-form");
if (gateForm) {
  // If they're already authed, skip the gate
  const existing = getMode();
  if (existing === "family" || existing === "guest") {
    window.location.href = "calendar.html";
  }

  const codeInput = document.getElementById("gate-code");
  const errorEl = document.getElementById("gate-error");

  gateForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const code = codeInput.value.trim();

    if (code === FAMILY_CODE) {
      setMode("family");
      window.location.href = "calendar.html";
    } else if (code === GUEST_CODE) {
      setMode("guest");
      window.location.href = "calendar.html";
    } else {
      errorEl.hidden = false;
      codeInput.value = "";
      codeInput.focus();
    }
  });
}

// ============================================================
//  CALENDAR PAGE LOGIC
// ============================================================
const calendarGrid = document.getElementById("calendar-grid");
if (calendarGrid) {
  // Gate-check: must be authed to view this page
  const mode = getMode();
  if (mode !== "family" && mode !== "guest") {
    window.location.href = "index.html";
  }

  // ---------- State ----------
  let currentYear = new Date().getFullYear();
  let currentMonth = new Date().getMonth(); // 0 = Jan
  let claimsByDate = {}; // { "2026-04-28": [ {name, note, isGuest, ...} ] }
  let claimsListenerUnsub = null;

  const monthLabel = document.getElementById("month-label");
  const userModeLabel = document.getElementById("user-mode-label");
  const prevBtn = document.getElementById("prev-month");
  const nextBtn = document.getElementById("next-month");
  const logoutLink = document.getElementById("logout-link");

  userModeLabel.textContent =
    mode === "family"
      ? "Signed in as Family"
      : "Signed in as Guest — calendar shows family bookings as Reserved";

  logoutLink.addEventListener("click", () => {
    clearMode();
  });

  prevBtn.addEventListener("click", () => {
    currentMonth--;
    if (currentMonth < 0) {
      currentMonth = 11;
      currentYear--;
    }
    renderCalendar();
    subscribeToMonth();
  });

  nextBtn.addEventListener("click", () => {
    currentMonth++;
    if (currentMonth > 11) {
      currentMonth = 0;
      currentYear++;
    }
    renderCalendar();
    subscribeToMonth();
  });

  // ---------- Render the grid ----------
  const MONTH_NAMES = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December"
  ];
  const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  function dateKey(year, month, day) {
    // YYYY-MM-DD format, padded
    const m = String(month + 1).padStart(2, "0");
    const d = String(day).padStart(2, "0");
    return `${year}-${m}-${d}`;
  }

  function renderCalendar() {
    monthLabel.textContent = `${MONTH_NAMES[currentMonth]} ${currentYear}`;
    calendarGrid.innerHTML = "";

    // Day name header row
    DAY_NAMES.forEach((name) => {
      const el = document.createElement("div");
      el.className = "day-name";
      el.textContent = name;
      calendarGrid.appendChild(el);
    });

    const firstDay = new Date(currentYear, currentMonth, 1).getDay(); // 0-6
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const today = new Date();
    const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());

    // Empty cells before day 1
    for (let i = 0; i < firstDay; i++) {
      const el = document.createElement("div");
      el.className = "day-cell empty";
      calendarGrid.appendChild(el);
    }

    // Actual day cells
    for (let day = 1; day <= daysInMonth; day++) {
      const cell = document.createElement("div");
      const key = dateKey(currentYear, currentMonth, day);
      const dow = new Date(currentYear, currentMonth, day).getDay();
      const isWeekend = dow === 0 || dow === 6;

      cell.className = "day-cell" + (isWeekend ? " weekend" : "") + (key === todayKey ? " today" : "");
      cell.dataset.date = key;

      const num = document.createElement("div");
      num.className = "day-number";
      num.textContent = day;
      cell.appendChild(num);

      // Render any claims on this date
      const claims = claimsByDate[key] || [];
      const hasConflict = claims.length > 1;

      claims.forEach((c) => {
        const tag = document.createElement("div");
        let tagClass = "claim-tag";
        if (hasConflict) tagClass += " conflict";
        else if (c.isGuest) tagClass += " guest";
        tag.className = tagClass;

        // Guests see family claims as just "Reserved"
        if (mode === "guest" && !c.isGuest) {
          tag.textContent = "Reserved";
        } else {
          tag.textContent = c.name;
        }
        cell.appendChild(tag);
      });

      cell.addEventListener("click", () => openClaimModal(key));
      calendarGrid.appendChild(cell);
    }
  }

  // ---------- Subscribe to claims for the current month ----------
  function subscribeToMonth() {
    // Cancel old listener
    if (claimsListenerUnsub) claimsListenerUnsub();

    const monthStart = new Date(currentYear, currentMonth, 1);
    const monthEnd = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59);

    const q = query(
      collection(db, "claims"),
      where("startDate", ">=", Timestamp.fromDate(monthStart)),
      where("startDate", "<=", Timestamp.fromDate(monthEnd))
    );

    claimsListenerUnsub = onSnapshot(q, (snap) => {
      claimsByDate = {};
      snap.forEach((doc) => {
        const data = doc.data();
        const start = data.startDate.toDate();
        const end = data.endDate ? data.endDate.toDate() : start;

        // Walk every day from start to end and add the claim there
        const cur = new Date(start);
        while (cur <= end) {
          const k = dateKey(cur.getFullYear(), cur.getMonth(), cur.getDate());
          if (!claimsByDate[k]) claimsByDate[k] = [];
          claimsByDate[k].push({
            id: doc.id,
            name: data.name,
            note: data.note || "",
            isGuest: data.isGuest === true,
            startKey: dateKey(start.getFullYear(), start.getMonth(), start.getDate()),
            endKey: dateKey(end.getFullYear(), end.getMonth(), end.getDate())
          });
          cur.setDate(cur.getDate() + 1);
        }
      });
      renderCalendar();
    }, (err) => {
      console.error("Claims listener error:", err);
    });
  }

  // ---------- Claim modal ----------
  const modal = document.getElementById("claim-modal");
  const modalTitle = document.getElementById("claim-modal-title");
  const modalSubtitle = document.getElementById("claim-modal-subtitle");
  const existingSection = document.getElementById("existing-claims-section");
  const existingList = document.getElementById("existing-claims-list");
  const conflictWarning = document.getElementById("conflict-warning");
  const claimForm = document.getElementById("claim-form");
  const claimName = document.getElementById("claim-name");
  const claimEndDate = document.getElementById("claim-end-date");
  const claimNote = document.getElementById("claim-note");
  const claimCancel = document.getElementById("claim-cancel");

  let activeDateKey = null;

  function openClaimModal(key) {
    activeDateKey = key;
    const [yyyy, mm, dd] = key.split("-");
    const dateObj = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    const pretty = dateObj.toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric", year: "numeric"
    });

    modalTitle.textContent = `Claim ${pretty}`;
    modalSubtitle.textContent = mode === "guest"
      ? "You're booking as a guest. Family bookings show as 'Reserved'."
      : "Claiming as Family.";

    // Show existing claims (with mode-aware redaction for guests)
    const existing = claimsByDate[key] || [];
    if (existing.length > 0) {
      existingSection.hidden = false;
      existingList.innerHTML = "";
      existing.forEach((c) => {
        const item = document.createElement("div");
        item.className = "existing-claims-item";
        const displayName = (mode === "guest" && !c.isGuest) ? "Reserved" : c.name;
        const noteText = (mode === "guest" && !c.isGuest) ? "" : (c.note ? ` — ${c.note}` : "");
        item.innerHTML = `<strong>${escapeHtml(displayName)}</strong>${escapeHtml(noteText)}`;
        existingList.appendChild(item);
      });
      conflictWarning.hidden = false;
    } else {
      existingSection.hidden = true;
      conflictWarning.hidden = true;
    }

    // Reset form
    claimForm.reset();
    claimEndDate.min = key;

    modal.hidden = false;
    setTimeout(() => claimName.focus(), 50);
  }

  function closeClaimModal() {
    modal.hidden = true;
    activeDateKey = null;
  }

  claimCancel.addEventListener("click", closeClaimModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeClaimModal();
  });

  claimForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!activeDateKey) return;

    const name = claimName.value.trim();
    const note = claimNote.value.trim();
    const endVal = claimEndDate.value;

    if (!name) return;

    const [sy, sm, sd] = activeDateKey.split("-").map(Number);
    const start = new Date(sy, sm - 1, sd);
    let end = start;
    if (endVal) {
      const [ey, em, ed] = endVal.split("-").map(Number);
      end = new Date(ey, em - 1, ed);
      if (end < start) end = start;
    }

    try {
      await addDoc(collection(db, "claims"), {
        name,
        note,
        isGuest: mode === "guest",
        startDate: Timestamp.fromDate(start),
        endDate: Timestamp.fromDate(end),
        createdAt: serverTimestamp()
      });
      closeClaimModal();
    } catch (err) {
      console.error("Failed to save claim:", err);
      alert("Couldn't save. Check your internet and try again.");
    }
  });

  // ---------- Tiny safety helper ----------
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ---------- Boot ----------
  renderCalendar();
  subscribeToMonth();
}