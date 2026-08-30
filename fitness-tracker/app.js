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
  displayName: "",
  historyOldestFetched: null, // date string, exclusive lower bound of what's been rendered
  dayDetailDate: null,
};
const HISTORY_PAGE_DAYS = 14;

// ---------- Small DOM helpers ----------
const $ = (id) => document.getElementById(id);
function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

// ---------- Auth ----------
let authMode = "signin"; // or "signup"

$("btn-auth-toggle").addEventListener("click", () => {
  authMode = authMode === "signin" ? "signup" : "signin";
  const isSignup = authMode === "signup";
  $("auth-subtitle").textContent = isSignup ? "Create your account." : "Sign in to keep tracking.";
  $("btn-auth-submit").textContent = isSignup ? "Create account" : "Sign in";
  $("btn-auth-toggle").textContent = isSignup ? "Already have an account? Sign in" : "New here? Create an account";
  $("password-input").setAttribute("autocomplete", isSignup ? "new-password" : "current-password");
  hide($("login-error"));
  hide($("login-info"));
});

$("form-auth").addEventListener("submit", async (e) => {
  e.preventDefault();
  hide($("login-error"));
  hide($("login-info"));
  const email = $("email-input").value.trim();
  const password = $("password-input").value;
  const submitBtn = $("btn-auth-submit");
  submitBtn.disabled = true;
  try {
    if (authMode === "signup") {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) { showLoginError(error.message); return; }
      if (!data.session) {
        showLoginInfo("Account created. Give it a few seconds, then hit Sign in.");
        authMode = "signin";
        $("auth-subtitle").textContent = "Sign in to keep tracking.";
        submitBtn.textContent = "Sign in";
        $("btn-auth-toggle").textContent = "New here? Create an account";
      }
      // if data.session is already set, onAuthStateChange boots the app
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) { showLoginError(error.message); return; }
      // onAuthStateChange picks up the new session and boots the app
    }
  } finally {
    submitBtn.disabled = false;
  }
});

function showLoginError(msg) {
  const el = $("login-error");
  el.textContent = msg;
  show(el);
}

function showLoginInfo(msg) {
  const el = $("login-info");
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
    $("form-auth").reset();
    hide($("login-error"));
    hide($("login-info"));
  }
});

// ---------- Tabs ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

function switchTab(name) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  ["today", "feed", "history", "settings"].forEach((t) => {
    const panel = $(`tab-${t}`);
    if (t === name) show(panel); else hide(panel);
  });
  hide($("tab-day-detail"));
  if (name === "history") loadHistory(true);
  if (name === "today") loadTodayTab();
  if (name === "feed") loadFeedTab();
  if (name === "settings") loadSettingsTab();
}

$("btn-back-history").addEventListener("click", () => {
  hide($("tab-day-detail"));
  show($("tab-history"));
});

// ---------- Boot ----------
async function bootApp() {
  $("account-email").textContent = state.session.user.email;
  await Promise.all([ensureSettings(), ensureProfile()]);
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

async function ensureProfile() {
  const uid = state.session.user.id;
  const { data, error } = await sb.from("profiles").select("*").eq("user_id", uid).maybeSingle();
  if (error) { console.error(error); return; }
  if (data) { state.displayName = data.display_name; return; }
  const fallback = state.session.user.email.split("@")[0];
  const name = prompt("What's your name? (Shown to others in the shared feed)", fallback) || fallback;
  const { error: insErr } = await sb.from("profiles").insert({ user_id: uid, display_name: name });
  if (insErr) { console.error(insErr); return; }
  state.displayName = name;
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

// ---------- Feed tab (shared progress across everyone signed in) ----------
async function loadFeedTab() {
  const today = todayStr();
  const feedStart = toDateStr(addDays(new Date(), -2)); // today + 2 prior days

  const [profilesRes, settingsRes, entriesRes] = await Promise.all([
    sb.from("profiles").select("user_id, display_name"),
    sb.from("settings").select("user_id, pushup_goal"),
    sb.from("activity_entries").select("user_id, entry_date, activity_type, amount, created_at").gte("entry_date", feedStart).order("created_at", { ascending: false }),
  ]);

  const names = {};
  (profilesRes.data || []).forEach((p) => { names[p.user_id] = p.display_name; });
  const goals = {};
  (settingsRes.data || []).forEach((s) => { goals[s.user_id] = s.pushup_goal; });
  const entries = entriesRes.data || [];

  renderFeedToday(today, entries, names, goals);
  renderFeedRecent(entries, names);
}

function renderFeedToday(today, entries, names, goals) {
  const totals = {}; // user_id -> {pushup, situp}
  for (const e of entries) {
    if (e.entry_date !== today) continue;
    const t = (totals[e.user_id] ??= { pushup: 0, situp: 0 });
    t[e.activity_type] += e.amount;
  }
  // Make sure everyone with a name shows up, even at 0 for today.
  for (const uid of Object.keys(names)) totals[uid] ??= { pushup: 0, situp: 0 };

  const list = $("feed-today-list");
  list.innerHTML = "";
  const userIds = Object.keys(totals).sort((a, b) => (names[a] || "").localeCompare(names[b] || ""));
  for (const uid of userIds) {
    const t = totals[uid];
    const pushupGoal = goals[uid] || 100;
    const situpGoal = pushupGoal * 2;
    const li = document.createElement("li");
    li.className = "feed-person";
    const isMe = uid === state.session.user.id;
    li.innerHTML = `
      <div class="feed-person-name">${names[uid] || "Someone"}${isMe ? " (you)" : ""}</div>
      <div class="feed-bars">
        ${feedBarRow("💪", t.pushup, pushupGoal, "")}
        ${feedBarRow("🔥", t.situp, situpGoal, "situp")}
      </div>
    `;
    list.appendChild(li);
  }
}

function feedBarRow(label, value, goal, altClass) {
  const pct = Math.min(1, goal ? value / goal : 0) * 100;
  return `
    <div class="feed-bar-row">
      <span class="feed-bar-label">${label} of ${goal}</span>
      <span class="feed-bar-track"><span class="feed-bar-fill ${altClass}" style="width:${pct}%"></span></span>
      <span class="feed-bar-num">${value}</span>
    </div>
  `;
}

function renderFeedRecent(entries, names) {
  const list = $("feed-recent-list");
  const empty = $("feed-recent-empty");
  list.innerHTML = "";
  const recent = entries.slice(0, 40);
  if (!recent.length) { show(empty); return; }
  hide(empty);
  for (const entry of recent) {
    const li = document.createElement("li");
    const time = new Date(entry.created_at).toLocaleString(undefined, {
      weekday: "short", hour: "numeric", minute: "2-digit",
    });
    li.innerHTML = `
      <span>
        <span class="entry-person">${names[entry.user_id] || "Someone"}</span>
        <span class="entry-tag ${entry.activity_type === "situp" ? "situp" : ""}">${entry.activity_type}</span>
        +${entry.amount}
        <span class="entry-time">${time}</span>
      </span>
    `;
    list.appendChild(li);
  }
}

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
  $("display-name-input").value = state.displayName;
}

$("btn-save-name").addEventListener("click", async () => {
  const name = $("display-name-input").value.trim();
  if (!name) return;
  const uid = state.session.user.id;
  const { error } = await sb.from("profiles").upsert(
    { user_id: uid, display_name: name },
    { onConflict: "user_id" }
  );
  if (error) { console.error(error); return; }
  state.displayName = name;
  flashSaved($("name-saved-msg"));
});

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
