const DEFAULT_MODEL_BASE_URL = "https://huggingface.co/tomjackson2023/rembg/resolve/main";
const DEFAULT_MODEL_BASE_URL_FALLBACKS = [
  "./models",
];
const DEFAULT_MODEL_URL_OVERRIDES = {
  "birefnet-general": "https://huggingface.co/onnx-community/BiRefNet-ONNX/resolve/main/onnx/model.onnx",
  "birefnet-general-lite": "https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model.onnx",
  "birefnet-portrait": "https://huggingface.co/onnx-community/BiRefNet-portrait-ONNX/resolve/main/onnx/model.onnx",
  "birefnet-dis": "https://huggingface.co/onnx-community/BiRefNet-DIS5K-ONNX/resolve/main/onnx/model.onnx",
  "birefnet-hrsod": "https://huggingface.co/onnx-community/BiRefNet-HRSOD_DHU-ONNX/resolve/main/onnx/model.onnx",
  "birefnet-cod": "https://huggingface.co/onnx-community/BiRefNet-COD-ONNX/resolve/main/onnx/model.onnx",
  "birefnet-massive": "https://huggingface.co/onnx-community/BiRefNet-DIS5K-TR_TEs-ONNX/resolve/main/onnx/model.onnx",
  "bria-rmbg": [
    "https://huggingface.co/webnn/RMBG-2.0/resolve/main/onnx/model_q4f16.onnx",
    "https://huggingface.co/webnn/RMBG-2.0/resolve/main/onnx/model.onnx",
  ],
};
const DEFAULT_MEAN = [0.485, 0.456, 0.406];
const DEFAULT_STD = [0.229, 0.224, 0.225];

export const REMBG_MODELS = [
  { name: "u2net", label: "u2net", inputSize: 320, fileName: "u2net.onnx", description: "General-purpose pre-trained model." },
  { name: "u2netp", label: "u2netp", inputSize: 320, fileName: "u2netp.onnx", description: "Lightweight U2Net variant for faster inference." },
  { name: "u2net_human_seg", label: "u2net_human_seg", inputSize: 320, fileName: "u2net_human_seg.onnx", description: "Specialized for human segmentation." },
  { name: "u2net_cloth_seg", label: "u2net_cloth_seg", inputSize: 768, fileName: "u2net_cloth_seg.onnx", description: "Clothing parsing for portrait photos (upper/lower/full body)." },
  { name: "silueta", label: "silueta", inputSize: 320, fileName: "silueta.onnx", description: "U2Net-like model with much smaller size (~43MB)." },
  { name: "isnet-general-use", label: "isnet-general-use", inputSize: 1024, fileName: "isnet-general-use.onnx", applySigmoid: true, description: "ISNet model for high-quality general use." },
  { name: "isnet-anime", label: "isnet-anime", inputSize: 1024, fileName: "isnet-anime.onnx", description: "High-accuracy model for anime-style characters." },
  { name: "birefnet-general", label: "birefnet-general", inputSize: 1024, fileName: "BiRefNet-general-epoch_244.onnx", altFileNames: ["birefnet-general.onnx"], applySigmoid: true, description: "BiRefNet model for general use." },
  { name: "birefnet-general-lite", label: "birefnet-general-lite", inputSize: 1024, fileName: "BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx", altFileNames: ["birefnet-general-lite.onnx"], applySigmoid: true, description: "Lightweight BiRefNet model for general use." },
  { name: "birefnet-portrait", label: "birefnet-portrait", inputSize: 1024, fileName: "BiRefNet-portrait-epoch_150.onnx", altFileNames: ["birefnet-portrait.onnx"], applySigmoid: true, description: "BiRefNet model tailored for portraits." },
  { name: "birefnet-dis", label: "birefnet-dis", inputSize: 1024, fileName: "BiRefNet-DIS-epoch_590.onnx", altFileNames: ["birefnet-dis.onnx"], applySigmoid: true, description: "BiRefNet model for dichotomous image segmentation (DIS)." },
  { name: "birefnet-hrsod", label: "birefnet-hrsod", inputSize: 1024, fileName: "BiRefNet-HRSOD_DHU-epoch_115.onnx", altFileNames: ["birefnet-hrsod.onnx"], applySigmoid: true, description: "BiRefNet model for high-resolution salient object detection (HRSOD)." },
  { name: "birefnet-cod", label: "birefnet-cod", inputSize: 1024, fileName: "BiRefNet-COD-epoch_125.onnx", altFileNames: ["birefnet-cod.onnx"], applySigmoid: true, description: "BiRefNet model for concealed object detection (COD)." },
  { name: "birefnet-massive", label: "birefnet-massive", inputSize: 1024, fileName: "BiRefNet-massive-TR_DIS5K_TR_TEs-epoch_420.onnx", altFileNames: ["birefnet-massive.onnx"], applySigmoid: true, description: "BiRefNet model trained on a massive dataset." },
  { name: "bria-rmbg", label: "bria-rmbg", inputSize: 1024, fileName: "bria-rmbg-2.0.onnx", altFileNames: ["model.onnx", "bria-rmbg.onnx"], mean: [0.5, 0.5, 0.5], std: [1.0, 1.0, 1.0], description: "State-of-the-art background removal model by BRIA AI." },
  // SAM needs two ONNX files (encoder + decoder) and dedicated prompt flow.
  // This web pipeline currently supports single-model segmentation sessions only.
];

