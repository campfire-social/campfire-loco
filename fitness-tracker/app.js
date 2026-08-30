// ---------- Supabase setup ----------
const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_PUBLISHABLE_KEY);

// ---------- Date helpers (always local calendar date, never UTC) ----------
function pad(n) { return String(n).padStart(2, "0"); }
function toDateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseDateStr(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function todayStr() { return toDateStr(new Date()); }
function addDays(d, delta) { const nd = new Date(d); nd.setDate(nd.getDate() + delta); return nd; }
function startOfWeekStr(d = new Date()) {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // Monday start
  return toDateStr(addDays(d, diff));
}
function startOfMonthStr(d = new Date()) { return toDateStr(new Date(d.getFullYear(), d.getMonth(), 1)); }
function friendlyDate(dateStr) {
  const d = parseDateStr(dateStr);
  const today = todayStr();
  const yest = toDateStr(addDays(new Date(), -1));
  if (dateStr === today) return "Today";
  if (dateStr === yest) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

// ---------- State ----------
const state = {
  session: null,
  pushupGoal: 100,
  historyOldestFetched: null, // date string, exclusive lower bound of what's been rendered
  dayDetailDate: null,
};
const HISTORY_PAGE_DAYS = 14;

// ---------- Small DOM helpers ----------
const $ = (id) => document.getElementById(id);
function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

// ---------- Auth ----------
$("form-send-code").addEventListener("submit", async (e) => {
  e.preventDefault();
  hide($("login-error"));
  const email = $("email-input").value.trim();
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) { showLoginError(error.message); return; }
  $("email-echo").textContent = email;
  hide($("form-send-code"));
  show($("form-verify-code"));
  $("code-input").focus();
});

$("form-verify-code").addEventListener("submit", async (e) => {
  e.preventDefault();
  hide($("login-error"));
  const email = $("email-echo").textContent;
  const token = $("code-input").value.trim();
  const { error } = await sb.auth.verifyOtp({ email, token, type: "email" });
  if (error) { showLoginError(error.message); return; }
  // onAuthStateChange picks up the new session and boots the app
});

$("btn-resend").addEventListener("click", () => {
  hide($("form-verify-code"));
  show($("form-send-code"));
  $("code-input").value = "";
});

function showLoginError(msg) {
  const el = $("login-error");
  el.textContent = msg;
  show(el);
}

async function logout() {
  await sb.auth.signOut();
}
$("btn-logout").addEventListener("click", logout);
$("btn-logout-2").addEventListener("click", logout);

sb.auth.onAuthStateChange((_event, session) => {
  state.session = session;
  if (session) {
    hide($("view-login"));
    show($("view-main"));
    bootApp();
  } else {
    show($("view-login"));
    hide($("view-main"));
    $("form-send-code").reset();
    $("form-verify-code").reset();
    hide($("form-verify-code"));
    show($("form-send-code"));
  }
});

// ---------- Tabs ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

function switchTab(name) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  ["today", "history", "settings"].forEach((t) => {
    const panel = $(`tab-${t}`);
    if (t === name) show(panel); else hide(panel);
  });
  hide($("tab-day-detail"));
  if (name === "history") loadHistory(true);
  if (name === "today") loadTodayTab();
  if (name === "settings") loadSettingsTab();
}

$("btn-back-history").addEventListener("click", () => {
  hide($("tab-day-detail"));
  show($("tab-history"));
});

// ---------- Boot ----------
async function bootApp() {
  $("account-email").textContent = state.session.user.email;
  await ensureSettings();
  applyGoalToUI();
  switchTab("today");
  registerServiceWorker();
}

async function ensureSettings() {
  const uid = state.session.user.id;
  const { data, error } = await sb.from("settings").select("*").eq("user_id", uid).maybeSingle();
  if (error) { console.error(error); return; }
  if (!data) {
    const { data: created, error: insErr } = await sb
      .from("settings")
      .insert({ user_id: uid, pushup_goal: 100 })
      .select()
      .single();
    if (insErr) { console.error(insErr); return; }
    state.pushupGoal = created.pushup_goal;
  } else {
    state.pushupGoal = data.pushup_goal;
  }
}

function applyGoalToUI() {
  const situpGoal = state.pushupGoal * 2;
  $("goal-pushups").textContent = state.pushupGoal;
  $("goal-situps").textContent = situpGoal;
  $("pushup-goal-input").value = state.pushupGoal;
  $("situp-goal-preview").textContent = situpGoal;
}

// ---------- Data access ----------
async function fetchTotals(startDate, endDate) {
  const { data, error } = await sb.rpc("get_activity_totals", { p_start: startDate, p_end: endDate });
  if (error) { console.error(error); return { pushup: 0, situp: 0 }; }
  const out = { pushup: 0, situp: 0 };
  for (const row of data) out[row.activity_type] = Number(row.total);
  return out;
}

