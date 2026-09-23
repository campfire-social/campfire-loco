// ---------- Supabase setup ----------
const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_PUBLISHABLE_KEY);

// ---------- Date helpers (always local calendar date, never UTC) ----------
function pad(n) { return String(n).padStart(2, "0"); }
function toDateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseDateStr(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function todayStr() { return toDateStr(new Date()); }
function addDays(d, delta) { const nd = new Date(d); nd.setDate(nd.getDate() + delta); return nd; }
function startOfMonthStr(d = new Date()) { return toDateStr(new Date(d.getFullYear(), d.getMonth(), 1)); }
function startOfYearStr(d = new Date()) { return toDateStr(new Date(d.getFullYear(), 0, 1)); }
function friendlyDate(dateStr) {
  const d = parseDateStr(dateStr);
  const today = todayStr();
  const yest = toDateStr(addDays(new Date(), -1));
  if (dateStr === today) return "Today";
  if (dateStr === yest) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

const RING_CIRC = 2 * Math.PI * 52; // matches SVG r=52

// ---------- State ----------
const state = {
  session: null,
  pushupGoal: 100,
  displayName: "",
  spouseName: "",
  todayExercise: "pushup",
  dayDetailExercise: "pushup",
  dayDetailDate: null,
  todayCompliments: 0,
  dayDetailCompliments: 0,
  pushupComplete: false,
  situpComplete: false,
};

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
document.querySelectorAll(".tab-bar .tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

function switchTab(name) {
  document.querySelectorAll(".tab-bar .tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  ["today", "feed", "history", "settings"].forEach((t) => {
    const panel = $(`tab-${t}`);
    if (t === name) show(panel); else hide(panel);
  });
  hide($("tab-day-detail"));
  if (name === "history") loadHistoryTab();
  if (name === "today") loadTodayTab();
  if (name === "feed") loadFeedTab();
  if (name === "settings") loadSettingsTab();
}

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
  if (data) {
    state.displayName = data.display_name;
    state.spouseName = data.spouse_name || "";
    return;
  }
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

// Raw rows for the current user between two dates (inclusive) — grouped client-side by caller.
async function fetchOwnEntriesRange(startDate, endDate) {
  const uid = state.session.user.id;
  const { data, error } = await sb
    .from("activity_entries")
    .select("entry_date, activity_type, amount")
    .eq("user_id", uid)
    .gte("entry_date", startDate)
    .lte("entry_date", endDate);
  if (error) { console.error(error); return []; }
  return data;
}

function groupByDate(rows) {
  const byDate = {};
  for (const r of rows) {
    const day = (byDate[r.entry_date] ??= { pushup: 0, situp: 0 });
    day[r.activity_type] += r.amount;
  }
  return byDate;
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

async function fetchLatestWeight() {
  const uid = state.session.user.id;
  const { data, error } = await sb
    .from("daily_status")
    .select("entry_date, weight")
    .eq("user_id", uid)
    .not("weight", "is", null)
    .order("entry_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) { console.error(error); return null; }
  return data;
}

// Summed server-side (via get_activity_totals) so a whole year of entries
// never has to be downloaded just to add them up.
async function fetchTotalReps(startDate, endDate) {
  const { data, error } = await sb.rpc("get_activity_totals", { p_start: startDate, p_end: endDate });
  if (error) { console.error(error); return 0; }
  return (data || []).reduce((sum, row) => sum + Number(row.total), 0);
}

async function fetchStatusRange(startDate, endDate) {
  const uid = state.session.user.id;
  const { data, error } = await sb
    .from("daily_status")
    .select("*")
    .eq("user_id", uid)
    .gte("entry_date", startDate)
    .lte("entry_date", endDate);
  if (error) { console.error(error); return []; }
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

async function saveStatus(dateStr, { weight, ateWell, prayed, compliments }) {
  const uid = state.session.user.id;
  const row = {
    user_id: uid,
    entry_date: dateStr,
    weight: weight === "" || weight === null || Number.isNaN(weight) ? null : weight,
    ate_well: ateWell,
    prayed: prayed,
    updated_at: new Date().toISOString(),
  };
  if (compliments !== undefined) row.compliments = compliments;
  const { error } = await sb.from("daily_status").upsert(row, { onConflict: "user_id,entry_date" });
  if (error) { console.error(error); alert("Couldn't save check-in, try again."); }
  return !error;
}

// Compliments are saved the moment a box is tapped (not via the Save
// check-in button), so they get their own tiny partial upsert that never
// touches weight/ate_well/prayed.
async function updateCompliments(dateStr, count) {
  const uid = state.session.user.id;
  const { error } = await sb.from("daily_status").upsert(
    { user_id: uid, entry_date: dateStr, compliments: count, updated_at: new Date().toISOString() },
    { onConflict: "user_id,entry_date" }
  );
  if (error) console.error(error);
  return !error;
}

// ---------- Streak & headline logic ----------
function goalsMetOn(dateStr, byDate, pushupGoal) {
  const day = byDate[dateStr];
  if (!day) return false;
  return day.pushup >= pushupGoal && day.situp >= pushupGoal * 2;
}

// Sundays are a scheduled rest day: they neither extend nor break the
// streak, so the count from the week before just carries straight through
// to Monday.
function isRestDay(d) { return d.getDay() === 0; }

function computeStreak(byDate, pushupGoal) {
  const todayDateStr = todayStr();
  let streak = 0;
  let cursor = new Date();

  while (true) {
    if (isRestDay(cursor)) {
      cursor = addDays(cursor, -1);
      continue;
    }
    const dateStr = toDateStr(cursor);
    if (goalsMetOn(dateStr, byDate, pushupGoal)) {
      streak++;
    } else if (dateStr !== todayDateStr) {
      // A miss on any day other than today (which isn't over yet) ends the streak.
      break;
    }
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function personPct(totals, pushupGoal) {
  const pushupPct = Math.min(1, pushupGoal ? totals.pushup / pushupGoal : 0);
  const situpPct = Math.min(1, pushupGoal ? totals.situp / (pushupGoal * 2) : 0);
  return (pushupPct + situpPct) / 2;
}

function todayHeadline(avgPct) {
  if (avgPct <= 0) return "Nothing logged yet";
  if (avgPct < 0.4) return "Off the mark";
  if (avgPct < 0.9) return "Halfway there";
  if (avgPct < 1) return "Nearly done";
  return "Both goals done";
}

// ---------- Today tab ----------
async function loadTodayTab() {
  const today = todayStr();
  $("today-date").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "long", month: "short", day: "numeric",
  }).toUpperCase();

  const [rangeRows, entries, statusRow] = await Promise.all([
    fetchOwnEntriesRange(toDateStr(addDays(new Date(), -90)), today),
    fetchEntriesForDate(today),
    fetchStatusForDate(today),
  ]);
  const byDate = groupByDate(rangeRows);
  const todayTotals = byDate[today] || { pushup: 0, situp: 0 };

  renderRings(todayTotals);
  $("streak-num").textContent = computeStreak(byDate, state.pushupGoal);
  $("today-headline").textContent = todayHeadline(personPct(todayTotals, state.pushupGoal));

  renderTodayLog(entries);

  $("weight-input").value = statusRow?.weight ?? "";
  $("ate-well-input").checked = !!statusRow?.ate_well;
  $("prayed-input").checked = !!statusRow?.prayed;

  state.todayCompliments = statusRow?.compliments ?? 0;
  renderComplimentBoxes("compliment-row", state.todayCompliments);
  setComplimentsCount($("compliments-count"), state.todayCompliments);
  $("compliments-subtitle").textContent = state.spouseName
    ? `Goal: To notice ${state.spouseName}'s glory!`
    : "Goal: To notice her glory!";
}

// Restarts a CSS animation on an element even if it's already applied.
function triggerPop(el) {
  if (!el) return;
  el.classList.remove("pop");
  void el.offsetWidth;
  el.classList.add("pop");
}

function renderRings(totals) {
  const pushupGoal = state.pushupGoal;
  const situpGoal = state.pushupGoal * 2;

  $("today-pushups").textContent = totals.pushup;
  $("today-situps").textContent = totals.situp;

  const pushupPct = Math.min(1, totals.pushup / pushupGoal);
  const situpPct = Math.min(1, totals.situp / situpGoal);
  $("ring-pushup").style.strokeDasharray = `${pushupPct * RING_CIRC} ${RING_CIRC}`;
  $("ring-situp").style.strokeDasharray = `${situpPct * RING_CIRC} ${RING_CIRC}`;

  updateRingCompletion("pushup", totals.pushup >= pushupGoal);
  updateRingCompletion("situp", totals.situp >= situpGoal);
}

// Swaps the ring's "of X" caption for a "Goal complete!" one, with a glow
// on the ring and a one-time pop the moment it's actually crossed, rather
// than every time the tab re-renders.
function updateRingCompletion(kind, isComplete) {
  const wasComplete = state[`${kind}Complete`];
  $(`ring-${kind}`).classList.toggle("complete", isComplete);
  $(`ring-${kind}-goal`).classList.toggle("hidden", isComplete);
  $(`ring-${kind}-complete`).classList.toggle("hidden", !isComplete);
  if (isComplete && !wasComplete) {
    triggerPop($(`ring-${kind}-wrap`));
  }
  state[`${kind}Complete`] = isComplete;
}

// ---------- Compliments (5 progressive-fill boxes) ----------
function complimentsCountText(count) {
  return count >= 5 ? "5 of 5 — she felt it today." : `${count} of 5 today`;
}

function setComplimentsCount(labelEl, count) {
  if (!labelEl) return;
  labelEl.textContent = complimentsCountText(count);
  labelEl.classList.toggle("celebrate", count >= 5);
}

function renderComplimentBoxes(rowId, count) {
  document.querySelectorAll(`#${rowId} .compliment-box`).forEach((box) => {
    const idx = parseInt(box.dataset.index, 10);
    const filled = idx <= count;
    box.classList.toggle("filled", filled);
    box.classList.toggle("celebrate", filled && count >= 5);
  });
}

function wireComplimentRow(rowId, countLabelId, onChange) {
  $(rowId).addEventListener("click", (e) => {
    const box = e.target.closest(".compliment-box");
    if (!box) return;
    const idx = parseInt(box.dataset.index, 10);
    const current = onChange.get();
    const next = idx === current ? idx - 1 : idx;
    onChange.set(next);
    renderComplimentBoxes(rowId, next);
    triggerPop(box);
    if (countLabelId) setComplimentsCount($(countLabelId), next);
  });
}

wireComplimentRow("compliment-row", "compliments-count", {
  get: () => state.todayCompliments,
  set: (v) => {
    state.todayCompliments = v;
    updateCompliments(todayStr(), v);
  },
});

wireComplimentRow("day-compliment-row", null, {
  get: () => state.dayDetailCompliments,
  set: (v) => { state.dayDetailCompliments = v; },
});

function renderTodayLog(entries) {
  $("today-log-count").textContent = `${entries.length} SET${entries.length === 1 ? "" : "S"}`;
  renderEntryList($("today-entries"), $("today-entries-empty"), entries);
}

function renderEntryList(listEl, emptyEl, entries) {
  listEl.innerHTML = "";
  if (!entries.length) { show(emptyEl); return; }
  hide(emptyEl);
  for (const entry of entries) {
    const li = document.createElement("li");
    const time = new Date(entry.created_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const isSitup = entry.activity_type === "situp";
    li.innerHTML = `
      <span class="entry-dot ${isSitup ? "situp" : ""}"></span>
      <span class="entry-delta">+${entry.amount}</span>
      <span class="entry-name">${isSitup ? "Sit-ups" : "Push-ups"}</span>
      <span class="entry-time">${time}</span>
      <button class="entry-delete" aria-label="Delete">&times;</button>
    `;
    li.querySelector(".entry-delete").addEventListener("click", async () => {
      await deleteEntry(entry.id);
      if (state.dayDetailDate) loadDayDetail(state.dayDetailDate); else loadTodayTab();
    });
    listEl.appendChild(li);
  }
}

// ---------- Exercise switches (Today + Day detail) ----------
function wireExerciseSwitch(containerId, onChange) {
  const container = $(containerId);
  container.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      container.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      onChange(btn.dataset.exercise);
    });
  });
}
wireExerciseSwitch("today-switch", (ex) => { state.todayExercise = ex; });
wireExerciseSwitch("day-detail-switch", (ex) => { state.dayDetailExercise = ex; });

// Quick-add buttons (Today tab + Day detail tab share this handler)
document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".quick-btn");
  if (!btn) return;
  const isDayDetail = btn.closest("#day-detail-grid");
  const activityType = isDayDetail ? state.dayDetailExercise : state.todayExercise;
  const targetDate = isDayDetail ? state.dayDetailDate : todayStr();
  let amount;
  if (btn.dataset.custom) {
    const raw = prompt(`How many ${activityType === "situp" ? "sit-ups" : "push-ups"}?`);
    if (raw === null) return;
    amount = parseInt(raw, 10);
    if (!amount || amount <= 0) return;
  } else {
    amount = parseInt(btn.dataset.amount, 10);
  }
  btn.disabled = true;
  await addEntry(targetDate, activityType, amount);
  btn.disabled = false;
  if (isDayDetail) loadDayDetail(targetDate); else loadTodayTab();
});