let ortConfigured = false;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function joinUrl(base, fileName) {
  return `${String(base || "").replace(/\/+$/, "")}/${fileName}`;
}

function maybeAppendHfDownload(url) {
  if (!/huggingface\.co/i.test(url) || /[?&]download=/i.test(url)) {
    return url;
  }
  return `${url}${url.includes("?") ? "&" : "?"}download=true`;
}

function normalizeUrlList(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function normalizeFileNameList(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function hasWebGpuSupport() {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

function isRemoteBaseUrl(url) {
  return /^https?:\/\//i.test(String(url || ""));
}

function isLikelyOutOfMemoryError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /failed to allocate a buffer|out of memory|cannot enlarge memory|webassembly\.memory/i.test(message);
}

function buildModelMemoryError(modelName, error) {
  const suffix = error instanceof Error ? error.message : String(error || "unknown error");
  return new Error(
    `Model '${modelName}' is too large for browser memory (${suffix}). `
    + "Try a lighter model: u2netp / u2net / isnet-general-use / birefnet-general-lite.",
  );
}

function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function encodeMaskImageData(mask, width, height) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < mask.length; i += 1) {
    const value = Math.max(0, Math.min(255, Math.round(mask[i] * 255)));
    const offset = i * 4;
    rgba[offset] = value;
    rgba[offset + 1] = value;
    rgba[offset + 2] = value;
    rgba[offset + 3] = 255;
  }
  return new ImageData(rgba, width, height);
}

function encodeCutoutImageData(source, alphaMask, output) {
  const { width, height, data } = source;
  const out = new Uint8ClampedArray(data.length);

  for (let i = 0; i < width * height; i += 1) {
    const src = i * 4;
    const alpha = alphaMask[i];
    const srcAlpha = data[src + 3];
    const multipliedAlpha = Math.round((alpha * srcAlpha) / 255);

    if (output === "mask") {
      out[src] = alpha;
      out[src + 1] = alpha;
      out[src + 2] = alpha;
      out[src + 3] = 255;
      continue;
    }

    if (output === "foreground") {
      const blend = alpha / 255;
      out[src] = Math.round(data[src] * blend + 255 * (1 - blend));
      out[src + 1] = Math.round(data[src + 1] * blend + 255 * (1 - blend));
      out[src + 2] = Math.round(data[src + 2] * blend + 255 * (1 - blend));
      out[src + 3] = 255;
      continue;
    }

    out[src] = data[src];
    out[src + 1] = data[src + 1];
    out[src + 2] = data[src + 2];
    out[src + 3] = multipliedAlpha;
  }

  return new ImageData(out, width, height);
}

async function sourceToImageBitmap(source) {
  if (source instanceof ImageBitmap) {
    return source;
  }
  if (source instanceof Blob) {
    return await createImageBitmap(source);
  }
  if (source instanceof HTMLImageElement || source instanceof HTMLCanvasElement || source instanceof ImageData) {
    return await createImageBitmap(source);
  }
  throw new Error("Unsupported source type for removeBackground");
}

