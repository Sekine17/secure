import React, { useState, useMemo, useEffect } from "react";
import {
  Camera,
  CameraOff,
  ScanFace,
  LogIn,
  LogOut,
  AlertTriangle,
  CheckCircle2,
  Settings2,
  ShieldCheck,
  Lock,
  Trash2,
  UserPlus,
  ArrowLeft,
  Users,
  Moon,
  SlidersHorizontal,
  Download,
  X,
  ChevronDown,
  XCircle,
  KeyRound,
  ClipboardList,
  Wallet,
  Clock,
} from "lucide-react";
import "./App.css";
import { useCamera } from "./Camera";
import {
  dbGet,
  dbSet,
  verifyPassword,
  changePassword,
  isDefaultPassword,
  DEFAULT_PASSWORD,
} from "./Storage";
import {
  faceapi,
  loadModels,
  recognize,
  detectWithDescriptors,
  takeSnapshot,
  sleep,
} from "./Face";
import {
  DEFAULT_SETTINGS,
  STATUS_TEXT,
  fmtTime,
  initialsFor,
  uid,
  effectiveRules,
  isWorkingDay,
  resolveStatus,
  groupLogs,
  dateKey,
  toMinutes,
  fmtDuration,
} from "./Attandance";

const MAX_SAMPLES = 5;
const RESULT_MS = 6000;

const REASONS = [
  "Rəhbərlikdən icazə aldım",
  "Rəsmi iş / ezamiyyət",
  "Sağlamlıq",
  "Şəxsi iş",
  "Digər",
];
const APPROVAL_TEXT = {
  none: "səbəb göstərilməyib",
  pending: "təsdiq gözləyir",
  approved: "təsdiqləndi",
  rejected: "rədd edildi",
};
const EXTRA_STATUS = { back: "Çöldən qayıtdı" };

const money = (n) =>
  `${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)} ₼`;

// Hər başlanmış gecikmə bloku (standart 30 dəq) üçün cərimə (standart 0.10 ₼)
function penaltyFor(lateMin, s) {
  const block = Math.max(1, Number(s.penaltyBlock) || 30);
  const rate = Number(s.penaltyRate ?? 0.1) || 0;
  return lateMin > 0 ? Math.ceil(lateMin / block) * rate : 0;
}

// Bir işçinin seçilmiş ay üzrə gecikmə və cərimə göstəriciləri (hər günün ilk girişi)
function monthStats(emp, groups, month, settings) {
  let present = 0,
    lateDays = 0,
    lateMin = 0,
    penalty = 0;
  const rows = [];
  for (const [k, ev] of groups) {
    const [id, day] = k.split("|");
    if (id !== emp.id || !day.startsWith(month)) continue;
    const first = ev.find((x) => x.type === "in");
    if (!first) continue;
    present++;
    if (first.status === "late" || first.status === "halfday") {
      const p = penaltyFor(first.lateMinutes, settings);
      lateDays++;
      lateMin += first.lateMinutes;
      penalty += p;
      rows.push({ day, min: first.lateMinutes, p });
    }
  }
  rows.sort((a, b) => (a.day < b.day ? 1 : -1));
  return { present, lateDays, lateMin, penalty, rows };
}

/* ================= Əsas komponent ================= */

