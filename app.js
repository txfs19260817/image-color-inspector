import { createRembgProcessor, REMBG_MODELS } from "./rembg-web.js";

// ===== DOM references =====
const imageInput = document.getElementById("imageInput");
const colorCountInput = document.getElementById("colorCountInput");
const maxSideInput = document.getElementById("maxSideInput");
const removeBgCheckbox = document.getElementById("removeBgCheckbox");
const rembgModelSelect = document.getElementById("rembgModelSelect");
const rembgModelDescription = document.getElementById("rembgModelDescription");
const rembgThresholdInput = document.getElementById("rembgThresholdInput");
const exportFormatSelect = document.getElementById("exportFormatSelect");
const processButton = document.getElementById("processButton");
const exportButton = document.getElementById("exportButton");
const statusText = document.getElementById("statusText");
const hoverInfo = document.getElementById("hoverInfo");
const hoverSwatch = document.getElementById("hoverSwatch");
const hoverHex = document.getElementById("hoverHex");
const hoverCoord = document.getElementById("hoverCoord");
const hoverCount = document.getElementById("hoverCount");
const paletteList = document.getElementById("paletteList");

const originalCanvas = document.getElementById("originalCanvas");
const quantizedCanvas = document.getElementById("quantizedCanvas");
const originalCtx = originalCanvas.getContext("2d");
const quantizedCtx = quantizedCanvas.getContext("2d", { willReadFrequently: true });

// ===== Runtime constants =====
const MAX_SAMPLES = 12000;
const KMEANS_ITERATIONS = 12;

const rembg = createRembgProcessor();

const REMBG_MODEL_UI_ORDER = new Map([
  ["u2netp", 0],
  ["silueta", 1],
  ["u2net_human_seg", 2],
  ["u2net", 3],
  ["u2net_cloth_seg", 4],
  ["isnet-general-use", 5],
  ["isnet-anime", 6],
  ["birefnet-general-lite", 7],
  ["birefnet-general", 8],
  ["birefnet-dis", 9],
  ["birefnet-hrsod", 10],
  ["birefnet-cod", 11],
  ["birefnet-massive", 12],
  ["bria-rmbg", 13],
  ["birefnet-portrait", 14],
]);

// ===== App state =====
const state = {
  indexedPixels: null,
  palette: [],
  sortedPalette: [],
  width: 0,
  height: 0,
  fileName: "palette",
  pinnedHover: null,
};