// ---------- History tab ----------
async function loadHistoryTab() {
  const today = new Date();
  const start = addDays(today, -6);
  const startStr = toDateStr(start);
  const endStr = toDateStr(today);

  const [rows, statusRows, latestWeight, monthReps, yearReps] = await Promise.all([
    fetchOwnEntriesRange(startStr, endStr),
    fetchStatusRange(startStr, endStr),
    fetchLatestWeight(),
    fetchTotalReps(startOfMonthStr(), endStr),
    fetchTotalReps(startOfYearStr(), endStr),
  ]);
  const byDate = groupByDate(rows);
  const weightByDate = {};
  statusRows.forEach((s) => { if (s.weight != null) weightByDate[s.entry_date] = s.weight; });

  const days = []; // oldest to newest, 7 entries
  for (let i = 6; i >= 0; i--) days.push(toDateStr(addDays(today, -i)));

  let repsTotal = 0;
  let daysLogged = 0;
  days.forEach((d) => {
    const t = byDate[d];
    if (t) { repsTotal += t.pushup + t.situp; if (t.pushup + t.situp > 0) daysLogged++; }
  });

  $("stat-week-reps").textContent = repsTotal;
  $("stat-month-reps").textContent = monthReps;
  $("stat-year-reps").textContent = yearReps;
  $("stat-days-logged").textContent = `${daysLogged}/7`;
  $("stat-weight").textContent = latestWeight ? latestWeight.weight : "—";

  renderWeekChart(days, byDate);
  renderPastDays(days, byDate, weightByDate);
}