async function fetchEntriesForDate(dateStr) {
  const uid = state.session.user.id;
  const { data, error } = await sb
    .from("activity_entries")
    .select("*")
    .eq("user_id", uid)
    .eq("entry_date", dateStr)
    .order("created_at", { ascending: false });
  if (error) { console.error(error); return []; }
  return data;
}

async function fetchStatusForDate(dateStr) {
  const uid = state.session.user.id;
  const { data, error } = await sb
    .from("daily_status")
    .select("*")
    .eq("user_id", uid)
    .eq("entry_date", dateStr)
    .maybeSingle();
  if (error) { console.error(error); return null; }
  return data;
}

async function addEntry(dateStr, activityType, amount) {
  const uid = state.session.user.id;
  const { error } = await sb
    .from("activity_entries")
    .insert({ user_id: uid, entry_date: dateStr, activity_type: activityType, amount });
  if (error) { console.error(error); alert("Couldn't save that, try again."); }
}

async function deleteEntry(id) {
  const { error } = await sb.from("activity_entries").delete().eq("id", id);
  if (error) console.error(error);
}

async function saveStatus(dateStr, { weight, ateWell, prayed }) {
  const uid = state.session.user.id;
  const { error } = await sb.from("daily_status").upsert(
    {
      user_id: uid,
      entry_date: dateStr,
      weight: weight === "" || weight === null || Number.isNaN(weight) ? null : weight,
      ate_well: ateWell,
      prayed: prayed,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,entry_date" }
  );
  if (error) { console.error(error); alert("Couldn't save check-in, try again."); }
  return !error;
}

// ---------- Today tab ----------
async function loadTodayTab() {
  const today = todayStr();
  $("today-heading").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });

  const [todayTotals, weekTotals, monthTotals, allTimeTotals, entries, statusRow] = await Promise.all([
    fetchTotals(today, today),
    fetchTotals(startOfWeekStr(), today),
    fetchTotals(startOfMonthStr(), today),
    fetchTotals("2000-01-01", today),
    fetchEntriesForDate(today),
    fetchStatusForDate(today),
  ]);

  renderRings(todayTotals);
  $("week-pushups").textContent = weekTotals.pushup;
  $("month-pushups").textContent = monthTotals.pushup;
  $("alltime-pushups").textContent = allTimeTotals.pushup;

  renderEntryList($("today-entries"), $("today-entries-empty"), entries);

  $("weight-input").value = statusRow?.weight ?? "";
  $("ate-well-input").checked = !!statusRow?.ate_well;
  $("prayed-input").checked = !!statusRow?.prayed;
}

function renderRings(totals) {
  const pushupGoal = state.pushupGoal;
  const situpGoal = state.pushupGoal * 2;
  const CIRC = 264; // 2 * PI * 42, matches SVG r=42

  $("today-pushups").textContent = totals.pushup;
  $("today-situps").textContent = totals.situp;

  const pushupPct = Math.min(1, totals.pushup / pushupGoal);
  const situpPct = Math.min(1, totals.situp / situpGoal);
  $("ring-pushup").style.strokeDashoffset = CIRC - CIRC * pushupPct;
  $("ring-situp").style.strokeDashoffset = CIRC - CIRC * situpPct;
}

function renderEntryList(listEl, emptyEl, entries) {
  listEl.innerHTML = "";
  if (!entries.length) { show(emptyEl); return; }
  hide(emptyEl);
  for (const entry of entries) {
    const li = document.createElement("li");
    const time = new Date(entry.created_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    li.innerHTML = `
      <span>
        <span class="entry-tag ${entry.activity_type === "situp" ? "situp" : ""}">${entry.activity_type}</span>
        +${entry.amount}
        <span class="entry-time">${time}</span>
      </span>
      <button class="entry-delete" aria-label="Delete">✕</button>
    `;
    li.querySelector(".entry-delete").addEventListener("click", async () => {
      await deleteEntry(entry.id);
      if (state.dayDetailDate) loadDayDetail(state.dayDetailDate); else loadTodayTab();
    });
    listEl.appendChild(li);
  }
}

// Quick-add buttons (Today tab + Day detail tab share this handler)
document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".btn-tap");
  if (!btn) return;
  const grid = btn.closest(".btn-grid");
  const activityType = grid.dataset.type;
  const targetDate = grid.dataset.dayDetail ? state.dayDetailDate : todayStr();
  let amount;
  if (btn.dataset.custom) {
    const raw = prompt(`How many ${btn.dataset.custom === "situp" ? "sit-ups" : "push-ups"}?`);
    if (raw === null) return;
    amount = parseInt(raw, 10);
    if (!amount || amount <= 0) return;
  } else {
    amount = parseInt(btn.dataset.amount, 10);
  }
  btn.disabled = true;
  await addEntry(targetDate, activityType, amount);
  btn.disabled = false;
  if (grid.dataset.dayDetail) loadDayDetail(targetDate); else loadTodayTab();
});