// ===== Basic UI helpers =====
function setStatus(text) {
  statusText.textContent = text;
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampFloat(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function rgbToHex(r, g, b) {
  return `#${r.toString(16).padStart(2, "0").toUpperCase()}${g.toString(16).padStart(2, "0").toUpperCase()}${b.toString(16).padStart(2, "0").toUpperCase()}`;
}

function clearHoverInfo() {
  hoverSwatch.style.backgroundColor = "#ffffff";
  hoverHex.textContent = "HEX: -";
  hoverCoord.textContent = "(x, y): -";
  hoverCount.textContent = "count: -";
}

function clearQuantizationResult() {
  state.indexedPixels = null;
  state.palette = [];
  state.sortedPalette = [];
  state.width = 0;
  state.height = 0;
  clearPinnedHover();
  paletteList.innerHTML = "";
  exportButton.disabled = true;
  quantizedCtx.clearRect(0, 0, quantizedCanvas.width, quantizedCanvas.height);
  clearHoverInfo();
}

// ===== Canvas/image helpers =====
function scaleToMaxSide(width, height, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function drawOriginalPreview(image, width, height) {
  originalCanvas.width = width;
  originalCanvas.height = height;
  originalCtx.clearRect(0, 0, width, height);
  originalCtx.drawImage(image, 0, 0, width, height);
}

function drawImageDataToCanvas(imageData, canvas, context) {
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  context.clearRect(0, 0, imageData.width, imageData.height);
  context.putImageData(imageData, 0, 0);
}

function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function imageBitmapToImageData(imageBitmap) {
  const canvas = createCanvas(imageBitmap.width, imageBitmap.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(imageBitmap, 0, 0);
  return ctx.getImageData(0, 0, imageBitmap.width, imageBitmap.height);
}

function resizeImageData(imageData, width, height) {
  if (imageData.width === width && imageData.height === height) {
    return imageData;
  }

  const srcCanvas = createCanvas(imageData.width, imageData.height);
  const srcCtx = srcCanvas.getContext("2d", { willReadFrequently: true });
  srcCtx.putImageData(imageData, 0, 0);

  const dstCanvas = createCanvas(width, height);
  const dstCtx = dstCanvas.getContext("2d", { willReadFrequently: true });
  dstCtx.imageSmoothingEnabled = true;
  dstCtx.imageSmoothingQuality = "high";
  dstCtx.drawImage(srcCanvas, 0, 0, width, height);
  return dstCtx.getImageData(0, 0, width, height);
}

// ===== Palette + hover UI =====
function renderPalette(items) {
  paletteList.innerHTML = "";

  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const card = document.createElement("div");
    card.className = "palette-item";
    card.dataset.centroidIndex = String(item.index);

    const patch = document.createElement("span");
    patch.className = "patch";
    patch.style.backgroundColor = item.hex;

    const meta = document.createElement("div");
    meta.className = "meta";

    const hex = document.createElement("div");
    hex.className = "hex";
    hex.textContent = item.hex;

    const idx = document.createElement("span");
    idx.textContent = `index ${item.index}`;

    const cnt = document.createElement("span");
    cnt.textContent = `${item.count} px (${Number(item.pct || 0).toFixed(2)}%)`;

    meta.append(hex, idx, cnt);
    card.append(patch, meta);
    fragment.append(card);
  }

  paletteList.append(fragment);
}

function clearActivePalette() {
  const active = paletteList.querySelector(".palette-item.active");
  if (active) {
    active.classList.remove("active");
  }
}

function highlightPaletteIndex(index) {
  clearActivePalette();
  const node = paletteList.querySelector(`.palette-item[data-centroid-index="${index}"]`);
  if (node) {
    node.classList.add("active");
  }
}

function getCanvasPixelCoord(event, canvas, imageWidth, imageHeight) {
  const rect = canvas.getBoundingClientRect();
  const x = clampInt(((event.clientX - rect.left) / rect.width) * (imageWidth - 1), 0, imageWidth - 1);
  const y = clampInt(((event.clientY - rect.top) / rect.height) * (imageHeight - 1), 0, imageHeight - 1);
  return { x, y };
}

function updateHoverInfo(x, y, color, pinned = false) {
  hoverSwatch.style.backgroundColor = color.hex;
  hoverHex.textContent = `HEX: ${color.hex}`;
  hoverCoord.textContent = pinned ? `(x, y): (${x}, ${y}) [Pinned]` : `(x, y): (${x}, ${y})`;
  hoverCount.textContent = `count: ${color.count}`;
}

function clearPinnedHover() {
  state.pinnedHover = null;
}

function setPinnedHover(x, y, color) {
  state.pinnedHover = { x, y, index: color.index };
  updateHoverInfo(x, y, color, true);
  highlightPaletteIndex(color.index);
}

function getColorAtCanvasEvent(event) {
  if (!state.indexedPixels || !state.palette.length || !state.width || !state.height) {
    return null;
  }

  const { x, y } = getCanvasPixelCoord(event, quantizedCanvas, state.width, state.height);
  const idx = state.indexedPixels[y * state.width + x];
  if (idx === undefined || idx >= state.palette.length) {
    return null;
  }

  return { x, y, color: state.palette[idx] };
}

// ===== Input decode =====
async function readFileAsImage(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// ===== Quantization (K-Means) =====
// Sample opaque pixels only so transparent background does not dominate centroids.
function buildSamplePixels(rgbaData, width, height, maxSamples = MAX_SAMPLES) {
  const total = width * height;
  const step = Math.max(1, Math.floor(total / maxSamples));
  const samples = [];

  for (let i = 0; i < total; i += step) {
    const offset = i * 4;
    const alpha = rgbaData[offset + 3];
    if (alpha > 0) {
      samples.push(rgbaData[offset], rgbaData[offset + 1], rgbaData[offset + 2]);
    }
  }

  if (!samples.length) {
    return new Float32Array([0, 0, 0]);
  }
  return Float32Array.from(samples);
}

// Farthest-point style init improves stability vs pure random centroids.
function initCentroids(samples, sampleCount, k) {
  const centroids = new Float32Array(k * 3);
  const first = Math.floor(Math.random() * sampleCount);
  centroids[0] = samples[first * 3];
  centroids[1] = samples[first * 3 + 1];
  centroids[2] = samples[first * 3 + 2];

  const stride = Math.max(1, Math.floor(sampleCount / 2000));

  for (let idx = 1; idx < k; idx += 1) {
    let bestMinDist = -1;
    let bestSampleIndex = Math.floor(Math.random() * sampleCount);

    for (let s = 0; s < sampleCount; s += stride) {
      const sr = samples[s * 3];
      const sg = samples[s * 3 + 1];
      const sb = samples[s * 3 + 2];

      let minDist = Number.POSITIVE_INFINITY;
      for (let c = 0; c < idx; c += 1) {
        const base = c * 3;
        const dr = centroids[base] - sr;
        const dg = centroids[base + 1] - sg;
        const db = centroids[base + 2] - sb;
        const dist = dr * dr + dg * dg + db * db;
        if (dist < minDist) {
          minDist = dist;
        }
      }

      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        bestSampleIndex = s;
      }
    }

    centroids[idx * 3] = samples[bestSampleIndex * 3];
    centroids[idx * 3 + 1] = samples[bestSampleIndex * 3 + 1];
    centroids[idx * 3 + 2] = samples[bestSampleIndex * 3 + 2];
  }

  return centroids;
}

function runKMeans(samples, k, iterations = KMEANS_ITERATIONS) {
  const sampleCount = Math.max(1, Math.floor(samples.length / 3));
  const centroids = initCentroids(samples, sampleCount, k);

  for (let iter = 0; iter < iterations; iter += 1) {
    const counts = new Uint32Array(k);
    const sums = new Float64Array(k * 3);

    for (let i = 0; i < sampleCount; i += 1) {
      const sr = samples[i * 3];
      const sg = samples[i * 3 + 1];
      const sb = samples[i * 3 + 2];

      let bestIndex = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let c = 0; c < k; c += 1) {
        const base = c * 3;
        const dr = sr - centroids[base];
        const dg = sg - centroids[base + 1];
        const db = sb - centroids[base + 2];
        const distance = dr * dr + dg * dg + db * db;
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = c;
        }
      }

      counts[bestIndex] += 1;
      sums[bestIndex * 3] += sr;
      sums[bestIndex * 3 + 1] += sg;
      sums[bestIndex * 3 + 2] += sb;
    }

    for (let c = 0; c < k; c += 1) {
      const base = c * 3;
      if (!counts[c]) {
        const fallback = Math.floor(Math.random() * sampleCount);
        centroids[base] = samples[fallback * 3];
        centroids[base + 1] = samples[fallback * 3 + 1];
        centroids[base + 2] = samples[fallback * 3 + 2];
        continue;
      }
      centroids[base] = sums[base] / counts[c];
      centroids[base + 1] = sums[base + 1] / counts[c];
      centroids[base + 2] = sums[base + 2] / counts[c];
    }
  }

  const out = new Uint8Array(k * 3);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = clampInt(centroids[i], 0, 255);
  }
  return out;
}