function renderWeekChart(days, byDate) {
  const cols = $("chart-cols");
  cols.innerHTML = "";
  const maxTotal = Math.max(1, ...days.map((d) => { const t = byDate[d]; return t ? t.pushup + t.situp : 0; }));
  const todayD = todayStr();
  days.forEach((d) => {
    const t = byDate[d] || { pushup: 0, situp: 0 };
    const total = t.pushup + t.situp;
    const label = parseDateStr(d).toLocaleDateString(undefined, { weekday: "narrow" });
    const isToday = d === todayD;
    const col = document.createElement("div");
    col.className = "chart-col";
    if (total === 0 && isRestDay(parseDateStr(d))) {
      col.innerHTML = `
        <div class="chart-rest-block"><span class="chart-rest-text">Rest</span></div>
        <span class="chart-day-label ${isToday ? "today" : ""}">${label}</span>
      `;
    } else if (total === 0) {
      col.innerHTML = `<div class="chart-stub"></div><span class="chart-day-label ${isToday ? "today" : ""}">${label}</span>`;
    } else {
      const situpH = Math.max(2, (t.situp / maxTotal) * 106);
      const pushupH = Math.max(2, (t.pushup / maxTotal) * 106);
      col.innerHTML = `
        <div class="chart-stack">
          <div class="chart-seg-situp" style="height:${situpH}px"></div>
          <div class="chart-seg-pushup" style="height:${pushupH}px"></div>
        </div>
        <span class="chart-day-label ${isToday ? "today" : ""}">${label}</span>
      `;
    }
    cols.appendChild(col);
  });
}

