import React, { useState, useRef, useMemo } from "react";
import {
  Fingerprint,
  LogIn,
  LogOut,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  Settings2,
  ShieldCheck,
  Lock,
  Trash2,
  UserPlus,
  ArrowLeft,
  Users,
  Moon,
  Coffee,
  SlidersHorizontal,
} from "lucide-react";

// ---- ID sabiti ----
const ADMIN_PASSWORD = "admin123"; // demo üçün sadə parol

const INITIAL_EMPLOYEES = [
  { id: "e1", name: "Rəşad Əliyev", dept: "İstehsalat", initials: "RƏ" },
  { id: "e2", name: "Günel Məmmədova", dept: "Anbar", initials: "GM" },
  { id: "e3", name: "Tural Hüseynov", dept: "Nəqliyyat", initials: "TH" },
  { id: "e4", name: "Aynur Quliyeva", dept: "Ofis", initials: "AQ" },
];

// ---- Şirkət iş qaydalarının default dəyərləri ----
const DEFAULT_SETTINGS = {
  workStart: "09:00",
  workEnd: "18:00",
  lunchStart: "13:00",
  lunchEnd: "14:00",
  graceMinutes: 15,
  absentMinutes: 120,
  nightShift: false,
};

function fmtTime(d) {
  return d.toLocaleTimeString("az-AZ", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function initialsFor(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function toMinutes(hhmm) {
  const [h, m] = (hhmm || "00:00").split(":").map(Number);
  return h * 60 + (m || 0);
}

// Skan vaxtına və şirkət qaydalarına əsasən status müəyyən edir
// (köhnə vanilla-JS versiyasındakı processAttendance məntiqinin React qarşılığı)
function resolveStatus(time, type, settings) {
  const workStartMin = toMinutes(settings.workStart);
  const workEndMin = toMinutes(settings.workEnd);
  const lunchStartMin = toMinutes(settings.lunchStart);
  const lunchEndMin = toMinutes(settings.lunchEnd);
  const grace = Number(settings.graceMinutes) || 0;
  const absentLimit = Number(settings.absentMinutes) || 0;

  let nowMin = time.getHours() * 60 + time.getMinutes();
  // Gecə növbəsi: yarımgecədən sonrakı saatları növbənin davamı kimi say
  if (settings.nightShift && nowMin < workStartMin - 240) {
    nowMin += 1440;
  }

  const inLunchWindow = nowMin >= lunchStartMin && nowMin <= lunchEndMin;
  const afterHours = nowMin >= workEndMin;

  if (type === "out") {
    return { status: inLunchWindow ? "lunch-break" : "normal-out", lateMinutes: 0 };
  }

  // type === "in"
  if (inLunchWindow) return { status: "lunch-return", lateMinutes: 0 };
  if (afterHours) return { status: "after-hours", lateMinutes: 0 };

  const diff = nowMin - workStartMin;
  if (diff <= grace) return { status: "ontime", lateMinutes: 0 };
  if (diff <= absentLimit) return { status: "late", lateMinutes: diff };
  return { status: "halfday", lateMinutes: diff };
}

const CSS = `
  *{ box-sizing:border-box; margin:0; padding:0; }
  .kiosk-root{ font-family:'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif; }
  .mono{ font-family:'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace; }

  @keyframes sweep {
    0% { transform: translateY(-100%); opacity: 0; }
    15% { opacity: 1; }
    85% { opacity: 1; }
    100% { transform: translateY(100%); opacity: 0; }
  }
  @keyframes pulseRing {
    0% { transform: scale(0.9); opacity: 0.7; }
    100% { transform: scale(1.6); opacity: 0; }
  }
  @keyframes fadeSlide {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-6px); }
    75% { transform: translateX(6px); }
  }
  .log-enter{ animation: fadeSlide 0.35s ease-out; }
  .shake{ animation: shake 0.32s ease-in-out; }
  .scan-btn:focus-visible{ outline: 2px solid var(--scan); outline-offset: 3px; }

  .layout-grid{
    display: grid;
    grid-template-columns: 340px 1fr;
    gap: 20px;
  }
  .stat-grid{
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 12px;
  }
  .log-row{
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 18px;
    border-bottom: 1px solid var(--line);
    flex-wrap: wrap;
  }
  .log-dept{ display:block; }
  .topbar{
    display:flex;
    align-items:flex-start;
    justify-content:space-between;
    gap:12px;
    flex-wrap:wrap;
    margin-bottom: 28px;
  }
  .admin-table-row{
    display:flex;
    align-items:center;
    gap:12px;
    padding:12px 16px;
    border-bottom:1px solid var(--line);
  }
  .admin-form{
    display:grid;
    grid-template-columns: 1fr 1fr auto;
    gap: 10px;
  }

  @media (max-width: 820px){
    .layout-grid{ grid-template-columns: 1fr; }
  }
  @media (max-width: 560px){
    .kiosk-root{ padding: 20px 12px !important; }
    .stat-grid{ grid-template-columns: 1fr 1fr; }
    .stat-grid > div:last-child{ grid-column: span 2; }
    h1{ font-size: 21px !important; }
    .scanner-panel{ padding: 18px !important; }
    .log-dept{ display:none; }
    .admin-form{ grid-template-columns: 1fr; }
    .topbar{ flex-direction: column; }
    .topbar-actions{ width:100%; }
    .topbar-actions button{ flex:1; }
  }
`;

export default function CheckInKiosk() {
  const [employees, setEmployees] = useState(INITIAL_EMPLOYEES);
  const [selectedEmp, setSelectedEmp] = useState(INITIAL_EMPLOYEES[0].id);
  const [logs, setLogs] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [flash, setFlash] = useState(null);
  const [useCustomTime, setUseCustomTime] = useState(false);
  const [customTime, setCustomTime] = useState("09:00");
  const timeoutRef = useRef(null);

  // Şirkət iş qaydaları (əvvəlki HTML versiyasındakı burger-menyu tənzimləmələri)
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  // görünüş: 'kiosk' | 'admin'
  const [view, setView] = useState("kiosk");
  const [adminAuthed, setAdminAuthed] = useState(false);
  const [showGate, setShowGate] = useState(false);
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState(false);

  // admin forması (yeni işçi)
  const [newName, setNewName] = useState("");
  const [newDept, setNewDept] = useState("");

  const emp = employees.find((e) => e.id === selectedEmp) || employees[0];

  const lastActionByEmp = useMemo(() => {
    const map = {};
    for (const l of logs) map[l.employeeId] = l.type;
    return map;
  }, [logs]);

  function resolveScanTime() {
    const now = new Date();
    if (useCustomTime && /^\d{2}:\d{2}$/.test(customTime)) {
      const [h, m] = customTime.split(":").map(Number);
      const d = new Date();
      d.setHours(h, m, Math.floor(Math.random() * 50), 0);
      return d;
    }
    return now;
  }

  function handleScan() {
    if (scanning || !emp) return;
    setScanning(true);
    setFlash(null);
    timeoutRef.current = setTimeout(() => {
      const time = resolveScanTime();
      const lastType = lastActionByEmp[emp.id];
      const type = lastType === "in" ? "out" : "in";
      const { status, lateMinutes } = resolveStatus(time, type, settings);

      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        employeeId: emp.id,
        employeeName: emp.name,
        initials: emp.initials,
        dept: emp.dept,
        type,
        time,
        lateMinutes,
        status,
      };
      setLogs((prev) => [entry, ...prev]);
      setScanning(false);

      const msgMap = {
        ontime: `${emp.name} vaxtında daxil oldu`,
        late: `${emp.name} daxil oldu — ${lateMinutes} dəq gecikmə`,
        halfday: `${emp.name} çox gec gəldi — yarım gün sayılır (${lateMinutes} dəq gecikmə)`,
        "after-hours": `${emp.name} — iş günü artıq bitib, bu giriş qeyri-adi sayılır`,
        "lunch-return": `${emp.name} nahardan qayıtdı`,
        "lunch-break": `${emp.name} nahar fasiləsinə çıxdı`,
        "normal-out": `${emp.name} çıxış etdi`,
      };

      setFlash({
        msg: msgMap[status] || `${emp.name} qeydə alındı`,
        variant:
          status === "halfday" || status === "after-hours"
            ? "danger"
            : status === "late"
            ? "late"
            : status === "lunch-return" || status === "lunch-break"
            ? "info"
            : "ontime",
      });
    }, 1400);
  }

  function openAdminGate() {
    setPwInput("");
    setPwError(false);
    setShowGate(true);
  }

  function submitPassword() {
    if (pwInput === ADMIN_PASSWORD) {
      setAdminAuthed(true);
      setShowGate(false);
      setView("admin");
    } else {
      setPwError(true);
    }
  }

  function addEmployee() {
    const name = newName.trim();
    const dept = newDept.trim() || "Təyin edilməyib";
    if (!name) return;
    const newEmp = { id: `emp-${Date.now()}`, name, dept, initials: initialsFor(name) };
    setEmployees((prev) => [...prev, newEmp]);
    setNewName("");
    setNewDept("");
  }

  function removeEmployee(id) {
    setEmployees((prev) => prev.filter((e) => e.id !== id));
    if (selectedEmp === id) {
      const remaining = employees.filter((e) => e.id !== id);
      setSelectedEmp(remaining[0]?.id || "");
    }
  }

  const todayLate = logs.filter((l) => l.type === "in" && (l.status === "late" || l.status === "halfday")).length;
  const todayIn = logs.filter((l) => l.type === "in").length;

  return (
    <div
      className="kiosk-root"
      style={{
        "--bg": "#12171c",
        "--panel": "#1a2129",
        "--panel-2": "#212a33",
        "--line": "#2b3540",
        "--scan": "#45d6bd",
        "--ontime": "#5fbf7d",
        "--late": "#e8a33d",
        "--danger": "#e8613d",
        "--info": "#4dade8",
        "--text": "#e7edf0",
        "--muted": "#8695a0",
        background: "var(--bg)",
        color: "var(--text)",
        minHeight: "100vh",
        padding: "32px 16px",
        position: "relative",
      }}
    >
      <style>{CSS}</style>

      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        {/* Üst panel */}
        <div className="topbar">
          <div>
            <div className="mono" style={{ color: "var(--scan)", fontSize: 12, letterSpacing: 2, marginBottom: 6 }}>
              KEÇİD-NƏZARƏT TERMİNALI · DEMO
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>
              {view === "kiosk" ? "İşçi Giriş / Çıxış Sistemi" : "Admin Panel"}
            </h1>
            <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 6, maxWidth: 480 }}>
              {view === "kiosk" ? (
                <>
                  Barmaq izi ilə giriş-çıxış izlənməsi. İş saatı{" "}
                  <span className="mono" style={{ color: "var(--text)" }}>
                    {settings.workStart}–{settings.workEnd}
                  </span>{" "}
                  ({settings.graceMinutes} dəq güzəşt), nahar{" "}
                  <span className="mono" style={{ color: "var(--text)" }}>
                    {settings.lunchStart}–{settings.lunchEnd}
                  </span>
                  {settings.nightShift ? " · gecə növbəsi rejimi aktivdir" : ""}.
                </>
              ) : (
                "Bu bölmədən işçi əlavə edə, silə və şirkətin iş qaydalarını tənzimləyə bilərsən."
              )}
            </p>
          </div>

          <div className="topbar-actions" style={{ display: "flex", gap: 8 }}>
            {view === "kiosk" ? (
              <button onClick={() => (adminAuthed ? setView("admin") : openAdminGate())} style={btnGhost()}>
                <ShieldCheck size={15} />
                Admin Panel
              </button>
            ) : (
              <button onClick={() => setView("kiosk")} style={btnGhost()}>
                <ArrowLeft size={15} />
                Terminala qayıt
              </button>
            )}
          </div>
        </div>

        {view === "kiosk" ? (
          <KioskView
            employees={employees}
            selectedEmp={selectedEmp}
            setSelectedEmp={setSelectedEmp}
            scanning={scanning}
            handleScan={handleScan}
            useCustomTime={useCustomTime}
            setUseCustomTime={setUseCustomTime}
            customTime={customTime}
            setCustomTime={setCustomTime}
            flash={flash}
            logs={logs}
            todayIn={todayIn}
            todayLate={todayLate}
          />
        ) : (
          <AdminView
            employees={employees}
            newName={newName}
            setNewName={setNewName}
            newDept={newDept}
            setNewDept={setNewDept}
            addEmployee={addEmployee}
            removeEmployee={removeEmployee}
            settings={settings}
            setSettings={setSettings}
          />
        )}
      </div>

      {showGate && (
        <PasswordGate
          pwInput={pwInput}
          setPwInput={setPwInput}
          pwError={pwError}
          onSubmit={submitPassword}
          onClose={() => setShowGate(false)}
        />
      )}
    </div>
  );
}