function imageBitmapToImageData(imageBitmap) {
  const canvas = createCanvas(imageBitmap.width, imageBitmap.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(imageBitmap, 0, 0);
  return ctx.getImageData(0, 0, imageBitmap.width, imageBitmap.height);
}

function preprocessToTensor(imageBitmap, inputSize, mean, std) {
  const canvas = createCanvas(inputSize, inputSize);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const scale = Math.min(inputSize / imageBitmap.width, inputSize / imageBitmap.height);
  const drawWidth = Math.max(1, Math.round(imageBitmap.width * scale));
  const drawHeight = Math.max(1, Math.round(imageBitmap.height * scale));
  const padX = Math.floor((inputSize - drawWidth) / 2);
  const padY = Math.floor((inputSize - drawHeight) / 2);

  ctx.clearRect(0, 0, inputSize, inputSize);
  ctx.drawImage(imageBitmap, padX, padY, drawWidth, drawHeight);
  const imageData = ctx.getImageData(0, 0, inputSize, inputSize);

  const plane = inputSize * inputSize;
  const tensorData = new Float32Array(3 * plane);

  for (let y = 0; y < inputSize; y += 1) {
    for (let x = 0; x < inputSize; x += 1) {
      const pixelIndex = y * inputSize + x;
      const src = pixelIndex * 4;

      const r = imageData.data[src] / 255;
      const g = imageData.data[src + 1] / 255;
      const b = imageData.data[src + 2] / 255;

      tensorData[pixelIndex] = (r - mean[0]) / std[0];
      tensorData[plane + pixelIndex] = (g - mean[1]) / std[1];
      tensorData[plane * 2 + pixelIndex] = (b - mean[2]) / std[2];
    }
  }

  return {
    tensor: new ort.Tensor("float32", tensorData, [1, 3, inputSize, inputSize]),
    meta: { inputSize, drawWidth, drawHeight, padX, padY },
  };
}

function getPrimaryMaskTensor(outputTensor) {
  const { data, dims } = outputTensor;
  if (!dims || !dims.length) {
    throw new Error("Unexpected model output dims");
  }

  if (dims.length === 4) {
    const h = dims[2];
    const w = dims[3];
    return { data: data.slice(0, h * w), width: w, height: h };
  }

  if (dims.length === 3) {
    const h = dims[1];
    const w = dims[2];
    return { data: data.slice(0, h * w), width: w, height: h };
  }

  if (dims.length === 2) {
    const h = dims[0];
    const w = dims[1];
    return { data, width: w, height: h };
  }

  throw new Error(`Unsupported output dims: ${dims.join("x")}`);
}

function normalizeMask(maskValues, applySigmoid) {
  const out = new Float32Array(maskValues.length);
  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < maskValues.length; i += 1) {
    let value = Number(maskValues[i]);
    if (!Number.isFinite(value)) {
      value = 0;
    }
    if (applySigmoid) {
      value = 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, value))));
    }
    out[i] = value;
    if (value < minValue) {
      minValue = value;
    }
    if (value > maxValue) {
      maxValue = value;
    }
  }

  const range = maxValue - minValue;
  if (range < 1e-8) {
    for (let i = 0; i < out.length; i += 1) {
      out[i] = clamp01(out[i]);
    }
    return out;
  }

  for (let i = 0; i < out.length; i += 1) {
    out[i] = clamp01((out[i] - minValue) / range);
  }
  return out;
}

function resizeMaskToSource(mask, maskWidth, maskHeight, sourceWidth, sourceHeight, preprocessMeta, feather) {
  const maskCanvas = createCanvas(maskWidth, maskHeight);
  const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
  maskCtx.putImageData(encodeMaskImageData(mask, maskWidth, maskHeight), 0, 0);

  const outCanvas = createCanvas(sourceWidth, sourceHeight);
  const outCtx = outCanvas.getContext("2d", { willReadFrequently: true });

  const sx = preprocessMeta.padX;
  const sy = preprocessMeta.padY;
  const sw = preprocessMeta.drawWidth;
  const sh = preprocessMeta.drawHeight;
  outCtx.drawImage(maskCanvas, sx, sy, sw, sh, 0, 0, sourceWidth, sourceHeight);

  if (feather > 0) {
    const blurCanvas = createCanvas(sourceWidth, sourceHeight);
    const blurCtx = blurCanvas.getContext("2d", { willReadFrequently: true });
    blurCtx.filter = `blur(${feather}px)`;
    blurCtx.drawImage(outCanvas, 0, 0);
    blurCtx.filter = "none";
    const blurred = blurCtx.getImageData(0, 0, sourceWidth, sourceHeight).data;
    const alpha = new Uint8ClampedArray(sourceWidth * sourceHeight);
    for (let i = 0; i < alpha.length; i += 1) {
      alpha[i] = blurred[i * 4];
    }
    return alpha;
  }

  const resized = outCtx.getImageData(0, 0, sourceWidth, sourceHeight).data;
  const alpha = new Uint8ClampedArray(sourceWidth * sourceHeight);
  for (let i = 0; i < alpha.length; i += 1) {
    alpha[i] = resized[i * 4];
  }
  return alpha;
}