function renderPastDays(days, byDate, weightByDate) {
  const list = $("past-days-list");
  list.innerHTML = "";
  // newest first for the list
  [...days].reverse().forEach((d) => {
    const t = byDate[d];
    const hasActivity = !!t && (t.pushup + t.situp) > 0;
    const weight = weightByDate[d];
    const row = document.createElement("button");
    row.className = "day-row";
    const nameClass = hasActivity ? "" : "rest";
    const sub = weight != null ? `${weight} lb` : (hasActivity ? "logged" : "rest day");
    const counts = hasActivity
      ? `<span class="day-count pushup">${t.pushup}</span><span class="day-count situp">${t.situp}</span>`
      : `<span class="day-dash">&mdash;</span>`;
    row.innerHTML = `
      <div class="day-info">
        <span class="day-name ${nameClass}">${friendlyDate(d)}</span>
        <span class="day-sub">${sub}</span>
      </div>
      ${counts}
    `;
    row.addEventListener("click", () => openDayDetail(d));
    list.appendChild(row);
  });
}

// ---------- Feed tab (shared progress across everyone signed in) ----------
async function loadFeedTab() {
  const today = todayStr();
  const feedStart = toDateStr(addDays(new Date(), -2)); // today + 2 prior days

  const [profilesRes, settingsRes, entriesRes, complimentsRes] = await Promise.all([
    sb.from("profiles").select("user_id, display_name"),
    sb.from("settings").select("user_id, pushup_goal"),
    sb.from("activity_entries").select("user_id, entry_date, activity_type, amount, created_at").gte("entry_date", feedStart).order("created_at", { ascending: false }),
    sb.from("compliments_feed").select("user_id, compliments").eq("entry_date", today),
  ]);

  const profiles = profilesRes.data || [];
  const names = {};
  profiles.forEach((p) => { names[p.user_id] = p.display_name; });
  const goals = {};
  (settingsRes.data || []).forEach((s) => { goals[s.user_id] = s.pushup_goal; });
  const entries = entriesRes.data || [];
  const complimentsByUser = {};
  (complimentsRes.data || []).forEach((c) => { complimentsByUser[c.user_id] = c.compliments; });

  renderFeedStandings(today, profiles, entries, names, goals, complimentsByUser);
  renderFeedRecent(entries, names);
}