function btnGhost() {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    background: "var(--panel-2)",
    border: "1px solid var(--line)",
    color: "var(--text)",
    borderRadius: 10,
    padding: "9px 14px",
    fontSize: 13,
    cursor: "pointer",
  };
}

/* ---------------- KIOSK VIEW ---------------- */

function KioskView({
  employees,
  selectedEmp,
  setSelectedEmp,
  scanning,
  handleScan,
  useCustomTime,
  setUseCustomTime,
  customTime,
  setCustomTime,
  flash,
  logs,
  todayIn,
  todayLate,
}) {
  return (
    <div className="layout-grid">
      {/* Skan paneli */}
      <div
        className="scanner-panel"
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: 16,
          padding: 24,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 18,
        }}
      >
        <div style={{ width: "100%", position: "relative" }}>
          <label className="mono" style={{ fontSize: 11, color: "var(--muted)", letterSpacing: 1 }}>
            İŞÇİNİ SEÇ (DEMO ÜÇÜN)
          </label>
          <div style={{ position: "relative", marginTop: 6 }}>
            <select
              value={selectedEmp}
              onChange={(e) => setSelectedEmp(e.target.value)}
              disabled={scanning || employees.length === 0}
              style={{
                width: "100%",
                appearance: "none",
                background: "var(--panel-2)",
                border: "1px solid var(--line)",
                color: "var(--text)",
                borderRadius: 10,
                padding: "10px 34px 10px 12px",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              {employees.length === 0 && <option value="">İşçi yoxdur</option>}
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} — {e.dept}
                </option>
              ))}
            </select>
            <ChevronDown
              size={16}
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", pointerEvents: "none" }}
            />
          </div>
        </div>

        <div style={{ position: "relative", width: 150, height: 150, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 6 }}>
          {scanning && (
            <span style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid var(--scan)", animation: "pulseRing 1.1s ease-out infinite" }} />
          )}
          <button
            className="scan-btn"
            onClick={handleScan}
            disabled={scanning || employees.length === 0}
            aria-label="Barmaq izini oxu"
            style={{
              position: "relative",
              width: 120,
              height: 120,
              borderRadius: "50%",
              background: "var(--panel-2)",
              border: `2px solid ${scanning ? "var(--scan)" : "var(--line)"}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: scanning ? "default" : "pointer",
              overflow: "hidden",
              transition: "border-color 0.2s ease",
            }}
          >
            <Fingerprint size={56} color={scanning ? "var(--scan)" : "var(--muted)"} strokeWidth={1.4} />
            {scanning && (
              <span
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  height: 3,
                  background: "linear-gradient(90deg, transparent, var(--scan), transparent)",
                  animation: "sweep 1.1s ease-in-out infinite",
                }}
              />
            )}
          </button>
        </div>

        <div style={{ textAlign: "center", minHeight: 20 }}>
          <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
            {employees.length === 0 ? "ƏVVƏLCƏ ADMİN PANELDƏN İŞÇİ ƏLAVƏ ET" : scanning ? "OXUNUR..." : "OXUTMAQ ÜÇÜN TOXUNUN"}
          </span>
        </div>

        <div style={{ width: "100%", borderTop: "1px solid var(--line)", paddingTop: 14, marginTop: 4 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)", cursor: "pointer" }}>
            <input type="checkbox" checked={useCustomTime} onChange={(e) => setUseCustomTime(e.target.checked)} />
            <Settings2 size={14} />
            Test üçün skan vaxtını dəyiş
          </label>
          {useCustomTime && (
            <input
              type="time"
              value={customTime}
              onChange={(e) => setCustomTime(e.target.value)}
              className="mono"
              style={{ marginTop: 8, width: "100%", background: "var(--panel-2)", border: "1px solid var(--line)", color: "var(--text)", borderRadius: 8, padding: "8px 10px", fontSize: 14 }}
            />
          )}
        </div>

        {flash && (
          <div
            className="log-enter"
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 12px",
              borderRadius: 10,
              fontSize: 13,
              background: flashBg(flash.variant),
              border: `1px solid ${flashColor(flash.variant)}`,
              color: flashColor(flash.variant),
            }}
          >
            {flash.variant === "danger" || flash.variant === "late" ? (
              <AlertTriangle size={16} />
            ) : flash.variant === "info" ? (
              <Coffee size={16} />
            ) : (
              <CheckCircle2 size={16} />
            )}
            {flash.msg}
          </div>
        )}
      </div>

      {/* Sağ tərəf: statistika + jurnal */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        <div className="stat-grid">
          <StatCard label="Bugünkü giriş" value={todayIn} icon={<LogIn size={16} />} />
          <StatCard label="Gecikən" value={todayLate} icon={<AlertTriangle size={16} />} warn={todayLate > 0} />
          <StatCard label="Cəmi qeyd" value={logs.length} icon={<Clock size={16} />} />
        </div>

        <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 16, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)", fontSize: 13, color: "var(--muted)", letterSpacing: 0.5 }}>
            GİRİŞ-ÇIXIŞ JURNALI
          </div>
          <div style={{ maxHeight: 460, overflowY: "auto" }}>
            {logs.length === 0 ? (
              <div style={{ padding: "40px 18px", textAlign: "center", color: "var(--muted)", fontSize: 14 }}>
                Hələ heç bir skan edilməyib. Solda "Oxutmaq üçün toxunun" düyməsini sınayın.
              </div>
            ) : (
              logs.map((l) => <LogRow key={l.id} log={l} />)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function flashBg(variant) {
  if (variant === "danger") return "rgba(232,97,61,0.14)";
  if (variant === "late") return "rgba(232,163,61,0.12)";
  if (variant === "info") return "rgba(77,173,232,0.12)";
  return "rgba(95,191,125,0.12)";
}
function flashColor(variant) {
  if (variant === "danger") return "var(--danger)";
  if (variant === "late") return "var(--late)";
  if (variant === "info") return "var(--info)";
  return "var(--ontime)";
}

function StatCard({ label, value, icon, warn }) {
  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 14, padding: "14px 16px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--muted)", fontSize: 12, marginBottom: 8 }}>
        {icon}
        {label}
      </div>
      <div className="mono" style={{ fontSize: 24, fontWeight: 700, color: warn ? "var(--late)" : "var(--text)" }}>
        {value}
      </div>
    </div>
  );
}

const STATUS_BADGE = {
  ontime: { label: "vaxtında", color: "var(--ontime)", bg: "rgba(95,191,125,0.12)" },
  late: { label: null, color: "var(--late)", bg: "rgba(232,163,61,0.12)" }, // label dinamik (dəq)
  halfday: { label: null, color: "var(--danger)", bg: "rgba(232,97,61,0.14)" }, // label dinamik
  "after-hours": { label: "iş saatından kənar", color: "var(--danger)", bg: "rgba(232,97,61,0.14)" },
  "lunch-return": { label: "nahardan qayıtdı", color: "var(--info)", bg: "rgba(77,173,232,0.12)" },
  "lunch-break": { label: "nahar fasiləsi", color: "var(--info)", bg: "rgba(77,173,232,0.12)" },
  "normal-out": { label: "çıxış", color: "var(--muted)", bg: "transparent" },
};

function LogRow({ log }) {
  const isIn = log.type === "in";
  const cfg = STATUS_BADGE[log.status] || STATUS_BADGE["normal-out"];
  let label = cfg.label;
  if (log.status === "late") label = `${log.lateMinutes} dəq gecikmə`;
  if (log.status === "halfday") label = `Yarım gün (${log.lateMinutes} dəq)`;

  return (
    <div className="log-enter log-row">
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: "50%",
          background: "var(--panel-2)",
          border: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          flexShrink: 0,
        }}
      >
        {log.initials}
      </div>
      <div style={{ flex: 1, minWidth: 90 }}>
        <div style={{ fontSize: 14 }}>{log.employeeName}</div>
        <div className="log-dept" style={{ fontSize: 12, color: "var(--muted)" }}>{log.dept}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: isIn ? "var(--ontime)" : "var(--muted)" }}>
        {isIn ? <LogIn size={14} /> : <LogOut size={14} />}
        {isIn ? "Giriş" : "Çıxış"}
      </div>
      <div className="mono" style={{ fontSize: 13, textAlign: "right", minWidth: 70 }}>
        {fmtTime(log.time)}
      </div>
      <div style={{ minWidth: 150, textAlign: "right" }}>
        <span
          className="mono"
          style={{
            fontSize: 11,
            color: cfg.color,
            background: cfg.bg,
            padding: cfg.bg === "transparent" ? 0 : "3px 8px",
            borderRadius: 999,
          }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

/* ---------------- ADMIN VIEW ---------------- */

function AdminView({ employees, newName, setNewName, newDept, setNewDept, addEmployee, removeEmployee, settings, setSettings }) {
  function updateSetting(key, value) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Şirkət iş qaydaları */}
      <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 16, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontSize: 13, color: "var(--muted)" }}>
          <SlidersHorizontal size={15} />
          ŞİRKƏT İŞ QAYDALARI
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <LabeledInput label="İş başlanğıcı" type="time" value={settings.workStart} onChange={(v) => updateSetting("workStart", v)} />
          <LabeledInput label="İş bitişi" type="time" value={settings.workEnd} onChange={(v) => updateSetting("workEnd", v)} />
          <LabeledInput label="Nahar başlanğıcı" type="time" value={settings.lunchStart} onChange={(v) => updateSetting("lunchStart", v)} />
          <LabeledInput label="Nahar bitişi" type="time" value={settings.lunchEnd} onChange={(v) => updateSetting("lunchEnd", v)} />
          <LabeledInput
            label="Gecikmə limiti (dəqiqə)"
            type="number"
            value={settings.graceMinutes}
            onChange={(v) => updateSetting("graceMinutes", v)}
          />
          <LabeledInput
            label="Yarım gün limiti (dəqiqə)"
            type="number"
            value={settings.absentMinutes}
            onChange={(v) => updateSetting("absentMinutes", v)}
          />
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)", cursor: "pointer" }}>
          <input type="checkbox" checked={settings.nightShift} onChange={(e) => updateSetting("nightShift", e.target.checked)} />
          <Moon size={14} />
          Gecə növbəsi rejimi
        </label>
      </div>

      {/* Yeni işçi */}
      <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 16, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontSize: 13, color: "var(--muted)" }}>
          <UserPlus size={15} />
          YENİ İŞÇİ ƏLAVƏ ET
        </div>
        <div className="admin-form">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ad Soyad" style={inputStyle()} />
          <input value={newDept} onChange={(e) => setNewDept(e.target.value)} placeholder="Şöbə (məs. Anbar)" style={inputStyle()} />
          <button
            onClick={addEmployee}
            disabled={!newName.trim()}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              background: newName.trim() ? "var(--scan)" : "var(--panel-2)",
              color: newName.trim() ? "#0d1a17" : "var(--muted)",
              border: "1px solid var(--line)",
              borderRadius: 10,
              padding: "10px 16px",
              fontSize: 13,
              fontWeight: 600,
              cursor: newName.trim() ? "pointer" : "not-allowed",
              whiteSpace: "nowrap",
            }}
          >
            <UserPlus size={15} />
            Əlavə et
          </button>
        </div>
      </div>

      {/* İşçi siyahısı */}
      <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 16, overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)", fontSize: 13, color: "var(--muted)", display: "flex", alignItems: "center", gap: 8 }}>
          <Users size={15} />
          İŞÇİ SİYAHISI ({employees.length})
        </div>
        {employees.length === 0 ? (
          <div style={{ padding: "40px 18px", textAlign: "center", color: "var(--muted)", fontSize: 14 }}>
            Hələ heç bir işçi əlavə edilməyib.
          </div>
        ) : (
          employees.map((e) => (
            <div key={e.id} className="admin-table-row">
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: "50%",
                  background: "var(--panel-2)",
                  border: "1px solid var(--line)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  flexShrink: 0,
                }}
              >
                {e.initials}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14 }}>{e.name}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{e.dept}</div>
              </div>
              <button
                onClick={() => removeEmployee(e.id)}
                aria-label="Sil"
                style={{
                  background: "transparent",
                  border: "1px solid var(--line)",
                  color: "var(--danger)",
                  borderRadius: 8,
                  padding: "7px 9px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function LabeledInput({ label, type, value, onChange }) {
  return (
    <div>
      <label className="mono" style={{ fontSize: 10, color: "var(--muted)", letterSpacing: 0.5, display: "block", marginBottom: 4 }}>
        {label.toUpperCase()}
      </label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle()} />
    </div>
  );
}

function inputStyle() {
  return {
    background: "var(--panel-2)",
    border: "1px solid var(--line)",
    color: "var(--text)",
    borderRadius: 10,
    padding: "10px 12px",
    fontSize: 14,
    width: "100%",
  };
}

/* ---------------- PASSWORD GATE ---------------- */

function PasswordGate({ pwInput, setPwInput, pwError, onSubmit, onClose }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(8,11,14,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={pwError ? "shake" : ""}
        style={{
          width: "100%",
          maxWidth: 320,
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: 16,
          padding: 22,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <Lock size={16} color="var(--scan)" />
          <div style={{ fontSize: 15, fontWeight: 600 }}>Admin Panelə Giriş</div>
        </div>
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6, marginBottom: 14 }}>
          Demo parol: <span className="mono">{"admin123"}</span>
        </p>
        <input
          type="password"
          autoFocus
          value={pwInput}
          onChange={(e) => setPwInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
          placeholder="Parol"
          style={inputStyle()}
        />
        {pwError && (
          <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 8 }}>
            Parol yanlışdır, yenidən cəhd et.
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ ...inputStyle(), cursor: "pointer", flex: 1, textAlign: "center" }}>
            İmtina
          </button>
          <button
            onClick={onSubmit}
            style={{
              flex: 1,
              background: "var(--scan)",
              color: "#0d1a17",
              border: "1px solid var(--line)",
              borderRadius: 10,
              padding: "10px 12px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Daxil ol
          </button>
        </div>
      </div>
    </div>
  );
}