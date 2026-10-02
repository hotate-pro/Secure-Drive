import QRCode from "qrcode";
import jsQR from "jsqr";

export async function renderCardQR(canvas, token) {
  await QRCode.toCanvas(canvas, token, {
    errorCorrectionLevel:"H",
    margin:2,
    width:230,
    color:{dark:"#0b1020", light:"#ffffff"}
  });
}

export async function scanQR(video, scratch) {
  if ("BarcodeDetector" in window) {
    try {
      const detector = new BarcodeDetector({formats:["qr_code"]});
      const codes = await detector.detect(video);
      if (codes.length && codes[0].rawValue) return codes[0].rawValue;
    } catch {}
  }

  scratch.width = video.videoWidth;
  scratch.height = video.videoHeight;
  if (!scratch.width || !scratch.height) return null;
  const ctx = scratch.getContext("2d", {willReadFrequently:true});
  ctx.drawImage(video, 0, 0, scratch.width, scratch.height);
  const image = ctx.getImageData(0, 0, scratch.width, scratch.height);
  const code = jsQR(image.data, image.width, image.height, {inversionAttempts:"attemptBoth"});
  return code?.data || null;
}