// Team-spirited, not head-to-head: nobody gets called out as "ahead" or
// "behind" someone else, it just reads the room on how the group is doing.
function teamHeadline(people) {
  const anyStarted = people.some((p) => p.started);
  if (!anyStarted) return "Let's get moving";
  const avgPct = people.reduce((sum, p) => sum + p.pct, 0) / people.length;
  if (avgPct >= 1) return "Everybody crushed it today";
  if (avgPct >= 0.66) return "Almost there together";
  return "Keep pushing each other";
}

function renderFeedStandings(today, profiles, entries, names, goals, complimentsByUser) {
  const myId = state.session.user.id;
  const totalsByUser = {};
  for (const e of entries) {
    if (e.entry_date !== today) continue;
    const t = (totalsByUser[e.user_id] ??= { pushup: 0, situp: 0 });
    t[e.activity_type] += e.amount;
  }

  const people = profiles.map((p) => {
    const totals = totalsByUser[p.user_id] || { pushup: 0, situp: 0 };
    const goal = goals[p.user_id] || 100;
    return {
      id: p.user_id,
      name: p.display_name || "Someone",
      isMe: p.user_id === myId,
      totals,
      goal,
      pct: personPct(totals, goal),
      started: totals.pushup > 0 || totals.situp > 0,
    };
  });
  people.sort((a, b) => (b.isMe - a.isMe) || a.name.localeCompare(b.name));

  $("feed-headline").textContent = teamHeadline(people);

  const card = $("feed-standings");
  card.innerHTML = "";
  people.forEach((p, i) => {
    if (i > 0) {
      const divider = document.createElement("div");
      divider.className = "standings-divider";
      card.appendChild(divider);
    }
    const block = document.createElement("div");
    block.className = "standing-person";
    const initial = (p.name.trim()[0] || "?").toUpperCase();
    const statusHtml = p.isMe
      ? `<span class="person-status">YOU</span>`
      : (p.started ? "" : `<span class="person-status idle">not started</span>`);
    const situpGoal = p.goal * 2;
    block.innerHTML = `
      <div class="person-header">
        <span class="avatar ${p.isMe ? "me" : ""}">${initial}</span>
        <span class="person-name ${p.started ? "" : "inactive"}">${p.name}</span>
        ${statusHtml}
      </div>
      <div class="bar-rows">
        ${feedBarRow(p.totals.pushup, p.goal, "")}
        ${feedBarRow(p.totals.situp, situpGoal, "situp")}
      </div>
      <div class="compliments-mini">${complimentsByUser[p.id] ?? 0} of 5 compliments today</div>
    `;
    card.appendChild(block);
  });
}