function findNearestCentroid(r, g, b, centroids, k) {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let c = 0; c < k; c += 1) {
    const base = c * 3;
    const dr = r - centroids[base];
    const dg = g - centroids[base + 1];
    const db = b - centroids[base + 2];
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = c;
    }
  }
  return bestIndex;
}

// Cache unique RGB -> centroid assignment for faster full-image quantization.
function quantizeImageData(imageData, k) {
  const { width, height, data } = imageData;
  const totalPixels = width * height;

  const samples = buildSamplePixels(data, width, height);
  const centroids = runKMeans(samples, k);

  const indexedPixels = new Uint16Array(totalPixels);
  const counts = new Uint32Array(k);
  const quantized = new Uint8ClampedArray(totalPixels * 4);
  const colorCache = new Map();

  for (let i = 0; i < totalPixels; i += 1) {
    const src = i * 4;
    const alpha = data[src + 3];
    if (!alpha) {
      continue;
    }

    const r = data[src];
    const g = data[src + 1];
    const b = data[src + 2];
    const key = (r << 16) | (g << 8) | b;

    let centroidIndex = colorCache.get(key);
    if (centroidIndex === undefined) {
      centroidIndex = findNearestCentroid(r, g, b, centroids, k);
      colorCache.set(key, centroidIndex);
    }

    indexedPixels[i] = centroidIndex;
    counts[centroidIndex] += 1;

    const base = centroidIndex * 3;
    quantized[src] = centroids[base];
    quantized[src + 1] = centroids[base + 1];
    quantized[src + 2] = centroids[base + 2];
    quantized[src + 3] = 255;
  }

  const palette = [];
  for (let idx = 0; idx < k; idx += 1) {
    const r = centroids[idx * 3];
    const g = centroids[idx * 3 + 1];
    const b = centroids[idx * 3 + 2];
    const count = counts[idx];
    palette.push({
      index: idx,
      r,
      g,
      b,
      hex: rgbToHex(r, g, b),
      count,
      pct: totalPixels > 0 ? (count / totalPixels) * 100 : 0,
    });
  }

  const sortedPalette = [...palette].sort((a, b) => b.count - a.count);
  return {
    imageData: new ImageData(quantized, width, height),
    indexedPixels,
    palette,
    sortedPalette,
  };
}

