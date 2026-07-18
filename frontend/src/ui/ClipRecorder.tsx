// Records the live map canvas to a WebM file, entirely in the browser.
// captureStream() on the canvas → MediaRecorder → Blob → download. No server,
// no new dependency, no upload: the operator drives the camera and gets a
// WYSIWYG clip of exactly what they saw. (No "send to Discord" — that would
// need the Discord/RCON surface this project deliberately doesn't have.)

import { useCallback, useEffect, useRef, useState } from "react";

// VP9 first (smaller, better), VP8 as the broad fallback. Whichever the
// browser actually supports wins; null means the browser can't record webm.
function pickMime(): string | null {
  const rec = (window as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
  if (!rec || typeof rec.isTypeSupported !== "function") return null;
  for (const m of ["video/webm;codecs=vp9", "video/webm;codecs=vp8",
                   "video/webm"]) {
    if (rec.isTypeSupported(m)) return m;
  }
  return null;
}

function twoDigit(n: number): string {
  return n.toString().padStart(2, "0");
}

export function ClipRecorder() {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  // Recording is only possible where the browser supports it; hide the control
  // entirely otherwise rather than offer a button that can't work.
  const supported = useRef(pickMime() !== null).current;

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }, []);

  const start = useCallback(() => {
    const canvas = document.getElementById("map") as HTMLCanvasElement | null;
    const mime = pickMime();
    if (!canvas || !mime || typeof canvas.captureStream !== "function") return;

    let stream: MediaStream;
    try {
      stream = canvas.captureStream(30);
    } catch {
      return;   // captureStream can throw on a tainted/oversized canvas
    }
    const rec = new MediaRecorder(stream, { mimeType: mime });
    chunksRef.current = [];
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      chunksRef.current = [];
      const now = new Date();
      const stamp = `${now.getFullYear()}${twoDigit(now.getMonth() + 1)}` +
        `${twoDigit(now.getDate())}_${twoDigit(now.getHours())}` +
        `${twoDigit(now.getMinutes())}${twoDigit(now.getSeconds())}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sqreader_${stamp}.webm`;
      a.click();
      // Revoke on the next tick so the click's navigation has consumed the URL.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setRecording(false);
    };
    recRef.current = rec;
    rec.start();
    startRef.current = Date.now();
    setElapsed(0);
    setRecording(true);
  }, []);

  // Elapsed-time ticker while recording.
  useEffect(() => {
    if (!recording) {
      if (timerRef.current != null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    timerRef.current = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 500);
    return () => {
      if (timerRef.current != null) window.clearInterval(timerRef.current);
    };
  }, [recording]);

  // Stop cleanly if the component unmounts mid-record.
  useEffect(() => () => stop(), [stop]);

  if (!supported) return null;

  return (
    <button className={recording ? "clip-rec active" : "clip-rec"}
            onClick={recording ? stop : start}
            title={recording ? "Stop recording and download" : "Save map as WebM"}>
      <span className={recording ? "clip-dot rec" : "clip-dot"} />
      {recording
        ? `${Math.floor(elapsed / 60)}:${twoDigit(elapsed % 60)}`
        : "Clip"}
    </button>
  );
}
