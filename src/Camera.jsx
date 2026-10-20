import { useState, useRef, useEffect, useCallback } from "react";

export function useCamera() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const tokenRef = useRef(0);
  const [state, setState] = useState("idle"); // idle | starting | ready | error
  const [error, setError] = useState("");
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState("");

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const stop = useCallback(() => {
    tokenRef.current += 1;
    releaseStream();
    setState("idle");
  }, []);

  const start = useCallback(async (id) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("error");
      setError("Bu brauzer kameranı dəstəkləmir. Səhifə HTTPS və ya localhost üzərində açılmalıdır.");
      return;
    }
    const token = ++tokenRef.current;
    releaseStream();
    setState("starting");
    setError("");
    try {
      const video = id
        ? { deviceId: { exact: id }, width: { ideal: 640 }, height: { ideal: 480 } }
        : { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } };
      const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      if (token !== tokenRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => {});
      }
      const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
      setDevices(list);
      setDeviceId(stream.getVideoTracks()[0]?.getSettings().deviceId || id || "");
      setState("ready");
    } catch (e) {
      if (token !== tokenRef.current) return;
      const map = {
        NotAllowedError: "Kameraya icazə verilməyib. Brauzerin ünvan çubuğundan kamera icazəsini aç.",
        NotFoundError: "Kamera tapılmadı. Qurğunun qoşulduğunu yoxla.",
        NotReadableError: "Kameranı başqa proqram istifadə edir. Onu bağlayıb yenidən cəhd et.",
        OverconstrainedError: "Seçilən kamera əlçatan deyil. Başqa kamera seç.",
      };
      setError(map[e?.name] || "Kamera açıla bilmədi.");
      setState("error");
    }
  }, []);

  useEffect(
    () => () => {
      tokenRef.current += 1;
      releaseStream();
    },
    []
  );

  return { videoRef, state, error, devices, deviceId, start, stop };
}