$("btn-save-status").addEventListener("click", async () => {
  const weight = parseFloat($("weight-input").value);
  const ok = await saveStatus(todayStr(), {
    weight: Number.isNaN(weight) ? null : weight,
    ateWell: $("ate-well-input").checked,
    prayed: $("prayed-input").checked,
  });
  if (ok) flashSaved($("status-saved-msg"));
});

function flashSaved(el) {
  show(el);
  setTimeout(() => hide(el), 1800);
}

// ---------- History tab ----------
async function loadHistory(reset) {
  if (reset) {
    $("history-list").innerHTML = "";
    state.historyOldestFetched = addDays(new Date(), -1); // start from yesterday
  }
  const end = toDateStr(state.historyOldestFetched);
  const start = toDateStr(addDays(state.historyOldestFetched, -(HISTORY_PAGE_DAYS - 1)));

  const uid = state.session.user.id;
  const [entriesRes, statusRes] = await Promise.all([
    sb.from("activity_entries").select("entry_date, activity_type, amount").eq("user_id", uid).gte("entry_date", start).lte("entry_date", end),
    sb.from("daily_status").select("*").eq("user_id", uid).gte("entry_date", start).lte("entry_date", end),
  ]);

  const byDate = {};
  const ensure = (d) => (byDate[d] ??= { pushup: 0, situp: 0, weight: null, ate_well: null, prayed: null });
  (entriesRes.data || []).forEach((r) => { ensure(r.entry_date)[r.activity_type] += r.amount; });
  (statusRes.data || []).forEach((r) => {
    const day = ensure(r.entry_date);
    day.weight = r.weight; day.ate_well = r.ate_well; day.prayed = r.prayed;
  });

  const frag = document.createDocumentFragment();
  let cursor = parseDateStr(end);
  const startDate = parseDateStr(start);
  while (cursor >= startDate) {
    const dateStr = toDateStr(cursor);
    const day = byDate[dateStr] || { pushup: 0, situp: 0, weight: null, ate_well: null, prayed: null };
    frag.appendChild(buildHistoryRow(dateStr, day));
    cursor = addDays(cursor, -1);
  }
  $("history-list").appendChild(frag);
  state.historyOldestFetched = addDays(startDate, -1);
}

function buildHistoryRow(dateStr, day) {
  const btn = document.createElement("button");
  btn.className = "history-row";
  const badges = [
    day.ate_well === true ? "🥗" : "",
    day.prayed === true ? "🙏" : "",
  ].join("");
  btn.innerHTML = `
    <span>
      <span class="history-date">${friendlyDate(dateStr)}</span>
      <div class="history-sub">${day.weight != null ? day.weight + " lb" : "no weight logged"}</div>
    </span>
    <span class="history-nums">
      <span>${day.pushup || 0} 💪</span>
      <span>${day.situp || 0} 🔥</span>
      <span class="history-badges">${badges}</span>
    </span>
  `;
  btn.addEventListener("click", () => openDayDetail(dateStr));
  return btn;
}

$("btn-load-more").addEventListener("click", () => loadHistory(false));

// ---------- Day detail ----------
async function openDayDetail(dateStr) {
  state.dayDetailDate = dateStr;
  hide($("tab-history"));
  show($("tab-day-detail"));
  await loadDayDetail(dateStr);
}

async function loadDayDetail(dateStr) {
  $("day-detail-heading").textContent = friendlyDate(dateStr) + " · " + dateStr;
  const [entries, statusRow] = await Promise.all([
    fetchEntriesForDate(dateStr),
    fetchStatusForDate(dateStr),
  ]);
  renderEntryList($("day-detail-entries"), $("day-detail-entries-empty"), entries);
  $("day-weight-input").value = statusRow?.weight ?? "";
  $("day-ate-well-input").checked = !!statusRow?.ate_well;
  $("day-prayed-input").checked = !!statusRow?.prayed;
}

$("btn-save-day-status").addEventListener("click", async () => {
  const weight = parseFloat($("day-weight-input").value);
  const ok = await saveStatus(state.dayDetailDate, {
    weight: Number.isNaN(weight) ? null : weight,
    ateWell: $("day-ate-well-input").checked,
    prayed: $("day-prayed-input").checked,
  });
  if (ok) flashSaved($("day-saved-msg"));
});

// ---------- Settings tab ----------
function loadSettingsTab() {
  applyGoalToUI();
}

$("pushup-goal-input").addEventListener("input", () => {
  const val = parseInt($("pushup-goal-input").value, 10) || 0;
  $("situp-goal-preview").textContent = val * 2;
});

$("btn-save-goal").addEventListener("click", async () => {
  const val = parseInt($("pushup-goal-input").value, 10);
  if (!val || val <= 0) return;
  const uid = state.session.user.id;
  const { error } = await sb.from("settings").upsert(
    { user_id: uid, pushup_goal: val, updated_at: new Date().toISOString() },
    { onConflict: "user_id" }
  );
  if (error) { console.error(error); return; }
  state.pushupGoal = val;
  applyGoalToUI();
  flashSaved($("goal-saved-msg"));
});

// ---------- PWA ----------
function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
