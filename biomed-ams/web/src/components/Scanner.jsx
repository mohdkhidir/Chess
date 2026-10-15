import { useEffect, useRef, useState } from 'react';
import { Button } from './ui.jsx';

// Camera tag reader: uses the built-in BarcodeDetector when present (QR and 1D barcodes such as
// Code 128 on older hospital tags), otherwise falls back to jsQR (QR only).
export function QrScanner({ onDetect, active = true }) {
  const videoRef = useRef(null);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(true);
  const doneRef = useRef(false);

  useEffect(() => {
    if (!active) return undefined;
    let stream = null;
    let timer = null;
    let cancelled = false;
    doneRef.current = false;

    async function start() {
      setError(null);
      setStarting(true);
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setError('Camera is not available here. Use the Android app, or open the system over https://. You can type the tag number instead.');
        setStarting(false);
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } catch (e) {
        setError(e.name === 'NotAllowedError' ? 'Camera permission was refused. Allow camera access for this app in Android settings.' : `Camera could not start (${e.name || e.message}).`);
        setStarting(false);
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current;
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      await video.play().catch(() => {});
      setStarting(false);

      let detector = null;
      if ('BarcodeDetector' in window) {
        try {
          const formats = await window.BarcodeDetector.getSupportedFormats();
          if (formats.length) detector = new window.BarcodeDetector({ formats: formats.filter((f) => ['qr_code', 'code_128', 'code_39', 'data_matrix', 'ean_13'].includes(f)) });
        } catch {
          detector = null;
        }
      }
      const jsQR = detector ? null : (await import('jsqr')).default;
      const canvas = document.createElement('canvas');
      const ctx2d = canvas.getContext('2d', { willReadFrequently: true });

      const tick = async () => {
        if (cancelled || doneRef.current) return;
        try {
          if (video.readyState >= 2) {
            let text = null;
            if (detector) {
              const codes = await detector.detect(video);
              if (codes.length) text = codes[0].rawValue;
            } else {
              const w = video.videoWidth;
              const h = video.videoHeight;
              const scale = Math.min(1, 640 / Math.max(w, h));
              canvas.width = Math.round(w * scale);
              canvas.height = Math.round(h * scale);
              ctx2d.drawImage(video, 0, 0, canvas.width, canvas.height);
              const img = ctx2d.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
              if (code) text = code.data;
            }
            if (text && !doneRef.current) {
              doneRef.current = true;
              if (navigator.vibrate) navigator.vibrate(60);
              onDetect(text.trim());
              return;
            }
          }
        } catch {
          /* keep scanning */
        }
        timer = setTimeout(tick, 220);
      };
      tick();
    }
    start();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [active, onDetect]);

  return (
    <div className="stack">
      <div className="scanner">
        <video ref={videoRef} muted playsInline />
        <div className="scanner-frame" aria-hidden="true" />
        <div className="scanner-hint">{starting ? 'Starting camera…' : 'Point at the asset tag QR / barcode'}</div>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {error ? <Button variant="secondary" onClick={() => window.location.reload()}>Retry</Button> : null}
    </div>
  );
}
