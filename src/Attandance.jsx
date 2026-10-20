export const DEFAULT_SETTINGS = {
  workStart: "09:00",
  workEnd: "18:00",
  lunchStart: "13:00",
  lunchEnd: "14:00",
  graceMinutes: 15,
  absentMinutes: 120,
  nightShift: false,
  workDays: [1, 2, 3, 4, 5], // 0 = Bazar, 1 = Bazar ertəsi ...
  saveSnapshots: true,
  countdown: 2,
  matchThreshold: 0.5,
  cooldownSec: 20,
  liveness: "blink", // off | blink | turn | random
  voice: false,
  telegramToken: "",
  telegramChatId: "",
  notifyDenied: false,
};

export const WEEKDAYS = [
  { d: 1, l: "B.e" },
  { d: 2, l: "Ç.a" },
  { d: 3, l: "Çər" },
  { d: 4, l: "C.a" },
  { d: 5, l: "Cüm" },
  { d: 6, l: "Şən" },
  { d: 0, l: "Baz" },
];

export const MONTHS = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "İyun", "İyul", "Avqust", "Sentyabr", "Oktyabr", "Noyabr", "Dekabr"];

export const LEAVE_TYPES = ["Məzuniyyət", "Xəstəlik", "Ezamiyyət", "İcazə", "Digər"];

export const STATUS_TEXT = {
  ontime: "Vaxtında",
  late: "Gecikmə",
  halfday: "Yarım gün",
  "after-hours": "İş saatından kənar",
  "lunch-return": "Nahardan qayıtdı",
  "lunch-break": "Nahar fasiləsi",
  "normal-out": "Çıxış",
  dayoff: "İstirahət günü",
  unknown: "Tanınmadı",
};

/* ---------- Tarix və format köməkçiləri ---------- */

const pad = (n) => String(n).padStart(2, "0");
export const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseKey = (k) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
export const fmtDate = (k) => {
  const [y, m, d] = k.split("-");
  return `${d}.${m}.${y}`;
};
export const fmtTime = (d) => new Date(d).toLocaleTimeString("az-AZ", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const fmtDateTime = (d) => `${fmtDate(dateKey(new Date(d)))} ${fmtTime(d)}`;
export const fmtDuration = (min) => {
  const m = Math.round(min);
  return `${Math.floor(m / 60)}s ${m % 60}dəq`;
};
export const toDatetimeLocal = (d) => {
  const x = new Date(d);
  return `${dateKey(x)}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
};
export const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export function initialsFor(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function toMinutes(hhmm) {
  const [h, m] = (hhmm || "00:00").split(":").map(Number);
  return h * 60 + (m || 0);
}

/* ---------- Qaydalar ---------- */

// İşçinin öz növbəsi varsa o, yoxsa şirkət qaydaları
export function effectiveRules(emp, settings) {
  return { ...settings, ...(emp?.shift || {}) };
}

export function isWorkingDay(date, settings, holidays) {
  const days = settings.workDays || [1, 2, 3, 4, 5];
  return days.includes(date.getDay()) && !holidays.some((h) => h.date === dateKey(date));
}

export function scheduledMinutes(rules) {
  let span = toMinutes(rules.workEnd) - toMinutes(rules.workStart);
  if (span < 0) span += 1440;
  const lunch = Math.max(0, toMinutes(rules.lunchEnd) - toMinutes(rules.lunchStart));
  return Math.max(0, span - lunch);
}

export function resolveStatus(time, type, rules, working = true) {
  if (!working) {
    return type === "out" ? { status: "normal-out", lateMinutes: 0 } : { status: "dayoff", lateMinutes: 0 };
  }
  const workStartMin = toMinutes(rules.workStart);
  const workEndMin = toMinutes(rules.workEnd);
  const lunchStartMin = toMinutes(rules.lunchStart);
  const lunchEndMin = toMinutes(rules.lunchEnd);
  const grace = Number(rules.graceMinutes) || 0;
  const absentLimit = Number(rules.absentMinutes) || 0;

  let nowMin = time.getHours() * 60 + time.getMinutes();
  if (rules.nightShift && nowMin < workStartMin - 240) nowMin += 1440;

  const inLunchWindow = nowMin >= lunchStartMin && nowMin <= lunchEndMin;
  const afterHours = nowMin >= workEndMin;

  if (type === "out") return { status: inLunchWindow ? "lunch-break" : "normal-out", lateMinutes: 0 };
  if (inLunchWindow) return { status: "lunch-return", lateMinutes: 0 };
  if (afterHours) return { status: "after-hours", lateMinutes: 0 };

  const diff = nowMin - workStartMin;
  if (diff <= grace) return { status: "ontime", lateMinutes: 0 };
  if (diff <= absentLimit) return { status: "late", lateMinutes: diff };
  return { status: "halfday", lateMinutes: diff };
}

export const leaveFor = (empId, key, leaves) => leaves.find((l) => l.employeeId === empId && l.from <= key && key <= l.to);

/* ---------- Gün və dövr hesablamaları ---------- */

export function groupLogs(logs) {
  const map = new Map();
  for (const l of logs) {
    if (l.type === "denied" || !l.employeeId) continue;
    const t = new Date(l.time);
    const k = `${l.employeeId}|${dateKey(t)}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push({ ...l, time: t });
  }
  for (const arr of map.values()) arr.sort((a, b) => a.time - b.time);
  return map;
}

