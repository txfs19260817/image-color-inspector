# Image Color Inspector

Local web app that:
- Quantizes an image to `N` colors (default `N=32`)
- Shows full palette with pixel count and percentage
- Displays `HEX + (x,y) + count` on hover
- Exports palette as CSV
- Exports palette as ACO (`.aco`)
- Optional background removal before quantization (checkbox in UI)

## Run (with remove-bg feature)

```powershell
cd D:\Projects\image-color-inspector
uv python install 3.13
uv sync --python 3.13
uv run python server.py
```

Open `http://127.0.0.1:5000`.

## Architecture (single-stack business logic)
- Business logic is now unified in Python/FastAPI (`server.py`):
- Image resize + K-Means quantization
- Palette statistics and indexed pixel map
- CSV export and ACO export
- Optional remove-bg preprocessing via `rembg`
- Frontend `app.js` only handles UI interaction/rendering and API requests.

## Notes
- First `rembg` run may download model files, so initial remove-bg call can be slower.
- This project uses `rembg[gpu]` and targets Python `3.13.x`.
- Runtime compatibility pins: `numpy>=1.23,<3` and `pillow>=12.1,<13`.
- Ensure your CUDA/cuDNN runtime and GPU driver are compatible with `onnxruntime-gpu`.
- Quantization endpoint is `POST /api/process-image`; set `remove_bg=true` to remove background first.
- Large images are resized by `Max Side` before quantization for speed.
- Quantization uses K-Means plus unique-color nearest assignment in Python.

## API
### `GET /health`
- Purpose: liveness check.
- Response: `{"ok": true}`.

### `POST /api/process-image`
- Content-Type: `multipart/form-data`.
- Fields:
- `image` (required): input image file.
- `color_count` (optional): integer in `[2, 128]`, default `32`.
- `max_side` (optional): integer in `[128, 2048]`, default `800`.
- `remove_bg` (optional): bool-like string (`1|true|yes|on`), default `false`.
- Response JSON:
- `width`, `height`: processed image size.
- `palette`: full palette stats by centroid index.
- `sorted_palette`: same palette sorted by pixel count descending.
- `indexed_pixels_b64`: base64 of little-endian `uint16` index map.
- `quantized_png_b64`: base64 PNG of quantized image.

### `POST /api/export`
- Content-Type: `application/json`.
- Body:
- `file_name` (optional): source name for output filename.
- `format` (optional): `"csv"` or `"aco"`; default `"csv"`.
- `palette` (required): non-empty palette array.
- Response:
- CSV export returns a downloadable `.csv`.
- ACO export returns a downloadable `.aco`.

## How ACO export works
ACO is Adobe's binary swatch format (used by Photoshop and many compatible tools).  
In this project, export is implemented in Python `server.py` (`build_aco_bytes()` and unified `/api/export`).

1. File layout:
- The server writes both ACO v1 and v2 blocks in one file.
- v1 improves compatibility with older readers.
- v2 carries swatch names.

2. Byte order:
- All numeric fields are written as big-endian (`struct.pack(">H")` / `struct.pack(">I")`).

3. Color record format:
- Each color record is 10 bytes:
- `colorSpace` (2 bytes), then 4 channel values (each 2 bytes).
- For RGB records, `colorSpace = 0`.
- Channels are stored as 16-bit values, so 8-bit `R/G/B` are converted with `value * 257` (`0..255 -> 0..65535`).

4. v2 swatch names:
- For each swatch, the server writes a Unicode name like `Color 1 #AABBCC`.
- Name encoding is UTF-16BE with:
- a 32-bit character count (including trailing null),
- followed by characters,
- then a null terminator.

5. Export content:
- The exported palette source is `state.sortedPalette`, so colors are written in descending pixel frequency order.
- Output filename pattern: `<image_name>_N<color_count>.aco`.

## How K-Means is used here
1. Collect pixel samples:
The server reads RGB pixels from the current image (original or remove-bg result). To keep speed stable on large images, it samples up to about 12k pixels.

2. Initialize `K` centroids:
`K` is your `Colors (N)` setting. The server picks an initial color, then keeps adding centroid candidates that are far from existing centroids so starting points are spread out.

3. Iterate assignment/update:
For each iteration, every sample is assigned to its nearest centroid (Euclidean distance in RGB space), then each centroid is recomputed as the mean RGB of samples assigned to it.

4. Quantize every pixel:
After centroids stabilize, each image pixel is mapped to its nearest centroid, producing the quantized image.  
The server computes nearest assignments over unique colors, then expands back to all pixels.

5. Build palette stats:
Each centroid becomes one palette color (`#RRGGBB`), and the server counts how many pixels map to it to compute pixel count and percentage.

## References
- Adobe Photoshop File Formats Specification: https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/
- Larry Tesler ACO notes: https://www.nomodes.com/larry-tesler-personal/aco
- ACO/ASE engineering reference implementation: https://github.com/behreajj/AsepriteSwatchExchange
