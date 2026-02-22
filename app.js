const imageInput = document.getElementById("imageInput");
const colorCountInput = document.getElementById("colorCountInput");
const maxSideInput = document.getElementById("maxSideInput");
const removeBgCheckbox = document.getElementById("removeBgCheckbox");
const exportFormatSelect = document.getElementById("exportFormatSelect");
const processButton = document.getElementById("processButton");
const exportButton = document.getElementById("exportButton");
const statusText = document.getElementById("statusText");
const hoverSwatch = document.getElementById("hoverSwatch");
const hoverHex = document.getElementById("hoverHex");
const hoverCoord = document.getElementById("hoverCoord");
const hoverCount = document.getElementById("hoverCount");
const paletteList = document.getElementById("paletteList");

const originalCanvas = document.getElementById("originalCanvas");
const quantizedCanvas = document.getElementById("quantizedCanvas");
const originalCtx = originalCanvas.getContext("2d");
const quantizedCtx = quantizedCanvas.getContext("2d");

const state = {
  indexedPixels: null,
  palette: [],
  sortedPalette: [],
  width: 0,
  height: 0,
  fileName: "palette",
};

function setStatus(text) {
  statusText.textContent = text;
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
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
  paletteList.innerHTML = "";
  exportButton.disabled = true;
  quantizedCtx.clearRect(0, 0, quantizedCanvas.width, quantizedCanvas.height);
  clearHoverInfo();
}

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

function drawQuantizedPreview(image, width, height) {
  quantizedCanvas.width = width;
  quantizedCanvas.height = height;
  quantizedCtx.clearRect(0, 0, width, height);
  quantizedCtx.drawImage(image, 0, 0, width, height);
}

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
  const node = paletteList.querySelector(`.palette-item[data-centroid-index=\"${index}\"]`);
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

function updateHoverInfo(x, y, color) {
  hoverSwatch.style.backgroundColor = color.hex;
  hoverHex.textContent = `HEX: ${color.hex}`;
  hoverCoord.textContent = `(x, y): (${x}, ${y})`;
  hoverCount.textContent = `count: ${color.count}`;
}

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

async function readBase64PngAsImage(base64Value) {
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/png;base64,${base64Value}`;
  });
}

function base64ToUint16Array(base64Value) {
  if (!base64Value) {
    return null;
  }

  const binary = atob(base64Value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  const view = new DataView(bytes.buffer);
  const out = new Uint16Array(bytes.byteLength / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = view.getUint16(i * 2, true);
  }
  return out;
}

async function readErrorMessage(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      const payload = await response.json();
      if (payload?.error) {
        return payload.error;
      }
    } catch (error) {
      // Ignore JSON parse errors.
    }
  }

  try {
    const text = await response.text();
    if (text) {
      return text;
    }
  } catch (error) {
    // Ignore stream read errors.
  }
  return `HTTP ${response.status}`;
}

async function processImage() {
  const file = imageInput.files?.[0];
  if (!file) {
    setStatus("Please choose an image file first.");
    return;
  }

  const k = clampInt(Number(colorCountInput.value) || 32, 2, 128);
  const maxSide = clampInt(Number(maxSideInput.value) || 800, 128, 2048);
  const removeBg = Boolean(removeBgCheckbox.checked);

  colorCountInput.value = String(k);
  maxSideInput.value = String(maxSide);

  processButton.disabled = true;
  exportButton.disabled = true;
  clearQuantizationResult();
  setStatus(removeBg ? "Uploading image and removing background..." : "Uploading image...");

  try {
    const previewPromise = readFileAsImage(file);
    const formData = new FormData();
    formData.append("image", file, file.name);
    formData.append("color_count", String(k));
    formData.append("max_side", String(maxSide));
    formData.append("remove_bg", removeBg ? "true" : "false");

    const response = await fetch("/api/process-image", {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    const payload = await response.json();
    const previewImage = await previewPromise;
    if (!previewImage) {
      throw new Error("Failed to read selected image.");
    }

    drawOriginalPreview(previewImage, payload.width, payload.height);

    const quantizedImage = await readBase64PngAsImage(payload.quantized_png_b64);
    drawQuantizedPreview(quantizedImage, payload.width, payload.height);

    state.width = payload.width;
    state.height = payload.height;
    state.fileName = file.name;
    state.palette = payload.palette || [];
    state.sortedPalette = payload.sorted_palette || [];
    state.indexedPixels = base64ToUint16Array(payload.indexed_pixels_b64);

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

function extractDownloadName(response, fallbackName) {
  const contentDisposition = response.headers.get("content-disposition") || "";
  const filenameMatch = contentDisposition.match(/filename\*?=(?:UTF-8'')?"?([^\";]+)"?/i);
  if (!filenameMatch) {
    return fallbackName;
  }

  const encodedName = filenameMatch[1];
  try {
    return decodeURIComponent(encodedName);
  } catch (error) {
    return encodedName;
  }
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function exportPalette() {
  if (!state.sortedPalette.length) {
    return;
  }

  const extension = (exportFormatSelect.value || "csv").toLowerCase();
  const fallbackName = `${state.fileName.replace(/\.[^.]+$/, "") || "palette"}_N${state.sortedPalette.length}.${extension}`;
  setStatus(`Preparing ${extension.toUpperCase()} export...`);

  try {
    const response = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_name: state.fileName,
        format: extension,
        palette: state.sortedPalette,
      }),
    });
    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    const blob = await response.blob();
    const downloadName = extractDownloadName(response, fallbackName);
    downloadBlob(blob, downloadName);
    setStatus(`Exported ${downloadName}.`);
  } catch (error) {
    console.error(error);
    setStatus(`Export failed. ${error.message || ""}`.trim());
  }
}

quantizedCanvas.addEventListener("mousemove", (event) => {
  if (!state.indexedPixels || !state.palette.length || !state.width || !state.height) {
    return;
  }

  const { x, y } = getCanvasPixelCoord(event, quantizedCanvas, state.width, state.height);
  const idx = state.indexedPixels[y * state.width + x];
  if (idx === undefined || idx >= state.palette.length) {
    return;
  }

  const color = state.palette[idx];
  updateHoverInfo(x, y, color);
  highlightPaletteIndex(color.index);
});

quantizedCanvas.addEventListener("mouseleave", () => {
  clearHoverInfo();
  clearActivePalette();
});

processButton.addEventListener("click", processImage);
exportButton.addEventListener("click", exportPalette);

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