function summarizeDay(events, isToday, now) {
  let worked = 0;
  let openIn = null;
  let firstIn = null;
  for (const e of events) {
    if (e.type === "in") {
      if (!firstIn) firstIn = e;
      if (openIn === null) openIn = e.time;
    } else if (e.type === "out" && openIn !== null) {
      worked += (e.time - openIn) / 60000;
      openIn = null;
    }
  }
  let open = false;
  let missingOut = false;
  if (openIn !== null) {
    if (isToday) {
      worked += Math.max(0, (now - openIn) / 60000);
      open = true;
    } else {
      missingOut = true;
    }
  }
  return {
    present: !!firstIn,
    late: !!firstIn && (firstIn.status === "late" || firstIn.status === "halfday"),
    lateMinutes: firstIn?.lateMinutes || 0,
    worked,
    open,
    missingOut,
    firstIn,
  };
}

// Bir işçinin bir gündəki vəziyyəti
export function dayState(emp, date, ctx) {
  const key = dateKey(date);
  const todayKey = dateKey(ctx.now);
  const rules = effectiveRules(emp, ctx.settings);
  const working = isWorkingDay(date, ctx.settings, ctx.holidays);
  const holiday = ctx.holidays.find((h) => h.date === key);
  const base = { key, rules, working, holiday };

  if (key > todayKey) return { ...base, kind: "future" };
  if (emp.createdAt && key < dateKey(new Date(emp.createdAt))) return { ...base, kind: "before" };

  const events = ctx.groups.get(`${emp.id}|${key}`) || [];
  const sum = summarizeDay(events, key === todayKey, ctx.now);
  if (sum.present) return { ...base, sum, kind: sum.late ? "late" : "present" };

  const leave = leaveFor(emp.id, key, ctx.leaves);
  if (leave) return { ...base, leave, kind: "leave" };
  if (!working) return { ...base, kind: holiday ? "holiday" : "weekend" };

  if (key === todayKey) {
    const nowMin = ctx.now.getHours() * 60 + ctx.now.getMinutes();
    if (nowMin < toMinutes(rules.workStart) + (Number(rules.graceMinutes) || 0)) return { ...base, kind: "pending" };
  }
  return { ...base, kind: "absent" };
}

export function buildContext({ logs, leaves, holidays, settings, now = new Date() }) {
  return { settings, holidays, leaves, groups: groupLogs(logs), now };
}

export function buildReport({ employees, logs, leaves, holidays, settings, from, to, now = new Date() }) {
  const ctx = buildContext({ logs, leaves, holidays, settings, now });
  const rows = employees.map((emp) => ({
    emp,
    workingDays: 0,
    presentDays: 0,
    lateCount: 0,
    absentDays: 0,
    leaveDays: 0,
    workedMin: 0,
    overtimeMin: 0,
  }));
  const daily = [];

  let d = parseKey(from);
  for (let i = 0; i < 400 && dateKey(d) <= to; i++, d = addDays(d, 1)) {
    let present = 0;
    let late = 0;
    let absent = 0;
    employees.forEach((emp, idx) => {
      const st = dayState(emp, d, ctx);
      const r = rows[idx];
      if (st.kind === "present" || st.kind === "late") {
        r.presentDays++;
        present++;
        if (st.kind === "late") {
          r.lateCount++;
          late++;
        }
        if (st.working) r.workingDays++;
        r.workedMin += st.sum.worked;
        r.overtimeMin += Math.max(0, st.sum.worked - (st.working ? scheduledMinutes(st.rules) : 0));
      } else if (st.kind === "absent") {
        r.absentDays++;
        r.workingDays++;
        absent++;
      } else if (st.kind === "leave") {
        r.leaveDays++;
      }
    });
    const k = dateKey(d);
    daily.push({ date: `${k.slice(8)}.${k.slice(5, 7)}`, present, late, absent });
  }
  return { rows, daily };
}

// Bu gün hələ gəlməyən işçilər (gəlməyib və ya gecikir, icazəsi yoxdur)
export function notArrivedToday({ employees, logs, leaves, holidays, settings, now = new Date() }) {
  const ctx = buildContext({ logs, leaves, holidays, settings, now });
  return employees.filter((emp) => {
    const k = dayState(emp, now, ctx).kind;
    return k === "absent" || k === "pending";
  });
}

export function periodRange(preset, now = new Date()) {
  const today = dateKey(now);
  if (preset === "today") return { from: today, to: today };
  if (preset === "week") return { from: dateKey(addDays(now, -((now.getDay() + 6) % 7))), to: today };
  if (preset === "month") return { from: `${today.slice(0, 8)}01`, to: today };
  return { from: today, to: today };
}