function thresholdMask(alphaMask, threshold) {
  if (threshold <= 0) {
    return alphaMask;
  }
  const out = new Uint8ClampedArray(alphaMask.length);
  const thresholdByte = Math.round(clamp01(threshold) * 255);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = alphaMask[i] >= thresholdByte ? alphaMask[i] : 0;
  }
  return out;
}

class RembgWebProcessor {
  constructor(options = {}) {
    this.modelBaseUrl = options.modelBaseUrl || DEFAULT_MODEL_BASE_URL;
    this.modelBaseUrlFallbacks = Array.isArray(options.modelBaseUrlFallbacks)
      ? options.modelBaseUrlFallbacks
      : DEFAULT_MODEL_BASE_URL_FALLBACKS;
    this.modelUrlOverrides = {
      ...DEFAULT_MODEL_URL_OVERRIDES,
      ...(options.modelUrlOverrides || {}),
    };
    this.sessionCache = new Map();
    this.selectedProviderByModel = new Map();
    this.selectedSourceByModel = new Map();
    this.wasmPath = options.wasmPath || "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";
  }

  listModels() {
    return REMBG_MODELS.map((item) => ({ ...item }));
  }

  getModelConfig(modelName) {
    const config = REMBG_MODELS.find((item) => item.name === modelName);
    if (!config) {
      const supported = REMBG_MODELS.map((item) => item.name).join(", ");
      throw new Error(`Unknown model '${modelName}'. Supported models: ${supported}`);
    }
    const overrideUrls = normalizeUrlList(this.modelUrlOverrides[modelName]);
    const modelFileNames = [config.fileName, ...normalizeFileNameList(config.altFileNames)]
      .filter((item, index, arr) => typeof item === "string" && item.trim() && arr.indexOf(item) === index);
    const localFileNames = modelFileNames;
    const remoteFileNames = [config.fileName].filter(Boolean);
    const candidateUrls = [];
    const seen = new Set();

    for (const url of overrideUrls) {
      const normalized = maybeAppendHfDownload(url);
      if (!seen.has(normalized)) {
        candidateUrls.push(normalized);
        seen.add(normalized);
      }
    }

    const baseCandidates = [this.modelBaseUrl, ...this.modelBaseUrlFallbacks];
    for (const base of baseCandidates) {
      if (typeof base !== "string" || !base.trim()) {
        continue;
      }
      const fileNames = isRemoteBaseUrl(base) ? remoteFileNames : localFileNames;
      for (const fileName of fileNames) {
        const modelUrl = maybeAppendHfDownload(joinUrl(base, fileName));
        if (!seen.has(modelUrl)) {
          candidateUrls.push(modelUrl);
          seen.add(modelUrl);
        }
      }
    }

    return {
      ...config,
      mean: config.mean || DEFAULT_MEAN,
      std: config.std || DEFAULT_STD,
      applySigmoid: Boolean(config.applySigmoid),
      candidateUrls,
    };
  }