// ===== Export helpers (CSV/ACO) =====
function sanitizeFileStem(fileName) {
  const withoutExt = (fileName || "palette").replace(/\.[^.]+$/, "");
  const cleaned = withoutExt.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+|[._]+$/g, "");
  return cleaned || "palette";
}

function encodeUtf16BE(text) {
  const bytes = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    bytes[i * 2] = (code >> 8) & 0xff;
    bytes[i * 2 + 1] = code & 0xff;
  }
  return bytes;
}

function buildAcoBytes(colors) {
  const bytes = [];
  const pushU16 = (value) => {
    bytes.push((value >> 8) & 0xff, value & 0xff);
  };
  const pushU32 = (value) => {
    bytes.push((value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff);
  };
  const pushRecord = (color) => {
    pushU16(0);
    pushU16((Number(color.r) & 0xff) * 257);
    pushU16((Number(color.g) & 0xff) * 257);
    pushU16((Number(color.b) & 0xff) * 257);
    pushU16(0);
  };

  pushU16(1);
  pushU16(colors.length);
  for (const color of colors) {
    pushRecord(color);
  }

  pushU16(2);
  pushU16(colors.length);
  for (let i = 0; i < colors.length; i += 1) {
    const color = colors[i];
    pushRecord(color);
    const name = `Color ${i + 1} ${color.hex}`;
    const encoded = encodeUtf16BE(name);
    pushU32(encoded.length / 2 + 1);
    for (const byte of encoded) {
      bytes.push(byte);
    }
    pushU16(0);
  }

  return new Uint8Array(bytes);
}

function buildCsvText(palette) {
  const lines = ["index,hex,r,g,b,count,percentage"];
  for (const color of palette) {
    lines.push(
      [
        Number(color.index || 0),
        String(color.hex || ""),
        Number(color.r || 0),
        Number(color.g || 0),
        Number(color.b || 0),
        Number(color.count || 0),
        Number(color.pct || 0).toFixed(4),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function shortSourceLabel(url) {
  if (!url) {
    return "unknown-source";
  }
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.host || parsed.pathname;
  } catch (error) {
    return url;
  }
}

// ===== Main workflow =====
async function processImage() {
  const file = imageInput.files?.[0];
  if (!file) {
    setStatus("Please choose an image file first.");
    return;
  }

  const k = clampInt(Number(colorCountInput.value) || 32, 2, 128);
  const maxSide = clampInt(Number(maxSideInput.value) || 800, 128, 2048);
  const removeBg = Boolean(removeBgCheckbox.checked);
  const selectedModel = rembgModelSelect.value || "u2net";
  const threshold = clampFloat(Number(rembgThresholdInput.value), 0, 1);

  colorCountInput.value = String(k);
  maxSideInput.value = String(maxSide);
  rembgThresholdInput.value = String(threshold);

  processButton.disabled = true;
  exportButton.disabled = true;
  clearQuantizationResult();

  try {
    setStatus("Decoding image...");
    const [previewImage, bitmap] = await Promise.all([readFileAsImage(file), createImageBitmap(file)]);
    const dims = scaleToMaxSide(bitmap.width, bitmap.height, maxSide);
    drawOriginalPreview(previewImage, dims.width, dims.height);

    let processedImageData;
    if (removeBg) {
      setStatus(`Removing background with ${selectedModel}...`);
      const result = await rembg.removeBackground(bitmap, {
        model: selectedModel,
        threshold,
        output: "cutout",
      });
      processedImageData = result.imageData;
      setStatus(`Background removed (${result.provider}, ${shortSourceLabel(result.sourceUrl)}). Quantizing...`);
    } else {
      processedImageData = imageBitmapToImageData(bitmap);
      setStatus("Quantizing...");
    }

    const resized = resizeImageData(processedImageData, dims.width, dims.height);
    const quantized = quantizeImageData(resized, k);
    drawImageDataToCanvas(quantized.imageData, quantizedCanvas, quantizedCtx);

    state.width = dims.width;
    state.height = dims.height;
    state.fileName = file.name;
    state.palette = quantized.palette;
    state.sortedPalette = quantized.sortedPalette;
    state.indexedPixels = quantized.indexedPixels;

    renderPalette(state.sortedPalette);
    exportButton.disabled = state.sortedPalette.length === 0;
    setStatus(`Done. Found ${state.palette.length} quantized colors.`);
  } catch (error) {
    console.error(error);
    setStatus(`Failed to process this image. ${error.message || ""}`.trim());
  } finally {
    processButton.disabled = false;
  }
}

function exportPalette() {
  if (!state.sortedPalette.length) {
    return;
  }

  const extension = (exportFormatSelect.value || "csv").toLowerCase();
  const fileStem = sanitizeFileStem(state.fileName || "palette");
  const fileName = `${fileStem}_N${state.sortedPalette.length}.${extension}`;

  try {
    let blob;
    if (extension === "aco") {
      blob = new Blob([buildAcoBytes(state.sortedPalette)], { type: "application/octet-stream" });
    } else {
      blob = new Blob([buildCsvText(state.sortedPalette)], { type: "text/csv;charset=utf-8" });
    }
    downloadBlob(blob, fileName);
    setStatus(`Exported ${fileName}.`);
  } catch (error) {
    console.error(error);
    setStatus(`Export failed. ${error.message || ""}`.trim());
  }
}

// ===== Rembg model controls =====
function populateModelSelect() {
  rembgModelSelect.innerHTML = "";
  const sortedModels = [...REMBG_MODELS].sort((a, b) => {
    const orderA = REMBG_MODEL_UI_ORDER.get(a.name) ?? Number.MAX_SAFE_INTEGER;
    const orderB = REMBG_MODEL_UI_ORDER.get(b.name) ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return String(a.label || a.name).localeCompare(String(b.label || b.name));
  });
  const fragment = document.createDocumentFragment();
  for (const model of sortedModels) {
    const option = document.createElement("option");
    option.value = model.name;
    option.textContent = model.label;
    if (model.name === "u2net") {
      option.selected = true;
    }
    fragment.append(option);
  }
  rembgModelSelect.append(fragment);
}

function updateSelectedModelDescription() {
  if (!rembgModelDescription) {
    return;
  }
  const selectedModel = rembgModelSelect.value || "u2net";
  const modelConfig = REMBG_MODELS.find((item) => item.name === selectedModel);
  rembgModelDescription.textContent = modelConfig?.description || "No model description available.";
  rembgModelDescription.classList.toggle("is-disabled", !removeBgCheckbox.checked);
}

function syncRembgControls() {
  rembgModelSelect.disabled = !removeBgCheckbox.checked;
  rembgThresholdInput.disabled = !removeBgCheckbox.checked;
  updateSelectedModelDescription();
}

// ===== Event wiring =====
quantizedCanvas.addEventListener("mousemove", (event) => {
  if (state.pinnedHover) {
    return;
  }

  const hit = getColorAtCanvasEvent(event);
  if (!hit) {
    return;
  }

  updateHoverInfo(hit.x, hit.y, hit.color, false);
  highlightPaletteIndex(hit.color.index);
});

quantizedCanvas.addEventListener("click", (event) => {
  const hit = getColorAtCanvasEvent(event);
  if (!hit) {
    return;
  }

  const isSamePinnedSpot = Boolean(
    state.pinnedHover
      && state.pinnedHover.x === hit.x
      && state.pinnedHover.y === hit.y,
  );

  if (isSamePinnedSpot) {
    clearPinnedHover();
    updateHoverInfo(hit.x, hit.y, hit.color, false);
    highlightPaletteIndex(hit.color.index);
    return;
  }

  setPinnedHover(hit.x, hit.y, hit.color);
});

quantizedCanvas.addEventListener("mouseleave", () => {
  if (state.pinnedHover) {
    return;
  }
  clearHoverInfo();
  clearActivePalette();
});

hoverInfo.addEventListener("click", () => {
  if (!state.pinnedHover) {
    return;
  }
  clearPinnedHover();
  clearHoverInfo();
  clearActivePalette();
});

processButton.addEventListener("click", processImage);
exportButton.addEventListener("click", exportPalette);
removeBgCheckbox.addEventListener("change", syncRembgControls);
rembgModelSelect.addEventListener("change", updateSelectedModelDescription);
rembgThresholdInput.addEventListener("change", () => {
  const threshold = clampFloat(Number(rembgThresholdInput.value), 0, 1);
  rembgThresholdInput.value = String(threshold);
});

imageInput.addEventListener("change", async () => {
  clearQuantizationResult();

  const file = imageInput.files?.[0];
  if (!file) {
    originalCtx.clearRect(0, 0, originalCanvas.width, originalCanvas.height);
    setStatus("Select an image and click Process.");
    return;
  }

  try {
    const img = await readFileAsImage(file);
    const maxSide = clampInt(Number(maxSideInput.value) || 800, 128, 2048);
    const dims = scaleToMaxSide(img.width, img.height, maxSide);
    drawOriginalPreview(img, dims.width, dims.height);
    quantizedCanvas.width = dims.width;
    quantizedCanvas.height = dims.height;
    quantizedCtx.clearRect(0, 0, dims.width, dims.height);
    setStatus("Image loaded. Click Process to quantize.");
  } catch (error) {
    console.error(error);
    setStatus("Failed to read this image.");
  }
});

// ===== Initial UI bootstrapping =====
populateModelSelect();
syncRembgControls();
