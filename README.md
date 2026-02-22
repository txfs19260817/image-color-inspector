# Image Color Inspector (Frontend-Only)

Local web app that:
- Quantizes an image to `N` colors (default `N=32`)
- Shows palette with pixel count and percentage
- Displays `HEX + (x,y) + count` on hover
- Exports palette as CSV or ACO
- Optionally removes background in-browser via ONNX Runtime Web (`WebGPU` first, `WASM` fallback)

## What Changed

- Backend API (`/api/process-image`, `/api/export`) is no longer used.
- `rembg` inference now runs in browser with `onnxruntime-web`.
- Quantization and export logic are now pure frontend JavaScript.
- Added rembg model selector in UI:
  - `u2net`
  - `u2netp`
  - `u2net_human_seg`
  - `u2net_cloth_seg`
  - `silueta`
  - `isnet-general-use`
  - `isnet-anime`
  - `birefnet-general`
  - `birefnet-general-lite`
  - `birefnet-portrait`
  - `birefnet-dis`
  - `birefnet-hrsod`
  - `birefnet-cod`
  - `birefnet-massive`
  - `bria-rmbg`

## Run

Any static server works.

```powershell
cd D:\Projects\image-color-inspector
python -m http.server 5000
```

Open: `http://127.0.0.1:5000`

## Model Hosting

Default model source order is:

1. CDN primary: `https://huggingface.co/tomjackson2023/rembg/resolve/main/{fileName}?download=true`
2. Local fallback: `./models/{fileName}`

BiRefNet/BRIA use dedicated Hugging Face model URLs by default (`DEFAULT_MODEL_URL_OVERRIDES`) because:
- some files are not present in `tomjackson2023/rembg`
- GitHub release direct URLs are often blocked by browser CORS

Code location: `rembg-web.js`

- `DEFAULT_MODEL_BASE_URL`
- `DEFAULT_MODEL_BASE_URL_FALLBACKS`
- `DEFAULT_MODEL_URL_OVERRIDES`
- `REMBG_MODELS`

`REMBG_MODELS` supports `allowWebGpu: false` to skip WebGPU and use WASM directly for unstable models.

Put ONNX files under `models/` using these exact filenames:

- `u2net.onnx`
- `u2netp.onnx`
- `u2net_human_seg.onnx`
- `u2net_cloth_seg.onnx`
- `silueta.onnx`
- `isnet-general-use.onnx`
- `isnet-anime.onnx`
- `BiRefNet-general-epoch_244.onnx`
- `BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx`
- `BiRefNet-portrait-epoch_150.onnx`
- `BiRefNet-DIS-epoch_590.onnx`
- `BiRefNet-HRSOD_DHU-epoch_115.onnx`
- `BiRefNet-COD-epoch_125.onnx`
- `BiRefNet-massive-TR_DIS5K_TR_TEs-epoch_420.onnx`
- `bria-rmbg-2.0.onnx`

Note: `sam` in rembg requires two model files (`sam_vit_b_01ec64.encoder.onnx` and `sam_vit_b_01ec64.decoder.onnx`) and a different inference flow, so it is not included in this single-session web pipeline.

Compatibility note: this app also accepts common local aliases for BiRefNet/BRIA files, e.g. `birefnet-portrait.onnx` and `model.onnx`.

### Model File Map (CDN / Local Fallback)

All rows below map to:
- HF CDN: `https://huggingface.co/tomjackson2023/rembg/resolve/main/{fileName}?download=true`
- Local fallback: `./models/{fileName}`

| Model key | CDN fileName | Local fallback fileName | Local aliases accepted |
|---|---|---|---|
| `u2net` | `u2net.onnx` | `u2net.onnx` | - |
| `u2netp` | `u2netp.onnx` | `u2netp.onnx` | - |
| `u2net_human_seg` | `u2net_human_seg.onnx` | `u2net_human_seg.onnx` | - |
| `u2net_cloth_seg` | `u2net_cloth_seg.onnx` | `u2net_cloth_seg.onnx` | - |
| `silueta` | `silueta.onnx` | `silueta.onnx` | - |
| `isnet-general-use` | `isnet-general-use.onnx` | `isnet-general-use.onnx` | - |
| `isnet-anime` | `isnet-anime.onnx` | `isnet-anime.onnx` | - |
| `birefnet-general` | `onnx/model.onnx` (onnx-community/BiRefNet-ONNX) | `BiRefNet-general-epoch_244.onnx` | `birefnet-general.onnx` |
| `birefnet-general-lite` | `onnx/model.onnx` (onnx-community/BiRefNet_lite-ONNX) | `BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx` | `birefnet-general-lite.onnx` |
| `birefnet-portrait` | `onnx/model.onnx` (onnx-community/BiRefNet-portrait-ONNX) | `BiRefNet-portrait-epoch_150.onnx` | `birefnet-portrait.onnx` |
| `birefnet-dis` | `onnx/model.onnx` (onnx-community/BiRefNet-DIS5K-ONNX) | `BiRefNet-DIS-epoch_590.onnx` | `birefnet-dis.onnx` |
| `birefnet-hrsod` | `onnx/model.onnx` (onnx-community/BiRefNet-HRSOD_DHU-ONNX) | `BiRefNet-HRSOD_DHU-epoch_115.onnx` | `birefnet-hrsod.onnx` |
| `birefnet-cod` | `onnx/model.onnx` (onnx-community/BiRefNet-COD-ONNX) | `BiRefNet-COD-epoch_125.onnx` | `birefnet-cod.onnx` |
| `birefnet-massive` | `onnx/model.onnx` (onnx-community/BiRefNet-DIS5K-TR_TEs-ONNX) | `BiRefNet-massive-TR_DIS5K_TR_TEs-epoch_420.onnx` | `birefnet-massive.onnx` |
| `bria-rmbg` | `onnx/model_q4f16.onnx` (webnn/RMBG-2.0) | `bria-rmbg-2.0.onnx` | `model.onnx`, `bria-rmbg.onnx` |

You can customize fallback chain:

```js
createRembgProcessor({
  modelBaseUrl: "./models",
  modelBaseUrlFallbacks: [
    "https://your-cdn.example.com/rembg",
    "https://huggingface.co/tomjackson2023/rembg/resolve/main",
  ],
  modelUrlOverrides: {
    u2net: [
      "https://priority-cdn.example.com/rembg/u2net.onnx",
      "https://backup-cdn.example.com/rembg/u2net.onnx",
    ],
  },
});
```

## Runtime Notes

- WebGPU is attempted first when available.
- If WebGPU session creation fails, it falls back to WASM automatically.
- `onnxruntime-web` is loaded from CDN in `index.html`.
- First inference per model is slower because model download + session init happens in browser.

## Troubleshooting

- Error: `failed to allocate a buffer of size ...` while loading a model  
  This means browser memory is not enough for that ONNX model (common with very large BiRefNet checkpoints).  
  Use a lighter model in this app: `u2netp`, `u2net`, `isnet-general-use`, or `birefnet-general-lite`.

## Files

- `index.html`: UI + model selector + ORT script
- `app.js`: frontend pipeline (decode, optional remove-bg, quantize, export)
- `rembg-web.js`: model registry, ORT session cache, preprocess/inference/postprocess
- `styles.css`: styling
- `assets/logo.svg`, `assets/favicon.svg`: project-generated logo and favicon

## License

WTFPL (see `LICENSE`).