function feedBarRow(value, goal, altClass) {
  const pct = Math.min(1, goal ? value / goal : 0) * 100;
  const zero = value === 0 ? "zero" : "";
  return `
    <div class="bar-row">
      <span class="bar-count ${zero}">${value}/${goal}</span>
      <div class="bar-track"><div class="bar-fill ${altClass}" style="width:${pct}%"></div></div>
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
    li.className = "recent-row";
    const name = names[entry.user_id] || "Someone";
    const initial = (name.trim()[0] || "?").toUpperCase();
    const time = new Date(entry.created_at).toLocaleString(undefined, {
      weekday: "short", hour: "numeric", minute: "2-digit",
    });
    const isSitup = entry.activity_type === "situp";
    li.innerHTML = `
      <span class="avatar sm ${entry.user_id === state.session.user.id ? "me" : ""}">${initial}</span>
      <div class="recent-body">
        <span class="recent-label">${name} +${entry.amount} ${isSitup ? "sit-ups" : "push-ups"}</span>
        <span class="recent-time">${time}</span>
      </div>
    `;
    list.appendChild(li);
  }
}

// ---------- Day detail ----------
async function openDayDetail(dateStr) {
  state.dayDetailDate = dateStr;
  state.dayDetailExercise = "pushup";
  $("day-detail-switch").querySelectorAll("button").forEach((b, i) => b.classList.toggle("active", i === 0));
  hide($("tab-history"));
  hide($("tab-today"));
  hide($("tab-feed"));
  hide($("tab-settings"));
  show($("tab-day-detail"));
  await loadDayDetail(dateStr);
}

async function loadDayDetail(dateStr) {
  $("day-detail-heading").textContent = `${friendlyDate(dateStr)} · ${dateStr}`;
  const [entries, statusRow] = await Promise.all([
    fetchEntriesForDate(dateStr),
    fetchStatusForDate(dateStr),
  ]);
  renderEntryList($("day-detail-entries"), $("day-detail-entries-empty"), entries);
  $("day-weight-input").value = statusRow?.weight ?? "";
  $("day-ate-well-input").checked = !!statusRow?.ate_well;
  $("day-prayed-input").checked = !!statusRow?.prayed;

  state.dayDetailCompliments = statusRow?.compliments ?? 0;
  renderComplimentBoxes("day-compliment-row", state.dayDetailCompliments);
}

$("btn-back-history").addEventListener("click", () => {
  hide($("tab-day-detail"));
  show($("tab-history"));
});

$("btn-save-day-status").addEventListener("click", async () => {
  const weight = parseFloat($("day-weight-input").value);
  const ok = await saveStatus(state.dayDetailDate, {
    weight: Number.isNaN(weight) ? null : weight,
    ateWell: $("day-ate-well-input").checked,
    prayed: $("day-prayed-input").checked,
    compliments: state.dayDetailCompliments,
  });
  if (ok) flashSaved($("day-saved-msg"));
});

function flashSaved(el) {
  show(el);
  setTimeout(() => hide(el), 1800);
}

// ---------- Settings tab ("You") ----------
function loadSettingsTab() {
  applyGoalToUI();
  $("display-name-input").value = state.displayName;
  $("spouse-name-input").value = state.spouseName;
}

$("btn-save-status").addEventListener("click", async () => {
  const weight = parseFloat($("weight-input").value);
  const ok = await saveStatus(todayStr(), {
    weight: Number.isNaN(weight) ? null : weight,
    ateWell: $("ate-well-input").checked,
    prayed: $("prayed-input").checked,
  });
  if (ok) flashSaved($("status-saved-msg"));
});

$("btn-save-name").addEventListener("click", async () => {
  const name = $("display-name-input").value.trim();
  if (!name) return;
  const spouseName = $("spouse-name-input").value.trim();
  const uid = state.session.user.id;
  const { error } = await sb.from("profiles").upsert(
    { user_id: uid, display_name: name, spouse_name: spouseName || null },
    { onConflict: "user_id" }
  );
  if (error) { console.error(error); return; }
  state.displayName = name;
  state.spouseName = spouseName;
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
