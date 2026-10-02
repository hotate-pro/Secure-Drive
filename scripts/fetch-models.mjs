import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";

const MODELS = "public/models";
const YUNET_URL =
  "https://media.githubusercontent.com/media/opencv/opencv_zoo/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_detection_yunet/face_detection_yunet_2023mar.onnx";
const YUNET_SHA256 =
  "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4";
const BUFFALO_SC_URL =
  "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_sc.zip";
const BUFFALO_SC_SHA256 =
  "57d31b56b6ffa911c8a73cfc1707c73cab76efe7f13b675a05223bf42de47c72";
const ARCFACE_SHA256 =
  "9cc6e4a75f0e2bf0b1aed94578f144d15175f357bdc05e815e5c4a02b319eb4f";

async function download(url) {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`Download failed: ${r.status} ${url}`);
  return new Uint8Array(await r.arrayBuffer());
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function main() {
  await mkdir(MODELS, { recursive: true });

  const yunetPath = `${MODELS}/yunet.onnx`;
  const arcPath = `${MODELS}/arcface_mbf.onnx`;

  if (!(await exists(yunetPath))) {
    console.log("Downloading YuNet...");
    const b = await download(YUNET_URL);
    const got = sha256(b);
    if (got !== YUNET_SHA256) throw new Error(`YuNet SHA-256 mismatch: ${got}`);
    await writeFile(yunetPath, b);
  }

  if (!(await exists(arcPath))) {
    console.log("Downloading InsightFace buffalo_sc...");
    const zip = await download(BUFFALO_SC_URL);
    const zipHash = sha256(zip);
    if (zipHash !== BUFFALO_SC_SHA256) {
      throw new Error(`buffalo_sc SHA-256 mismatch: ${zipHash}`);
    }
    const files = unzipSync(zip);
    const model = files["w600k_mbf.onnx"];
    if (!model) throw new Error("w600k_mbf.onnx was not found in buffalo_sc.zip");
    const modelHash = sha256(model);
    if (modelHash !== ARCFACE_SHA256) {
      throw new Error(`ArcFace SHA-256 mismatch: ${modelHash}`);
    }
    await writeFile(arcPath, model);
  }

  console.log("Models ready:");
  console.log(`  ${yunetPath}`);
  console.log(`  ${arcPath}`);
}

async function exists(path) {
  try { await readFile(path); return true; } catch { return false; }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