  configureOrt() {
    if (ortConfigured) {
      return;
    }
    if (typeof ort === "undefined") {
      throw new Error("onnxruntime-web script is not loaded");
    }
    ort.env.wasm.wasmPaths = this.wasmPath;
    ort.env.wasm.numThreads = Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2));
    ortConfigured = true;
  }

  async createSessionFromUrl(modelName, modelUrl) {
    this.configureOrt();

    if (hasWebGpuSupport()) {
      try {
        const session = await ort.InferenceSession.create(modelUrl, {
          executionProviders: ["webgpu"],
          graphOptimizationLevel: "all",
        });
        this.selectedProviderByModel.set(modelName, "webgpu");
        return session;
      } catch (error) {
        console.warn(`[rembg-web] WebGPU init failed for ${modelName}, fallback to WASM`, error);
      }
    }

    const session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
    this.selectedProviderByModel.set(modelName, "wasm");
    return session;
  }

  async createWasmSession(modelName, modelUrl) {
    this.configureOrt();
    const session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
    this.selectedProviderByModel.set(modelName, "wasm");
    this.selectedSourceByModel.set(modelName, modelUrl);
    this.sessionCache.set(modelName, session);
    return session;
  }

  async createSession(modelName, modelUrls) {
    let lastError = null;

    for (const modelUrl of modelUrls) {
      try {
        const session = await this.createSessionFromUrl(modelName, modelUrl);
        this.selectedSourceByModel.set(modelName, modelUrl);
        return session;
      } catch (error) {
        lastError = error;
        console.warn(`[rembg-web] Failed to load ${modelName} from ${modelUrl}`, error);
        if (isLikelyOutOfMemoryError(error)) {
          throw buildModelMemoryError(modelName, error);
        }
      }
    }

    if (isLikelyOutOfMemoryError(lastError)) {
      throw buildModelMemoryError(modelName, lastError);
    }

    const suffix = lastError instanceof Error ? lastError.message : String(lastError || "unknown error");
    throw new Error(`Failed to load model '${modelName}' from all sources: ${suffix}`);
  }

  async getSession(modelName) {
    if (this.sessionCache.has(modelName)) {
      return this.sessionCache.get(modelName);
    }
    const model = this.getModelConfig(modelName);
    const session = await this.createSession(modelName, model.candidateUrls);
    this.sessionCache.set(modelName, session);
    return session;
  }

  async removeBackground(source, options = {}) {
    const modelName = options.model || "u2net";
    const output = options.output || "cutout";
    const threshold = clamp01(Number(options.threshold || 0));
    const feather = Math.max(0, Number(options.feather || 0));

    const model = this.getModelConfig(modelName);
    const session = await this.getSession(modelName);
    const input = await sourceToImageBitmap(source);
    const sourceImageData = imageBitmapToImageData(input);

    const { tensor, meta } = preprocessToTensor(input, model.inputSize, model.mean, model.std);
    const feeds = { [session.inputNames[0]]: tensor };
    let activeSession = session;
    let outputs;
    try {
      outputs = await activeSession.run(feeds);
    } catch (error) {
      const provider = this.selectedProviderByModel.get(modelName) || "";
      const sourceUrl = this.selectedSourceByModel.get(modelName) || model.candidateUrls[0] || "";
      if (provider === "webgpu" && sourceUrl) {
        console.warn(`[rembg-web] WebGPU run failed for ${modelName}, retry with WASM`, error);
        activeSession = await this.createWasmSession(modelName, sourceUrl);
        outputs = await activeSession.run(feeds);
      } else {
        throw error;
      }
    }

    const outputName = model.outputName && outputs[model.outputName]
      ? model.outputName
      : activeSession.outputNames[0];
    const outputTensor = outputs[outputName] || outputs[Object.keys(outputs)[0]];
    if (!outputTensor) {
      throw new Error("Model produced no output tensors");
    }

    const primaryMask = getPrimaryMaskTensor(outputTensor);
    const normalizedMask = normalizeMask(primaryMask.data, model.applySigmoid);
    const alphaMask = resizeMaskToSource(
      normalizedMask,
      primaryMask.width,
      primaryMask.height,
      input.width,
      input.height,
      meta,
      feather,
    );
    const thresholdedMask = thresholdMask(alphaMask, threshold);
    const imageData = encodeCutoutImageData(sourceImageData, thresholdedMask, output);

    return {
      model: modelName,
      provider: this.selectedProviderByModel.get(modelName) || "wasm",
      sourceUrl: this.selectedSourceByModel.get(modelName) || "",
      width: input.width,
      height: input.height,
      imageData,
      alphaMask: thresholdedMask,
    };
  }
}

export function createRembgProcessor(options = {}) {
  return new RembgWebProcessor(options);
}
