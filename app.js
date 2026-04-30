/* ============================================================
   Breeden Point — app.js
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  deleteDoc,
  doc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---------- Firebase config ----------
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
const FAMILY_CODE = "8008";
const GUEST_CODE = "0001";

// ---------- The roster ----------
// Edit this list to add or remove people. `pet: true` shows a paw icon.
const ROSTER = [
  { name: "Paul" },
  { name: "Trish" },
  { name: "Murphy", pet: true },
  { name: "Darnel" },
  { name: "Chessie" },
  { name: "Miles" },
  { name: "Luna" },
  { name: "Milo", pet: true },
  { name: "Hunter" },
  { name: "Victoria" },
  { name: "Anthony" },
  { name: "Lexie" },
  { name: "Rick" },
  { name: "Sloan" },
  { name: "Sydney" },
  { name: "Cosmo", pet: true },
  { name: "Dude", pet: true }
];

// ---------- Session helpers ----------
function setMode(mode) { sessionStorage.setItem("bp_mode", mode); }
function getMode() { return sessionStorage.getItem("bp_mode"); }
function clearMode() { sessionStorage.removeItem("bp_mode"); }

// ============================================================
//  LANDING PAGE LOGIC (gate)
// ============================================================
const gateForm = document.getElementById("gate-form");
if (gateForm) {
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
  const mode = getMode();
  if (mode !== "family" && mode !== "guest") {
    window.location.href = "index.html";
  }

  // ---------- State ----------
  let currentYear = new Date().getFullYear();
  let currentMonth = new Date().getMonth();
  let claimsByDate = {};
  let claimsListenerUnsub = null;
  let selectedParty = new Set();

  const monthLabel = document.getElementById("month-label");
  const userModeLabel = document.getElementById("user-mode-label");
  const prevBtn = document.getElementById("prev-month");
  const nextBtn = document.getElementById("next-month");
  const logoutLink = document.getElementById("logout-link");

  userModeLabel.textContent =
    mode === "family"
      ? "Signed in as Family"
      : "Signed in as Guest — family bookings appear as 'Reserved'";

  logoutLink.addEventListener("click", () => clearMode());

  prevBtn.addEventListener("click", () => {
    currentMonth--;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    renderCalendar();
    subscribeToMonth();
  });
  nextBtn.addEventListener("click", () => {
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    renderCalendar();
    subscribeToMonth();
  });

  // ---------- Render ----------
  const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  function dateKey(year, month, day) {
    const m = String(month + 1).padStart(2, "0");
    const d = String(day).padStart(2, "0");
    return `${year}-${m}-${d}`;
  }

  // Compact display label for a claim tag: "Anthony" or "Anthony +4"
  function tagLabelFor(claim) {
    const partySize = (claim.party && claim.party.length) ? claim.party.length : 0;
    // If the booker name is also in the party, we don't double count
    const others = claim.party ? claim.party.filter(n => n !== claim.name).length : 0;
    if (others > 0) return `${claim.name} +${others}`;
    if (partySize > 0 && !claim.party.includes(claim.name)) return `${claim.name} +${partySize}`;
    return claim.name;
  }

  function renderCalendar() {
    monthLabel.textContent = `${MONTH_NAMES[currentMonth]} ${currentYear}`;
    calendarGrid.innerHTML = "";

    DAY_NAMES.forEach((name) => {
      const el = document.createElement("div");
      el.className = "day-name";
      el.textContent = name;
      calendarGrid.appendChild(el);
    });

    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const today = new Date();
    const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());

    for (let i = 0; i < firstDay; i++) {
      const el = document.createElement("div");
      el.className = "day-cell empty";
      calendarGrid.appendChild(el);
    }

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

      const claims = claimsByDate[key] || [];
      const hasMultiple = claims.length > 1;

      claims.forEach((c) => {
        const tag = document.createElement("div");
        let tagClass = "claim-tag";
        if (hasMultiple) tagClass += " conflict";
        else if (c.isGuest) tagClass += " guest";
        tag.className = tagClass;

        if (mode === "guest" && !c.isGuest) {
          tag.textContent = "Reserved";
        } else {
          tag.textContent = tagLabelFor(c);
        }
        cell.appendChild(tag);
      });

      cell.addEventListener("click", () => openClaimModal(key));
      calendarGrid.appendChild(cell);
    }
  }

  // ---------- Subscribe ----------
  function subscribeToMonth() {
    if (claimsListenerUnsub) claimsListenerUnsub();

    const rangeStart = new Date(currentYear, currentMonth - 1, 1);
    const rangeEnd = new Date(currentYear, currentMonth + 2, 0, 23, 59, 59);

    const q = query(
      collection(db, "claims"),
      where("startDate", ">=", Timestamp.fromDate(rangeStart)),
      where("startDate", "<=", Timestamp.fromDate(rangeEnd))
    );

    claimsListenerUnsub = onSnapshot(q, (snap) => {
      claimsByDate = {};
      snap.forEach((d) => {
        const data = d.data();
        const start = data.startDate.toDate();
        const end = data.endDate ? data.endDate.toDate() : start;
        const cur = new Date(start);
        while (cur <= end) {
          const k = dateKey(cur.getFullYear(), cur.getMonth(), cur.getDate());
          if (!claimsByDate[k]) claimsByDate[k] = [];
          claimsByDate[k].push({
            id: d.id,
            name: data.name,
            note: data.note || "",
            party: data.party || [],
            isGuest: data.isGuest === true,
            startDate: start,
            endDate: end
          });
          cur.setDate(cur.getDate() + 1);
        }
      });
      renderCalendar();
    }, (err) => {
      console.error("Claims listener error:", err);
    });
  }

  // ---------- Claim modal elements ----------
  const claimModal = document.getElementById("claim-modal");
  const modalTitle = document.getElementById("claim-modal-title");
  const modalSubtitle = document.getElementById("claim-modal-subtitle");
  const existingSection = document.getElementById("existing-claims-section");
  const existingList = document.getElementById("existing-claims-list");
  const conflictWarning = document.getElementById("conflict-warning");
  const hardBlockWarning = document.getElementById("hard-block-warning");
  const claimForm = document.getElementById("claim-form");
  const claimName = document.getElementById("claim-name");
  const claimStartDate = document.getElementById("claim-start-date");
  const claimEndDate = document.getElementById("claim-end-date");
  const claimNote = document.getElementById("claim-note");
  const claimCancel = document.getElementById("claim-cancel");
  const claimSubmit = document.getElementById("claim-submit");
  const partyGrid = document.getElementById("party-grid");

  // Update notes placeholder
  if (claimNote) {
    claimNote.placeholder = "e.g. arriving late, dinner plans";
  }

  function buildPartyChips() {
    if (!partyGrid) {
      console.error("party-grid element not found");
      return;
    }
    partyGrid.innerHTML = "";
    ROSTER.forEach((p) => {
      const chip = document.createElement("div");
      chip.className = "party-chip" + (p.pet ? " pet" : "");
      chip.textContent = p.name;
      chip.dataset.name = p.name;
      if (selectedParty.has(p.name)) chip.classList.add("selected");
      chip.addEventListener("click", () => {
        if (selectedParty.has(p.name)) {
          selectedParty.delete(p.name);
          chip.classList.remove("selected");
        } else {
          selectedParty.add(p.name);
          chip.classList.add("selected");
        }
      });
      partyGrid.appendChild(chip);
    });
  }

  function openClaimModal(key) {
    selectedParty = new Set();

    const [yyyy, mm, dd] = key.split("-");
    const dateObj = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    const pretty = dateObj.toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric", year: "numeric"
    });

    const existing = claimsByDate[key] || [];

    modalTitle.textContent = "New reservation";
    modalSubtitle.textContent = `${pretty} · ${mode === "guest" ? "Booking as Guest" : "Booking as Family"}`;

    // Existing claims list (tappable)
    existingSection.hidden = existing.length === 0;
    existingList.innerHTML = "";
    existing.forEach((c) => {
      const item = document.createElement("div");
      item.className = "existing-claims-item";
      const isHidden = mode === "guest" && !c.isGuest;
      const displayName = isHidden ? "Reserved" : tagLabelFor(c);
      const tag = c.isGuest ? " (guest)" : "";
      item.innerHTML = `<span><strong>${escapeHtml(displayName)}</strong>${escapeHtml(tag)}</span><span class="view-link">View →</span>`;
      item.addEventListener("click", () => openDetailModal(c));
      existingList.appendChild(item);
    });

    // Conflict logic
    const familyOnDate = existing.some(c => !c.isGuest);
    const guestOnDate = existing.some(c => c.isGuest);

    hardBlockWarning.hidden = true;
    conflictWarning.hidden = true;
    claimSubmit.disabled = false;

    if (mode === "guest" && familyOnDate) {
      hardBlockWarning.hidden = false;
      claimSubmit.disabled = true;
    } else if (existing.length > 0) {
      conflictWarning.hidden = false;
    }

    // Reset form
    claimForm.reset();
    claimName.value = "";
    claimNote.value = "";
    claimStartDate.value = key;
    claimEndDate.value = key;
    claimEndDate.min = key;

    // Build chips fresh every time the modal opens
    buildPartyChips();

    claimModal.hidden = false;
    setTimeout(() => claimName.focus(), 50);
  }

  claimStartDate.addEventListener("change", () => {
    if (claimStartDate.value) {
      claimEndDate.min = claimStartDate.value;
      if (!claimEndDate.value || claimEndDate.value < claimStartDate.value) {
        claimEndDate.value = claimStartDate.value;
      }
      // Re-check guest hard-block based on the new range
      revalidateGuestRange();
    }
  });
  claimEndDate.addEventListener("change", () => {
    revalidateGuestRange();
  });

  function revalidateGuestRange() {
    if (mode !== "guest") return;
    const startVal = claimStartDate.value;
    const endVal = claimEndDate.value || startVal;
    if (!startVal) return;
    if (isRangeFamilyBlocked(startVal, endVal)) {
      hardBlockWarning.hidden = false;
      claimSubmit.disabled = true;
    } else {
      hardBlockWarning.hidden = true;
      claimSubmit.disabled = false;
    }
  }

  function closeClaimModal() {
    claimModal.hidden = true;
    claimSubmit.disabled = false;
    claimSubmit.textContent = "Save reservation";
  }
  claimCancel.addEventListener("click", closeClaimModal);
  claimModal.addEventListener("click", (e) => {
    if (e.target === claimModal) closeClaimModal();
  });

  claimForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = claimName.value.trim();
    const note = claimNote.value.trim();
    const startVal = claimStartDate.value;
    const endVal = claimEndDate.value || startVal;
    if (!name || !startVal) return;

    // Final guest hard-block check
    if (mode === "guest" && isRangeFamilyBlocked(startVal, endVal)) {
      hardBlockWarning.hidden = false;
      claimSubmit.disabled = true;
      return;
    }

    const [sy, sm, sd] = startVal.split("-").map(Number);
    const [ey, em, ed] = endVal.split("-").map(Number);
    const start = new Date(sy, sm - 1, sd);
    let end = new Date(ey, em - 1, ed);
    if (end < start) end = start;

    try {
      claimSubmit.disabled = true;
      claimSubmit.textContent = "Saving…";
      await addDoc(collection(db, "claims"), {
        name,
        note,
        party: Array.from(selectedParty),
        isGuest: mode === "guest",
        startDate: Timestamp.fromDate(start),
        endDate: Timestamp.fromDate(end),
        createdAt: serverTimestamp()
      });
      closeClaimModal();
    } catch (err) {
      console.error("Failed to save claim:", err);
      alert("Couldn't save. Check your internet and try again.");
      claimSubmit.disabled = false;
      claimSubmit.textContent = "Save reservation";
    }
  });

  function isRangeFamilyBlocked(startStr, endStr) {
    const [sy, sm, sd] = startStr.split("-").map(Number);
    const [ey, em, ed] = endStr.split("-").map(Number);
    const cur = new Date(sy, sm - 1, sd);
    const end = new Date(ey, em - 1, ed);
    while (cur <= end) {
      const k = dateKey(cur.getFullYear(), cur.getMonth(), cur.getDate());
      const claims = claimsByDate[k] || [];
      if (claims.some(c => !c.isGuest)) return true;
      cur.setDate(cur.getDate() + 1);
    }
    return false;
  }

  // ---------- Detail modal ----------
  const detailModal = document.getElementById("detail-modal");
  const detailTitle = document.getElementById("detail-modal-title");
  const detailBody = document.getElementById("detail-modal-body");
  const detailClose = document.getElementById("detail-close");
  const detailDelete = document.getElementById("detail-delete");
  let activeDetailClaim = null;

  function openDetailModal(claim) {
    activeDetailClaim = claim;
    closeClaimModal();

    const isHidden = mode === "guest" && !claim.isGuest;

    detailTitle.textContent = isHidden ? "Reserved" : `${claim.name}'s reservation`;

    const fmt = (d) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    const partyDisplay = (claim.party && claim.party.length > 0)
      ? claim.party.join(", ")
      : "Just the booker";

    if (isHidden) {
      detailBody.innerHTML = `
        <div class="detail-row"><strong>Dates</strong>${escapeHtml(fmt(claim.startDate))} → ${escapeHtml(fmt(claim.endDate))}</div>
        <div class="detail-row"><strong>Type</strong>Family reservation</div>
      `;
    } else {
      detailBody.innerHTML = `
        <div class="detail-row"><strong>Booked by</strong>${escapeHtml(claim.name)}${claim.isGuest ? " (guest)" : ""}</div>
        <div class="detail-row"><strong>Dates</strong>${escapeHtml(fmt(claim.startDate))} → ${escapeHtml(fmt(claim.endDate))}</div>
        <div class="detail-row"><strong>Party</strong>${escapeHtml(partyDisplay)}</div>
        ${claim.note ? `<div class="detail-row"><strong>Notes</strong>${escapeHtml(claim.note)}</div>` : ""}
      `;
    }

    const canDelete = (mode === "family") || (mode === "guest" && claim.isGuest);
    detailDelete.hidden = !canDelete || isHidden;

    detailModal.hidden = false;
  }

  detailClose.addEventListener("click", () => {
    detailModal.hidden = true;
    activeDetailClaim = null;
  });
  detailModal.addEventListener("click", (e) => {
    if (e.target === detailModal) {
      detailModal.hidden = true;
      activeDetailClaim = null;
    }
  });

  detailDelete.addEventListener("click", async () => {
    if (!activeDetailClaim) return;
    const confirmed = confirm(`Delete ${activeDetailClaim.name}'s reservation? This can't be undone.`);
    if (!confirmed) return;
    try {
      await deleteDoc(doc(db, "claims", activeDetailClaim.id));
      detailModal.hidden = true;
      activeDetailClaim = null;
    } catch (err) {
      console.error("Failed to delete:", err);
      alert("Couldn't delete. Try again.");
    }
  });

  // ---------- Helpers ----------
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