export default function CheckInKiosk() {
  const [employees, setEmployees] = useState([]);
  const [logs, setLogs] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [storeError, setStoreError] = useState("");

  const [models, setModels] = useState("loading");
  const [busy, setBusy] = useState(null); // null | countdown | verifying
  const [count, setCount] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState(null);
  const [face, setFace] = useState({ found: false, count: 0 });

  // Test vaxtı admin paneldən idarə olunur
  const [useCustomTime, setUseCustomTime] = useState(false);
  const [customTime, setCustomTime] = useState("09:00");

  const [view, setView] = useState("kiosk");
  const [adminAuthed, setAdminAuthed] = useState(false);
  const [showGate, setShowGate] = useState(false);
  const [enrollId, setEnrollId] = useState(null);

  const cam = useCamera();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [e, l, s] = await Promise.all([
          dbGet("employees"),
          dbGet("logs"),
          dbGet("settings"),
        ]);
        if (!alive) return;
        if (e) setEmployees(e);
        if (l) setLogs(l);
        if (s) setSettings({ ...DEFAULT_SETTINGS, ...s });
      } catch {
        if (alive)
          setStoreError(
            "Yaddaş oxuna bilmədi. Məlumatlar bu sessiyadan sonra itə bilər.",
          );
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    navigator.storage?.persist?.();
    return () => {
      alive = false;
    };
  }, []);

  const saveFail = () =>
    setStoreError(
      "Yaddaşa yazmaq mümkün olmadı (yer bitmiş ola bilər). Köhnə qeydləri CSV-yə çıxarıb sil.",
    );
  useEffect(() => {
    if (loaded) dbSet("employees", employees).catch(saveFail);
  }, [employees, loaded]);
  useEffect(() => {
    if (loaded) dbSet("logs", logs).catch(saveFail);
  }, [logs, loaded]);
  useEffect(() => {
    if (loaded) dbSet("settings", settings).catch(saveFail);
  }, [settings, loaded]);

  useEffect(() => {
    let alive = true;
    loadModels()
      .then(() => alive && setModels("ready"))
      .catch(() => alive && setModels("error"));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (view === "kiosk") cam.start();
    else cam.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Nəticə bir neçə saniyədən sonra silinir
  useEffect(() => {
    if (!result) return;
    const t = setTimeout(
      () => setResult(null),
      result.askReason ? 20000 : RESULT_MS,
    );
    return () => clearTimeout(t);
  }, [result]);

  // Canlı üz izləmə
  useEffect(() => {
    if (
      view !== "kiosk" ||
      cam.state !== "ready" ||
      models !== "ready" ||
      busy
    ) {
      if (!busy) setFace({ found: false, count: 0 });
      return;
    }
    let alive = true;
    let running = false;
    const id = setInterval(async () => {
      const v = cam.videoRef.current;
      if (running || !v || v.readyState < 2) return;
      running = true;
      try {
        const faces = await faceapi.detectAllFaces(
          v,
          new faceapi.TinyFaceDetectorOptions({
            inputSize: 224,
            scoreThreshold: 0.5,
          }),
        );
        if (alive) setFace({ found: faces.length > 0, count: faces.length });
      } catch {
        /* diqqətə alma */
      }
      running = false;
    }, 500);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, cam.state, models, busy]);

  const lastActionByEmp = useMemo(() => {
    const map = {};
    for (const l of logs)
      if (l.type !== "denied" && !(l.employeeId in map))
        map[l.employeeId] = l.type;
    return map;
  }, [logs]);

  const enrolled = useMemo(
    () => employees.filter((e) => e.descriptors?.length),
    [employees],
  );

  function resolveScanTime() {
    if (useCustomTime && /^\d{2}:\d{2}$/.test(customTime)) {
      const [h, m] = customTime.split(":").map(Number);
      const d = new Date();
      d.setHours(h, m, Math.floor(Math.random() * 50), 0);
      return d;
    }
    return new Date();
  }

  async function handleScan() {
    if (busy) return;
    setResult(null);
    const err = (msg) =>
      setResult({ kind: "error", title: "Yoxlama alınmadı", msg });

    if (models !== "ready") return err("Üz tanıma modeli hələ yüklənməyib.");
    if (cam.state !== "ready") return err("Kamera aktiv deyil.");
    if (enrolled.length === 0)
      return err(
        "Qeydiyyatlı üz yoxdur. Administrator işçi üzü əlavə etməlidir.",
      );

    setBusy("countdown");
    const secs = Math.max(0, Math.min(5, Number(settings.countdown) || 0));
    for (let i = secs; i > 0; i--) {
      setCount(i);
      await sleep(800);
    }
    setCount(0);
    setBusy("verifying");
    setPrompt("");

    let res;
    try {
      res = await recognize(
        cam.videoRef.current,
        enrolled,
        Number(settings.matchThreshold) || 0.5,
        {
          liveness: settings.liveness || "off",
          onPrompt: setPrompt,
        },
      );
    } catch {
      res = {
        kind: "fail",
        msg: "Üz yoxlaması zamanı xəta baş verdi. Yenidən cəhd et.",
      };
    }
    setPrompt("");

    if (res.kind === "fail") {
      setBusy(null);
      return err(res.msg);
    }

    const photo = settings.saveSnapshots ? res.photo : null;
    const createdAt = Date.now();

    if (res.kind === "unknown") {
      setLogs((prev) => [
        {
          id: uid(),
          employeeId: null,
          employeeName: "Tanınmayan şəxs",
          initials: "?",
          dept: "",
          type: "denied",
          time: new Date(createdAt),
          createdAt,
          lateMinutes: 0,
          status: "unknown",
          photo,
        },
        ...prev,
      ]);
      setBusy(null);
      return setResult({
        kind: "denied",
        title: "Girmədi",
        msg: "Üz qeydiyyatlı işçilərə uyğun gəlmir.",
        photo: res.photo,
      });
    }

    const emp = res.emp;
    const cooldown = Math.max(0, Number(settings.cooldownSec) || 0) * 1000;
    const recent = logs.find(
      (l) => l.employeeId === emp.id && l.type !== "denied",
    );
    if (recent && createdAt - (recent.createdAt || 0) < cooldown) {
      setBusy(null);
      return setResult({
        kind: "info",
        title: emp.name,
        msg: "Artıq qeydə alınıb. Bir neçə saniyə sonra yenidən cəhd et.",
        photo: res.photo,
      });
    }

    const time = resolveScanTime();
    const type = lastActionByEmp[emp.id] === "in" ? "out" : "in";
    const rules = effectiveRules(emp, settings);
    const working = isWorkingDay(time, settings, []);
    let { status, lateMinutes } = resolveStatus(time, type, rules, working);

    // Eyni gün çıxıb qayıdırsa, bu yeni "gecikmə" sayılmır
    const isReturn =
      type === "in" &&
      recent?.type === "out" &&
      dateKey(new Date(recent.time)) === dateKey(time);
    if (isReturn && ["ontime", "late", "halfday"].includes(status)) {
      status = recent.status === "lunch-break" ? "lunch-return" : "back";
      lateMinutes = 0;
    }

    // İş saatları ərzində (nahar və iş günü sonu istisna) çıxış
    const nowMin = time.getHours() * 60 + time.getMinutes();
    const midDay =
      type === "out" &&
      status === "normal-out" &&
      working &&
      !rules.nightShift &&
      nowMin < toMinutes(rules.workEnd);
    const logId = uid();

    setLogs((prev) => [
      {
        id: logId,
        employeeId: emp.id,
        employeeName: emp.name,
        initials: emp.initials,
        dept: emp.dept,
        type,
        time,
        createdAt,
        lateMinutes,
        status,
        photo,
        midDay,
        reason: null,
        approval: midDay ? "none" : null,
      },
      ...prev,
    ]);
    setBusy(null);

    // Qayıdışda çöldə olma müddəti
    let away = "";
    if (isReturn) {
      const mins = Math.max(0, (time - new Date(recent.time)) / 60000);
      if (recent.midDay) {
        away = `Çöldə olduğunuz müddət: ${fmtDuration(mins)}. Səbəb: ${recent.reason || "göstərilməyib"} (${APPROVAL_TEXT[recent.approval] || "göstərilməyib"}).`;
      } else if (recent.status === "lunch-break") {
        away = `Nahar fasiləsi bitdi. Fasilə müddəti: ${fmtDuration(mins)}.`;
      }
    }

    const pen =
      status === "late" || status === "halfday"
        ? penaltyFor(lateMinutes, settings)
        : 0;
    const lateTxt = `${lateMinutes} dəq gecikmə qeyd olundu. Cərimə: ${money(pen)}.`;
    const MSG = {
      ontime: "Uğurlu iş günü!",
      late: lateTxt,
      halfday: `Çox gec gəldiniz, yarım gün sayılır. ${lateTxt}`,
      "after-hours": "İş günü bitib, bu giriş qeyri-adi kimi qeyd edildi.",
      dayoff: "Bu gün istirahət günüdür, giriş qeyd edildi.",
      "lunch-break": `Nahar fasiləsi başladı. Qayıdış vaxtı: ${rules.lunchEnd}.`,
      "normal-out": midDay
        ? `Normal iş saatı ${rules.workEnd}-də bitir. Çıxış səbəbini seçin.`
        : "Çıxış qeyd olundu.",
    };
    const first = emp.name.split(" ")[0];
    const title =
      type === "in"
        ? `Xoş gəl${isReturn ? "diniz" : "misiniz"}, ${first}!`
        : status === "lunch-break"
          ? `Xoş istirahətlər, ${first}!`
          : midDay
            ? `${first}, iş saatları ərzində çıxdınız`
            : `Sağ olun, ${first}!`;

    setResult({
      kind: type,
      title,
      name: emp.name,
      dept: emp.dept,
      msg: away || MSG[status] || "",
      warn: ["late", "halfday", "after-hours"].includes(status) || midDay,
      time,
      photo: res.photo,
      askReason: midDay,
      logId,
    });
  }

  function submitReason(logId, reason) {
    setLogs((prev) =>
      prev.map((l) =>
        l.id === logId ? { ...l, reason, approval: "pending" } : l,
      ),
    );
    setResult(
      (r) =>
        r && {
          ...r,
          askReason: false,
          msg: `Səbəb qeyd olundu: ${reason}. Admin təsdiqi gözlənilir.`,
        },
    );
  }

  /* ---------- Admin əməliyyatları ---------- */

  const deleteLog = (id) => setLogs((prev) => prev.filter((l) => l.id !== id));
  const clearLogs = () => {
    if (
      window.confirm(
        "Bütün giriş-çıxış jurnalı silinsin? Bu əməliyyat geri qaytarılmır.",
      )
    )
      setLogs([]);
  };

  function exportCsv() {
    const head = ["Ad", "Şöbə", "Növ", "Vaxt", "Status", "Gecikmə (dəq)"];
    const rows = [...logs]
      .reverse()
      .map((l) => [
        l.employeeName,
        l.dept,
        l.type === "in" ? "Giriş" : l.type === "out" ? "Çıxış" : "Rədd edildi",
        new Date(l.time).toLocaleString("az-AZ"),
        STATUS_TEXT[l.status] || EXTRA_STATUS[l.status] || l.status,
        l.lateMinutes,
      ]);
    const csv = [head, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(
      new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `davamiyyet-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function addEmployee(name, dept) {
    const id = `emp-${Date.now()}`;
    setEmployees((prev) => [
      ...prev,
      {
        id,
        name,
        dept: dept || "Təyin edilməyib",
        initials: initialsFor(name),
        descriptors: [],
        avatar: null,
        createdAt: Date.now(),
      },
    ]);
    setEnrollId(id);
  }

  function removeEmployee(id) {
    const e = employees.find((x) => x.id === id);
    if (
      !window.confirm(
        `${e?.name || "İşçi"} silinsin? Üz məlumatı da silinəcək, jurnal qeydləri qalacaq.`,
      )
    )
      return;
    setEmployees((prev) => prev.filter((x) => x.id !== id));
  }

  function clearFace(id) {
    if (!window.confirm("Bu işçinin üz məlumatı silinsin?")) return;
    setEmployees((prev) =>
      prev.map((e) =>
        e.id === id ? { ...e, descriptors: [], avatar: null } : e,
      ),
    );
  }

  function saveEnrollment(id, samples) {
    setEmployees((prev) =>
      prev.map((e) =>
        e.id === id
          ? {
              ...e,
              descriptors: samples.map((s) => s.descriptor),
              avatar: samples[0]?.photo || null,
            }
          : e,
      ),
    );
    setEnrollId(null);
  }

  const updateEmployee = (id, patch) =>
    setEmployees((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    );
  const setApproval = (id, approval, note) =>
    setLogs((prev) =>
      prev.map((l) =>
        l.id === id ? { ...l, approval, adminNote: note ?? l.adminNote } : l,
      ),
    );

  const enrollEmp = employees.find((e) => e.id === enrollId);

  return (
    <div className="ck">
      <div className="ck-wrap">
        <div className="ck-topbar">
          <div>
            <h1 className="ck-title">
              {view === "kiosk" ? "İşçi giriş və çıxış sistemi" : "Admin panel"}
            </h1>
            <p className="ck-sub">
              {view === "kiosk"
                ? "Düyməyə bas və kameraya düz bax. Nəticə ekranda görünəcək."
                : "İşçiləri, jurnalı və iş qaydalarını yalnız bu bölmədən idarə etmək olar."}
            </p>
          </div>
          {view === "kiosk" ? (
            <button
              className="ck-btn"
              onClick={() =>
                adminAuthed ? setView("admin") : setShowGate(true)
              }
            >
              <ShieldCheck size={15} />
              Admin
            </button>
          ) : (
            <button className="ck-btn" onClick={() => setView("kiosk")}>
              <ArrowLeft size={15} />
              Terminala qayıt
            </button>
          )}
        </div>

        {storeError && <div className="ck-warn">{storeError}</div>}

        {view === "kiosk" ? (
          <KioskView
            models={models}
            busy={busy}
            count={count}
            prompt={prompt}
            handleScan={handleScan}
            result={result}
            cam={cam}
            face={face}
            onReason={submitReason}
            onSkip={() => setResult((r) => r && { ...r, askReason: false })}
          />
        ) : (
          <AdminView
            employees={employees}
            logs={logs}
            settings={settings}
            setSettings={setSettings}
            addEmployee={addEmployee}
            removeEmployee={removeEmployee}
            clearFace={clearFace}
            onEnroll={setEnrollId}
            deleteLog={deleteLog}
            clearLogs={clearLogs}
            exportCsv={exportCsv}
            updateEmployee={updateEmployee}
            setApproval={setApproval}
            useCustomTime={useCustomTime}
            setUseCustomTime={setUseCustomTime}
            customTime={customTime}
            setCustomTime={setCustomTime}
          />
        )}
      </div>

      {enrollEmp && (
        <EnrollModal
          emp={enrollEmp}
          models={models}
          onSave={saveEnrollment}
          onClose={() => setEnrollId(null)}
        />
      )}
      {showGate && (
        <PasswordGate
          onClose={() => setShowGate(false)}
          onSuccess={() => {
            setAdminAuthed(true);
            setShowGate(false);
            setView("admin");
          }}
        />
      )}
    </div>
  );
}

/* ================= Kiosk: yalnız skan və nəticə ================= */

function KioskView({
  models,
  busy,
  count,
  prompt,
  handleScan,
  result,
  cam,
  face,
  onReason,
  onSkip,
}) {
  const ready = cam.state === "ready";
  const viewClass = busy
    ? "work"
    : result?.kind === "denied" || result?.kind === "error"
      ? "fail"
      : ready && face.found
        ? "found"
        : "";

  let chipText = "";
  if (models === "loading") chipText = "Üz tanıma modeli yüklənir...";
  else if (busy === "verifying") chipText = prompt || "Üz yoxlanılır...";
  else if (busy === "countdown") chipText = "Kameraya düz bax";
  else if (ready)
    chipText =
      face.count > 1
        ? "Kadrda bir nəfər olmalıdır"
        : face.found
          ? "Üz tapıldı"
          : "Üz axtarılır";

  const btnText =
    busy === "countdown"
      ? "Hazır ol..."
      : busy === "verifying"
        ? "Yoxlanılır..."
        : "Üzü yoxla";

  return (
    <div
      className="ck-card ck-pad ck-col"
      style={{ maxWidth: 560, margin: "0 auto", width: "100%" }}
    >
      <div className={`ck-view ${viewClass}`}>
        <video ref={cam.videoRef} className="ck-video" playsInline muted />
        {ready && (
          <>
            <span className="ck-corner tl" />
            <span className="ck-corner tr" />
            <span className="ck-corner bl" />
            <span className="ck-corner br" />
            {busy === "verifying" && <span className="ck-scanline" />}
            {busy === "countdown" && count > 0 && (
              <div className="ck-count">{count}</div>
            )}
            {chipText && (
              <div className="ck-chip">
                <span className="ck-dot" />
                {chipText}
              </div>
            )}
          </>
        )}
        {cam.state === "starting" && (
          <div className="ck-overlay">
            <Camera size={30} />
            <span>Kamera açılır...</span>
          </div>
        )}
        {cam.state === "idle" && (
          <div className="ck-overlay">
            <CameraOff size={30} />
            <strong>Kamera bağlıdır</strong>
          </div>
        )}
        {cam.state === "error" && (
          <div className="ck-overlay">
            <AlertTriangle size={30} color="var(--bad)" />
            <strong>Kamera açılmadı</strong>
            <span>{cam.error}</span>
          </div>
        )}
      </div>

      <button
        className="ck-btn ck-btn-primary ck-btn-big"
        onClick={handleScan}
        disabled={!!busy || models !== "ready" || !ready}
      >
        <ScanFace size={19} />
        {btnText}
      </button>

      {models === "error" && (
        <div className="ck-flash danger">
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          Üz tanıma modeli yüklənmədi. İnternet bağlantısını yoxla və səhifəni
          yenilə.
        </div>
      )}

      {result && (
        <ResultCard result={result} onReason={onReason} onSkip={onSkip} />
      )}
    </div>
  );
}

function ResultCard({ result, onReason, onSkip }) {
  const { kind, title, name, dept, msg, warn, time, photo, askReason, logId } =
    result;
  const variant =
    kind === "in" || kind === "out"
      ? warn
        ? "late"
        : "ontime"
      : kind === "info"
        ? "info"
        : "danger";
  const Icon =
    kind === "in"
      ? LogIn
      : kind === "out"
        ? LogOut
        : kind === "denied"
          ? XCircle
          : kind === "info"
            ? CheckCircle2
            : AlertTriangle;

  return (
    <>
      <div
        className={`ck-flash ${variant}`}
        role="status"
        style={{ alignItems: "center", gap: 14, padding: 16 }}
      >
        {photo ? (
          <img
            src={photo}
            alt=""
            style={{
              width: 72,
              height: 54,
              objectFit: "cover",
              borderRadius: 8,
              flexShrink: 0,
            }}
          />
        ) : (
          <Icon size={28} style={{ flexShrink: 0 }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 20,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {photo && <Icon size={20} />}
            {title}
          </div>
          {name && (
            <div style={{ fontWeight: 600 }}>
              {name}
              {dept ? ` · ${dept}` : ""}
            </div>
          )}
          {msg && <div style={{ fontSize: 13, opacity: 0.9 }}>{msg}</div>}
          {time && (
            <div style={{ fontSize: 12, opacity: 0.75 }}>{fmtTime(time)}</div>
          )}
        </div>
      </div>
      {askReason && (
        <ReasonBox logId={logId} onReason={onReason} onSkip={onSkip} />
      )}
    </>
  );
}

function ReasonBox({ logId, onReason, onSkip }) {
  const [sel, setSel] = useState("");
  const [text, setText] = useState("");
  const value = sel === "Digər" ? text.trim() : sel;
  return (
    <div className="ck-card ck-pad" style={{ display: "grid", gap: 8 }}>
      <div className="ck-sect" style={{ marginBottom: 0 }}>
        <Clock size={16} />
        Çıxış səbəbi
      </div>
      {REASONS.map((r) => (
        <label key={r} className="ck-toggle">
          <input
            type="radio"
            name="reason"
            checked={sel === r}
            onChange={() => setSel(r)}
          />
          {r}
        </label>
      ))}
      {sel === "Digər" && (
        <input
          className="ck-field"
          maxLength={200}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Mesajını yaz"
          aria-label="Mesaj"
        />
      )}
      <div className="ck-row">
        <button className="ck-btn" style={{ flex: 1 }} onClick={onSkip}>
          Keç
        </button>
        <button
          className="ck-btn ck-btn-primary"
          style={{ flex: 1 }}
          onClick={() => onReason(logId, value)}
          disabled={!value}
        >
          Göndər
        </button>
      </div>
    </div>
  );
}

/* ================= Admin görünüşü ================= */

function AdminView(props) {
  const [tab, setTab] = useState("employees");
  const pending = props.logs.filter(
    (l) => l.midDay && l.approval === "pending",
  ).length;
  const tabs = [
    ["employees", "İşçilər", Users],
    ["pay", "Maaş və cərimə", Wallet],
    ["leaves", `İcazələr${pending ? ` (${pending})` : ""}`, Clock],
    ["logs", "Jurnal", ClipboardList],
    ["settings", "Ayarlar", SlidersHorizontal],
  ];
  return (
    <div className="ck-col">
      <div
        className="ck-tabs"
        role="tablist"
        style={{ alignSelf: "flex-start" }}
      >
        {tabs.map(([k, label, Icon]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={`ck-tab ${tab === k ? "on" : ""}`}
            onClick={() => setTab(k)}
          >
            <Icon size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
            {label}
          </button>
        ))}
      </div>
      {tab === "employees" && <EmployeesPanel {...props} />}
      {tab === "logs" && <LogsPanel {...props} />}
      {tab === "settings" && <SettingsPanel {...props} />}
      {tab === "pay" && <PayPanel {...props} />}
      {tab === "leaves" && <LeavesPanel {...props} />}
    </div>
  );
}

function PayPanel({ employees, logs, settings, setSettings, updateEmployee }) {
  const [month, setMonth] = useState(dateKey(new Date()).slice(0, 7));
  const groups = useMemo(() => groupLogs(logs), [logs]);
  const upd = (k, v) => setSettings((p) => ({ ...p, [k]: v }));
  const rows = employees.map((e) => ({
    e,
    st: monthStats(e, groups, month, settings),
  }));
  const total = rows.reduce((a, r) => a + r.st.penalty, 0);

  return (
    <>
      <div className="ck-card ck-pad">
        <div className="ck-sect">
          <Wallet size={16} />
          Cərimə qaydası
        </div>
        <div className="ck-admin-grid">
          <LabeledInput
            label="Gecikmə bloku (dəqiqə)"
            type="number"
            min="1"
            value={settings.penaltyBlock ?? 30}
            onChange={(v) => upd("penaltyBlock", v)}
          />
          <LabeledInput
            label="Hər blok üçün cərimə (₼)"
            type="number"
            step="0.01"
            min="0"
            value={settings.penaltyRate ?? 0.1}
            onChange={(v) => upd("penaltyRate", v)}
            hint="0.10 ₼ = 10 qəpik"
          />
          <div>
            <label className="ck-label">Ay</label>
            <input
              className="ck-field"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
        </div>
        <p className="ck-hint">
          Gecikmə hər günün ilk girişinə görə hesablanır. Hər başlanmış blok
          cərimələnir (məs. 32 dəq = 2 blok = 0.20 ₼). Bu ay cəmi cərimə:{" "}
          <b>{money(total)}</b>
        </p>
      </div>

      {rows.length === 0 && (
        <div className="ck-card ck-empty">Hələ işçi yoxdur.</div>
      )}

      {rows.map(({ e, st }) => {
        const salary = Number(e.salary) || 0;
        const net = Math.max(0, salary - st.penalty);
        const custom = e.shift && Object.keys(e.shift).length > 0;
        return (
          <div key={e.id} className="ck-card ck-pad">
            <div className="ck-sect">
              <Users size={16} />
              {e.name} <small style={{ color: "var(--muted)" }}>{e.dept}</small>
            </div>
            <div className="ck-admin-grid">
              <LabeledInput
                label="Aylıq maaş (₼)"
                type="number"
                min="0"
                step="0.01"
                value={e.salary ?? ""}
                onChange={(v) => updateEmployee(e.id, { salary: v })}
              />
              {[
                ["workStart", "İş başlanğıcı"],
                ["workEnd", "İş bitişi"],
                ["lunchStart", "Nahar başlanğıcı"],
                ["lunchEnd", "Nahar bitişi"],
              ].map(([k, l]) => (
                <LabeledInput
                  key={k}
                  label={l}
                  type="time"
                  value={e.shift?.[k] ?? settings[k]}
                  onChange={(v) =>
                    v &&
                    updateEmployee(e.id, {
                      shift: { ...(e.shift || {}), [k]: v },
                    })
                  }
                />
              ))}
            </div>
            {custom && (
              <button
                className="ck-btn ck-btn-sm"
                style={{ marginTop: 8 }}
                onClick={() => updateEmployee(e.id, { shift: {} })}
              >
                Şirkət saatlarına qaytar
              </button>
            )}
            <div className="ck-stats" style={{ marginTop: 12 }}>
              <Stat
                label="Gəldiyi gün"
                value={st.present}
                icon={<LogIn size={15} />}
              />
              <Stat
                label="Gecikmə günü"
                value={st.lateDays}
                icon={<AlertTriangle size={15} />}
                warn={st.lateDays > 0}
              />
              <Stat
                label="Cərimə"
                value={money(st.penalty)}
                icon={<Wallet size={15} />}
                warn={st.penalty > 0}
              />
              <Stat
                label="Xalis maaş"
                value={money(net)}
                icon={<Wallet size={15} />}
              />
            </div>
            {st.rows.length > 0 && (
              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: "pointer", fontSize: 13 }}>
                  Gecikmə günləri ({st.rows.length})
                </summary>
                {st.rows.map((r) => (
                  <div key={r.day} className="ck-hint">
                    {r.day.split("-").reverse().join(".")}: {r.min} dəq gecikmə,
                    cərimə {money(r.p)}
                  </div>
                ))}
              </details>
            )}
          </div>
        );
      })}
    </>
  );
}

function LeavesPanel({ logs, setApproval }) {
  const items = logs.filter((l) => l.midDay);
  const ask = (l, approval) => {
    const n = window.prompt("Qeyd (istəyə bağlı)", l.adminNote || "");
    if (n !== null) setApproval(l.id, approval, n);
  };
  return (
    <div className="ck-card" style={{ overflow: "hidden" }}>
      <div
        className="ck-sect"
        style={{ padding: "16px 20px 12px", marginBottom: 0 }}
      >
        <Clock size={16} />
        İş vaxtı çıxışlar ({items.length})
      </div>
      {items.length === 0 ? (
        <div
          className="ck-empty"
          style={{ borderTop: "1px solid var(--line)" }}
        >
          İş saatları ərzində çıxış olmayıb.
        </div>
      ) : (
        items.map((l) => (
          <div key={l.id} className="ck-emp">
            <div className="ck-avatar">
              {l.photo ? <img src={l.photo} alt="" /> : l.initials}
            </div>
            <div className="ck-log-main">
              <div className="ck-log-name">{l.employeeName}</div>
              <div className="ck-log-dept" style={{ display: "block" }}>
                {new Date(l.time).toLocaleString("az-AZ")}
              </div>
              <div className="ck-hint" style={{ marginTop: 2 }}>
                {l.reason || "Səbəb göstərilməyib"} ·{" "}
                {APPROVAL_TEXT[l.approval] || ""}
                {l.adminNote ? ` · Qeyd: ${l.adminNote}` : ""}
              </div>
            </div>
            <button
              className="ck-btn ck-btn-sm"
              onClick={() => ask(l, "approved")}
            >
              Təsdiqlə
            </button>
            <button
              className="ck-btn ck-btn-sm ck-btn-danger"
              onClick={() => ask(l, "rejected")}
            >
              Rədd et
            </button>
          </div>
        ))
      )}
    </div>
  );
}

function EmployeesPanel({
  employees,
  addEmployee,
  removeEmployee,
  clearFace,
  onEnroll,
}) {
  const [name, setName] = useState("");
  const [dept, setDept] = useState("");
  const submit = () => {
    if (!name.trim()) return;
    addEmployee(name.trim(), dept.trim());
    setName("");
    setDept("");
  };
  return (
    <div className="ck-card" style={{ overflow: "hidden" }}>
      <div
        className="ck-sect"
        style={{ padding: "16px 20px 12px", marginBottom: 0 }}
      >
        <Users size={16} />
        İşçilər ({employees.length})
      </div>
      <div className="ck-pad" style={{ paddingTop: 4 }}>
        <div className="ck-add">
          <input
            className="ck-field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ad Soyad"
            aria-label="Ad Soyad"
          />
          <input
            className="ck-field"
            value={dept}
            onChange={(e) => setDept(e.target.value)}
            placeholder="Şöbə (məs. Anbar)"
            aria-label="Şöbə"
          />
          <button
            className="ck-btn ck-btn-primary"
            onClick={submit}
            disabled={!name.trim()}
          >
            <UserPlus size={15} />
            Əlavə et
          </button>
        </div>
        <p className="ck-hint">
          İşçi əlavə edəndən sonra üzünü qeydiyyatdan keçirmək pəncərəsi açılır.
        </p>
      </div>
      {employees.length === 0 ? (
        <div
          className="ck-empty"
          style={{ borderTop: "1px solid var(--line)" }}
        >
          Hələ heç bir işçi əlavə edilməyib.
        </div>
      ) : (
        employees.map((e) => {
          const n = e.descriptors?.length || 0;
          return (
            <div key={e.id} className="ck-emp">
              <div className="ck-avatar">
                {e.avatar ? <img src={e.avatar} alt="" /> : e.initials}
              </div>
              <div className="ck-log-main">
                <div className="ck-log-name">{e.name}</div>
                <div className="ck-log-dept" style={{ display: "block" }}>
                  {e.dept}
                </div>
                <div className={n ? "ck-face-ok" : "ck-face-none"}>
                  {n
                    ? `${n} üz nümunəsi qeydiyyatdadır`
                    : "Üz qeydiyyatdan keçməyib"}
                </div>
              </div>
              <button
                className="ck-btn ck-btn-sm"
                onClick={() => onEnroll(e.id)}
              >
                <ScanFace size={14} />
                {n ? "Yenilə" : "Üz əlavə et"}
              </button>
              {n > 0 && (
                <button
                  className="ck-btn ck-btn-sm ck-btn-danger"
                  onClick={() => clearFace(e.id)}
                >
                  Üzü sil
                </button>
              )}
              <button
                className="ck-btn ck-btn-sm ck-btn-danger"
                onClick={() => removeEmployee(e.id)}
                aria-label={`${e.name} sil`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

const STATUS_BADGE = {
  ontime: { color: "var(--ok)", bg: "rgba(98,197,138,.13)" },
  late: { color: "var(--late)", bg: "rgba(233,176,74,.13)" },
  halfday: { color: "var(--bad)", bg: "rgba(238,107,91,.14)" },
  "after-hours": { color: "var(--bad)", bg: "rgba(238,107,91,.14)" },
  "lunch-return": { color: "var(--info)", bg: "rgba(108,196,232,.13)" },
  "lunch-break": { color: "var(--info)", bg: "rgba(108,196,232,.13)" },
  dayoff: { color: "var(--late)", bg: "rgba(233,176,74,.13)" },
  "normal-out": { color: "var(--muted)", bg: "transparent" },
  back: { color: "var(--info)", bg: "rgba(108,196,232,.13)" },
  unknown: { color: "var(--bad)", bg: "rgba(238,107,91,.14)" },
};

function LogsPanel({ logs, deleteLog, clearLogs, exportCsv }) {
  const [filter, setFilter] = useState("all");
  const [photo, setPhoto] = useState(null);

  const todayIn = logs.filter((l) => l.type === "in").length;
  const late = logs.filter(
    (l) => l.type === "in" && (l.status === "late" || l.status === "halfday"),
  ).length;
  const denied = logs.filter((l) => l.type === "denied").length;

  const visible = logs.filter((l) => {
    if (filter === "in") return l.type === "in";
    if (filter === "out") return l.type === "out";
    if (filter === "late") return l.status === "late" || l.status === "halfday";
    if (filter === "denied") return l.type === "denied";
    return true;
  });

  return (
    <>
      <div className="ck-stats">
        <Stat label="Giriş" value={todayIn} icon={<LogIn size={15} />} />
        <Stat
          label="Gecikən"
          value={late}
          icon={<AlertTriangle size={15} />}
          warn={late > 0}
        />
        <Stat
          label="Rədd edilən"
          value={denied}
          icon={<XCircle size={15} />}
          warn={denied > 0}
        />
      </div>
      <div className="ck-card" style={{ overflow: "hidden" }}>
        <div className="ck-loghead">
          <div className="ck-tabs" role="tablist">
            {[
              ["all", "Hamısı"],
              ["in", "Giriş"],
              ["out", "Çıxış"],
              ["late", "Gecikmə"],
              ["denied", "Rədd edilən"],
            ].map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={filter === k}
                className={`ck-tab ${filter === k ? "on" : ""}`}
                onClick={() => setFilter(k)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="ck-row">
            <button
              className="ck-btn"
              onClick={exportCsv}
              disabled={!logs.length}
            >
              <Download size={14} />
              CSV
            </button>
            <button
              className="ck-btn ck-btn-danger"
              onClick={clearLogs}
              disabled={!logs.length}
            >
              <Trash2 size={14} />
              Hamısını sil
            </button>
          </div>
        </div>
        <div className="ck-logbody">
          {logs.length === 0 ? (
            <div className="ck-empty">Hələ heç bir skan edilməyib.</div>
          ) : visible.length === 0 ? (
            <div className="ck-empty">Bu filtrə uyğun qeyd yoxdur.</div>
          ) : (
            visible.map((l) => (
              <LogRow
                key={l.id}
                log={l}
                onPhoto={setPhoto}
                onDelete={deleteLog}
              />
            ))
          )}
        </div>
      </div>
      {photo && (
        <div className="ck-modal" onClick={() => setPhoto(null)}>
          <div
            className="ck-card ck-modal-photo"
            onClick={(e) => e.stopPropagation()}
          >
            <img src={photo} alt="Skan zamanı çəkilən şəkil" />
            <button
              className="ck-btn"
              onClick={() => setPhoto(null)}
              aria-label="Bağla"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function Stat({ label, value, icon, warn }) {
  return (
    <div className="ck-card ck-stat">
      <div className="ck-stat-l">
        {icon}
        {label}
      </div>
      <div
        className="ck-stat-v"
        style={{ color: warn ? "var(--late)" : "var(--text)" }}
      >
        {value}
      </div>
    </div>
  );
}

function LogRow({ log, onPhoto, onDelete }) {
  const isIn = log.type === "in";
  const isDenied = log.type === "denied";
  const cfg = STATUS_BADGE[log.status] || STATUS_BADGE["normal-out"];
  let label = STATUS_TEXT[log.status] || EXTRA_STATUS[log.status] || log.status;
  if (log.status === "late") label = `${log.lateMinutes} dəq gecikmə`;
  if (log.status === "halfday") label = `Yarım gün (${log.lateMinutes} dəq)`;

  return (
    <div className="ck-log">
      {log.photo ? (
        <button
          className="ck-avatar"
          onClick={() => onPhoto(log.photo)}
          aria-label={`${log.employeeName} şəklini böyüt`}
        >
          <img src={log.photo} alt="" />
        </button>
      ) : (
        <div className="ck-avatar">{log.initials}</div>
      )}
      <div className="ck-log-main">
        <div className="ck-log-name">{log.employeeName}</div>
        <div className="ck-log-dept">
          {log.dept}
          {log.midDay
            ? ` · ${log.reason || "Səbəb göstərilməyib"} (${APPROVAL_TEXT[log.approval] || ""})`
            : ""}
        </div>
      </div>
      <div
        className="ck-dir"
        style={{
          color: isDenied ? "var(--bad)" : isIn ? "var(--ok)" : "var(--muted)",
        }}
      >
        {isDenied ? (
          <X size={14} />
        ) : isIn ? (
          <LogIn size={14} />
        ) : (
          <LogOut size={14} />
        )}
        {isDenied ? "Rədd" : isIn ? "Giriş" : "Çıxış"}
      </div>
      <div className="ck-time">{fmtTime(log.time)}</div>
      <div style={{ minWidth: 130, textAlign: "right" }}>
        <span
          className="ck-badge"
          style={{
            color: cfg.color,
            background: cfg.bg,
            padding: cfg.bg === "transparent" ? 0 : undefined,
          }}
        >
          {label}
        </span>
      </div>
      <button
        className="ck-btn ck-btn-danger ck-btn-sm"
        onClick={() => onDelete(log.id)}
        aria-label="Qeydi sil"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function SettingsPanel({
  settings,
  setSettings,
  useCustomTime,
  setUseCustomTime,
  customTime,
  setCustomTime,
}) {
  const update = (key, value) =>
    setSettings((prev) => ({ ...prev, [key]: value }));
  return (
    <>
      <div className="ck-card ck-pad">
        <div className="ck-sect">
          <ScanFace size={16} />
          Üz yoxlaması
        </div>
        <div className="ck-admin-grid">
          <LabeledInput
            label="Uyğunluq həddi (0.3–0.7)"
            type="number"
            step="0.05"
            min="0.3"
            max="0.7"
            value={settings.matchThreshold}
            onChange={(v) => update("matchThreshold", v)}
            hint="Kiçik rəqəm daha sərt yoxlayır. Tövsiyə: 0.5"
          />
          <LabeledInput
            label="Təkrar skan fasiləsi (saniyə)"
            type="number"
            min="0"
            value={settings.cooldownSec}
            onChange={(v) => update("cooldownSec", v)}
            hint="Eyni işçi təsadüfən iki dəfə qeyd olunmasın"
          />
          <LabeledInput
            label="Geri sayım (0–5 saniyə)"
            type="number"
            min="0"
            max="5"
            value={settings.countdown}
            onChange={(v) => update("countdown", v)}
          />
          <div>
            <label className="ck-label">Canlılıq yoxlaması</label>
            <div className="ck-select-wrap">
              <select
                className="ck-field"
                value={settings.liveness}
                onChange={(e) => update("liveness", e.target.value)}
              >
                <option value="off">Söndürülüb</option>
                <option value="blink">Göz qırpma</option>
                <option value="turn">Baş çevirmə</option>
                <option value="random">Təsadüfi</option>
              </select>
              <ChevronDown size={16} />
            </div>
            <div className="ck-hint">Foto ilə aldatmanın qarşısını alır</div>
          </div>
        </div>
        <label className="ck-toggle">
          <input
            type="checkbox"
            checked={settings.saveSnapshots}
            onChange={(e) => update("saveSnapshots", e.target.checked)}
          />
          <span>
            Skan şəklini jurnalda saxla{" "}
            <small>(tanınmayan şəxslərin şəkli də daxil)</small>
          </span>
        </label>
        <div
          style={{
            borderTop: "1px solid var(--line)",
            paddingTop: 12,
            marginTop: 8,
          }}
        >
          <label
            className="ck-toggle"
            style={{ color: "var(--muted)", padding: 0 }}
          >
            <input
              type="checkbox"
              checked={useCustomTime}
              onChange={(e) => setUseCustomTime(e.target.checked)}
            />
            <Settings2 size={14} />
            Test üçün skan vaxtını dəyiş
          </label>
          {useCustomTime && (
            <input
              type="time"
              className="ck-field"
              style={{ marginTop: 8 }}
              value={customTime}
              onChange={(e) => setCustomTime(e.target.value)}
            />
          )}
        </div>
      </div>

      <div className="ck-card ck-pad">
        <div className="ck-sect">
          <SlidersHorizontal size={16} />
          Şirkət iş qaydaları
        </div>
        <div className="ck-admin-grid">
          <LabeledInput
            label="İş başlanğıcı"
            type="time"
            value={settings.workStart}
            onChange={(v) => update("workStart", v)}
          />
          <LabeledInput
            label="İş bitişi"
            type="time"
            value={settings.workEnd}
            onChange={(v) => update("workEnd", v)}
          />
          <LabeledInput
            label="Nahar başlanğıcı"
            type="time"
            value={settings.lunchStart}
            onChange={(v) => update("lunchStart", v)}
          />
          <LabeledInput
            label="Nahar bitişi"
            type="time"
            value={settings.lunchEnd}
            onChange={(v) => update("lunchEnd", v)}
          />
          <LabeledInput
            label="Gecikmə limiti (dəqiqə)"
            type="number"
            value={settings.graceMinutes}
            onChange={(v) => update("graceMinutes", v)}
          />
          <LabeledInput
            label="Yarım gün limiti (dəqiqə)"
            type="number"
            value={settings.absentMinutes}
            onChange={(v) => update("absentMinutes", v)}
          />
        </div>
        <label className="ck-toggle">
          <input
            type="checkbox"
            checked={settings.nightShift}
            onChange={(e) => update("nightShift", e.target.checked)}
          />
          <Moon size={14} style={{ marginTop: 2 }} />
          Gecə növbəsi rejimi
        </label>
      </div>

      <PasswordCard />
    </>
  );
}

function PasswordCard() {
  const [isDefault, setIsDefault] = useState(false);
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    isDefaultPassword().then(setIsDefault);
  }, []);

  async function save() {
    if (pw.length < 6) return setMsg("Parol ən azı 6 simvol olmalıdır.");
    try {
      await changePassword(pw);
      setPw("");
      setIsDefault(false);
      setMsg("Parol dəyişdirildi.");
    } catch {
      setMsg("Parol saxlanmadı.");
    }
  }

  return (
    <div className="ck-card ck-pad">
      <div className="ck-sect">
        <KeyRound size={16} />
        Admin parolu
      </div>
      {isDefault && (
        <div className="ck-warn" style={{ marginBottom: 10 }}>
          Standart parol istifadə olunur ({DEFAULT_PASSWORD}). Dəyişdirmək
          tövsiyə olunur.
        </div>
      )}
      <div className="ck-add">
        <input
          className="ck-field"
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Yeni parol"
          aria-label="Yeni parol"
        />
        <button className="ck-btn ck-btn-primary" onClick={save} disabled={!pw}>
          Dəyiş
        </button>
      </div>
      {msg && <p className="ck-hint">{msg}</p>}
    </div>
  );
}

function LabeledInput({ label, hint, onChange, ...rest }) {
  return (
    <div>
      <label className="ck-label">{label}</label>
      <input
        className="ck-field"
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
      {hint && <div className="ck-hint">{hint}</div>}
    </div>
  );
}

/* ================= Üzü qeydiyyatdan keçirmə ================= */

function EnrollModal({ emp, models, onSave, onClose }) {
  const cam = useCamera();
  const [samples, setSamples] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    cam.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function capture() {
    if (busy || samples.length >= MAX_SAMPLES) return;
    const video = cam.videoRef.current;
    if (!video || video.readyState < 2) return setMsg("Kamera hazır deyil.");
    setBusy(true);
    setMsg("");
    try {
      const found = await detectWithDescriptors(video);
      if (found.length === 0)
        setMsg("Üz tapılmadı. Kameraya düz bax, işıqlı yerdə ol.");
      else if (found.length > 1) setMsg("Kadrda yalnız bir nəfər olmalıdır.");
      else
        setSamples((prev) => [
          ...prev,
          {
            descriptor: Array.from(found[0].descriptor),
            photo: takeSnapshot(video),
          },
        ]);
    } catch {
      setMsg("Üz oxuna bilmədi. Yenidən cəhd et.");
    }
    setBusy(false);
  }

  const ready = cam.state === "ready";

  return (
    <div className="ck-modal" onClick={onClose}>
      <div
        className="ck-card ck-modal-box ck-modal-wide"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ck-sect" style={{ marginBottom: 4 }}>
          <ScanFace size={16} color="var(--accent)" />
          {emp.name}: üzü qeydiyyatdan keçir
        </div>
        <p className="ck-hint" style={{ marginBottom: 12 }}>
          Üzünü fərqli bucaqlardan 3–5 dəfə çək: düz, bir az sağa, bir az sola.
          Nə qədər çox nümunə olsa, tanıma bir o qədər dəqiq olar.
        </p>

        <div className={`ck-view ${busy ? "work" : ""}`}>
          <video ref={cam.videoRef} className="ck-video" playsInline muted />
          {ready && (
            <>
              <span className="ck-corner tl" />
              <span className="ck-corner tr" />
              <span className="ck-corner bl" />
              <span className="ck-corner br" />
              {busy && <span className="ck-scanline" />}
            </>
          )}
          {!ready && (
            <div className="ck-overlay">
              {cam.state === "error" ? (
                <AlertTriangle size={28} color="var(--bad)" />
              ) : (
                <Camera size={28} />
              )}
              <span>
                {cam.state === "error" ? cam.error : "Kamera açılır..."}
              </span>
            </div>
          )}
        </div>

        <div className="ck-thumbs">
          {samples.length === 0 && (
            <span className="ck-hint">Hələ nümunə çəkilməyib.</span>
          )}
          {samples.map((s, i) => (
            <div className="ck-thumb" key={i}>
              <img src={s.photo} alt={`Nümunə ${i + 1}`} />
              <button
                onClick={() =>
                  setSamples((prev) => prev.filter((_, j) => j !== i))
                }
                aria-label="Nümunəni sil"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>

        {msg && (
          <div className="ck-flash danger" style={{ marginBottom: 12 }}>
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            {msg}
          </div>
        )}
        {models !== "ready" && (
          <p className="ck-hint" style={{ marginBottom: 12 }}>
            {models === "loading"
              ? "Üz tanıma modeli yüklənir..."
              : "Model yüklənmədi. İnternet bağlantısını yoxla və səhifəni yenilə."}
          </p>
        )}

        <div className="ck-row ck-wrap-row">
          <button
            className="ck-btn"
            onClick={capture}
            disabled={
              !ready ||
              busy ||
              models !== "ready" ||
              samples.length >= MAX_SAMPLES
            }
          >
            <Camera size={15} />
            Şəkil çək ({samples.length}/{MAX_SAMPLES})
          </button>
          <div style={{ flex: 1 }} />
          <button className="ck-btn" onClick={onClose}>
            İmtina
          </button>
          <button
            className="ck-btn ck-btn-primary"
            onClick={() => onSave(emp.id, samples)}
            disabled={samples.length === 0}
          >
            Yadda saxla
          </button>
        </div>
        {emp.descriptors?.length > 0 && (
          <p className="ck-hint">
            Yadda saxlasan, bu işçinin köhnə üz məlumatı yenisi ilə əvəz
            olunacaq.
          </p>
        )}
      </div>
    </div>
  );
}

/* ================= Parol pəncərəsi ================= */

function PasswordGate({ onSuccess, onClose }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);
  const [checking, setChecking] = useState(false);

  async function submit() {
    if (checking) return;
    setChecking(true);
    const ok = await verifyPassword(pw);
    setChecking(false);
    if (ok) onSuccess();
    else setErr(true);
  }

  return (
    <div className="ck-modal" onClick={onClose}>
      <div
        className={`ck-card ck-modal-box ${err ? "ck-shake" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ck-sect" style={{ marginBottom: 12 }}>
          <Lock size={16} color="var(--accent)" />
          Admin panelə giriş
        </div>
        <input
          className="ck-field"
          type="password"
          autoFocus
          value={pw}
          onChange={(e) => {
            setPw(e.target.value);
            setErr(false);
          }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Parol"
          aria-label="Parol"
        />
        {err && (
          <div style={{ fontSize: 12, color: "var(--bad)", marginTop: 8 }}>
            Parol yanlışdır, yenidən cəhd et.
          </div>
        )}
        <div className="ck-row" style={{ marginTop: 16 }}>
          <button className="ck-btn" style={{ flex: 1 }} onClick={onClose}>
            İmtina
          </button>
          <button
            className="ck-btn ck-btn-primary"
            style={{ flex: 1 }}
            onClick={submit}
            disabled={checking}
          >
            Daxil ol
          </button>
        </div>
      </div>
    </div>
  );
}
