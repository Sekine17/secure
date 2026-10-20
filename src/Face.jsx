import * as faceapi from "@vladmandic/face-api";

export { faceapi };

// Üz tanıma modelləri. Öz qovluğundan istifadə etmək üçün "/models" yaz
// və @vladmandic/face-api paketinin "model" qovluğunu public/models içinə kopyala.
export const MODEL_URL =
  "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let modelsPromise = null;
export function loadModels() {
  if (!modelsPromise) {
    modelsPromise = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]).catch((e) => {
      modelsPromise = null;
      throw e;
    });
  }
  return modelsPromise;
}

export const detectorOptions = () =>
  new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });

export const detectWithDescriptors = (video) =>
  faceapi
    .detectAllFaces(video, detectorOptions())
    .withFaceLandmarks(true)
    .withFaceDescriptors();

export function distance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export function frameStats(video) {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 48;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, 64, 48);
  const d = ctx.getImageData(0, 0, 64, 48).data;
  const n = d.length / 4;
  let sum = 0;
  let sum2 = 0;
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    sum += y;
    sum2 += y * y;
  }
  const mean = sum / n;
  return { mean, std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)) };
}

export function takeSnapshot(video) {
  const w = 240;
  const h = Math.round((w * video.videoHeight) / video.videoWidth) || 180;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.translate(w, 0); // önizləmə güzgü kimidir, şəkli də eyni çeviririk
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, w, h);
  return c.toDataURL("image/jpeg", 0.65);
}

/* ---------- Canlılıq yoxlaması ---------- */

const LEFT_EYE = [36, 37, 38, 39, 40, 41];
const RIGHT_EYE = [42, 43, 44, 45, 46, 47];

function eyeAspect(p, idx) {
  const d = (a, b) =>
    Math.hypot(p[idx[a]].x - p[idx[b]].x, p[idx[a]].y - p[idx[b]].y);
  return (d(1, 5) + d(2, 4)) / (2 * d(0, 3) || 1);
}
const eyeRatio = (p) => (eyeAspect(p, LEFT_EYE) + eyeAspect(p, RIGHT_EYE)) / 2;

// 0.5 ətrafı = düz baxış, kiçik/böyük = baş çevrilib
const yawRatio = (p) => (p[30].x - p[0].x) / (p[16].x - p[0].x || 1);

async function runLiveness(video, challenge, timeoutMs = 9000) {
  const t0 = Date.now();
  const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 });
  let seen = false;
  let baseline = 0;
  let closed = false;
  const yaws = [];
  let base = null;
  let lost = 0;
  let turned = false;

  while (Date.now() - t0 < timeoutMs) {
    const det = await faceapi.detectSingleFace(video, opts).withFaceLandmarks(true);
    if (det) {
      seen = true;
      const pts = det.landmarks.positions;
      if (challenge === "blink") {
        const ear = eyeRatio(pts);
        baseline = Math.max(baseline * 0.99, ear);
        if (baseline > 0.12) {
          if (ear < baseline * 0.8) closed = true;
          else if (closed && ear > baseline * 0.9) return "ok";
        }
      } else {
        const y = yawRatio(pts);
        if (base === null) {
          yaws.push(y);
          if (yaws.length >= 4) base = yaws.reduce((a, b) => a + b, 0) / yaws.length;
        } else if (Math.abs(y - base) > 0.08) {
          return "ok"; // başlanğıc vəziyyətdən aydın çevrilib
        } else if (turned) {
          return "ok"; // üz çevriləndə itib, indi yenidən görünür
        }
        lost = 0;
      }
    } else if (challenge === "turn" && base !== null) {
      // çevrilmiş üzü model tapa bilmir, bu da çevrilmə sayılır
      if (++lost >= 3) turned = true;
    }
    await sleep(20);
  }
  return seen ? "timeout" : "noface";
}

/* ---------- Tanıma ---------- */

// Kameradakı üzü qeydiyyatlı işçilərlə müqayisə edir
export async function recognize(
  video,
  enrolled,
  threshold,
  { liveness = "off", onPrompt } = {},
) {
  if (!video || video.readyState < 2 || !video.videoWidth) {
    return { kind: "fail", msg: "Kamera görüntü vermir. Kameranı yenidən aç." };
  }
  const first = frameStats(video);
  if (first.mean < 25)
    return {
      kind: "fail",
      msg: "Görüntü çox qaranlıqdır. Daha işıqlı yerə keç.",
    };
  if (first.std < 6)
    return { kind: "fail", msg: "Kamera örtülü görünür və ya görüntü boşdur." };

  if (liveness !== "off") {
    const challenge =
      liveness === "random"
        ? Math.random() < 0.5
          ? "blink"
          : "turn"
        : liveness;
    onPrompt?.(challenge === "blink" ? "Göz qırp" : "Başını yana çevir");
    const r = await runLiveness(video, challenge);
    if (r === "noface")
      return {
        kind: "fail",
        msg: "Üz tapılmadı. Kameraya düz bax və yenidən cəhd et.",
      };
    if (r !== "ok")
      return {
        kind: "fail",
        msg: "Canlılıq yoxlaması keçilmədi. Göstərişə əməl et və yenidən cəhd et.",
      };
    onPrompt?.("Kameraya düz bax");
    await sleep(challenge === "turn" ? 900 : 300);
  }

  onPrompt?.("Üz yoxlanılır...");
  let msg = "Üz tapılmadı. Kameraya düz bax və yenidən cəhd et.";

  for (let i = 0; i < 6; i++) {
    const found = await detectWithDescriptors(video);
    if (found.length > 1) {
      msg = "Kadrda yalnız bir nəfər olmalıdır.";
    } else if (found.length === 1) {
      const y = yawRatio(found[0].landmarks.positions);
      if (y < 0.3 || y > 0.7) {
        msg = "Üzünü kameraya düz tut.";
      } else {
        const desc = found[0].descriptor;
        let best = null;
        let bestDist = Infinity;
        for (const e of enrolled) {
          for (const d of e.descriptors) {
            const dist = distance(desc, d);
            if (dist < bestDist) {
              bestDist = dist;
              best = e;
            }
          }
        }
        const photo = takeSnapshot(video);
        return bestDist <= threshold
          ? { kind: "match", emp: best, dist: bestDist, photo }
          : { kind: "unknown", dist: bestDist, photo };
      }
    } else {
      msg = "Üz tapılmadı. Kameraya düz bax və yenidən cəhd et.";
    }
    await sleep(300);
  }
  return { kind: "fail", msg };
}
