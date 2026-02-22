import base64
import csv
import io
import re
import struct
from pathlib import Path
from typing import Any

import numpy as np
import uvicorn
from fastapi import Body, FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image
from rembg import new_session, remove


APP_DIR = Path(__file__).resolve().parent
app = FastAPI(title="Image Color Inspector API")
SESSION_CACHE: dict[str, Any] = {}
DEFAULT_MODEL = "u2net"
MAX_SAMPLES = 12000
KMEANS_ITERATIONS = 12


def error_response(message: str, status_code: int) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"error": message})


def clamp_int(value: int, min_value: int, max_value: int) -> int:
    return max(min_value, min(max_value, int(value)))


def rgb_to_hex(r: int, g: int, b: int) -> str:
    return f"#{r:02X}{g:02X}{b:02X}"


def sanitize_file_stem(file_name: str) -> str:
    stem = Path(file_name or "palette").stem
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("._")
    return stem or "palette"


def parse_bool(value) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def get_session(model_name: str):
    if model_name not in SESSION_CACHE:
        SESSION_CACHE[model_name] = new_session(model_name=model_name)
    return SESSION_CACHE[model_name]


def resize_image(image: Image.Image, max_side: int) -> Image.Image:
    width, height = image.size
    scale = min(1.0, max_side / max(width, height))
    out_width = max(1, round(width * scale))
    out_height = max(1, round(height * scale))
    if (out_width, out_height) == (width, height):
        return image
    return image.resize((out_width, out_height), Image.Resampling.LANCZOS)


def build_sample_pixels(rgba_data: np.ndarray, max_samples: int = MAX_SAMPLES) -> np.ndarray:
    height, width, _ = rgba_data.shape
    flat = rgba_data.reshape(-1, 4)
    total = width * height
    step = max(1, total // max_samples)
    sampled = flat[0:total:step]
    opaque = sampled[sampled[:, 3] > 0][:, :3]
    if opaque.size == 0:
        return np.array([[0.0, 0.0, 0.0]], dtype=np.float32)
    return opaque.astype(np.float32)


def init_centroids(samples: np.ndarray, k: int, rng: np.random.Generator) -> np.ndarray:
    centroids = np.empty((k, 3), dtype=np.float32)
    centroids[0] = samples[rng.integers(0, len(samples))]
    stride = max(1, len(samples) // 2000)

    for idx in range(1, k):
        candidate = samples[rng.integers(0, len(samples))]
        best_min_dist = -1.0

        for sample_idx in range(0, len(samples), stride):
            sample = samples[sample_idx]
            diffs = centroids[:idx] - sample
            dists = np.sum(diffs * diffs, axis=1)
            min_dist = float(np.min(dists))
            if min_dist > best_min_dist:
                best_min_dist = min_dist
                candidate = sample

        centroids[idx] = candidate

    return centroids


def run_kmeans(samples: np.ndarray, k: int, iterations: int = KMEANS_ITERATIONS) -> np.ndarray:
    rng = np.random.default_rng()
    centroids = init_centroids(samples, k, rng)

    for _ in range(iterations):
        diffs = samples[:, None, :] - centroids[None, :, :]
        distances = np.sum(diffs * diffs, axis=2)
        assignment = np.argmin(distances, axis=1)

        counts = np.bincount(assignment, minlength=k)
        sums = np.zeros((k, 3), dtype=np.float64)
        np.add.at(sums, assignment, samples)

        for centroid_idx in range(k):
            if counts[centroid_idx] == 0:
                centroids[centroid_idx] = samples[rng.integers(0, len(samples))]
            else:
                centroids[centroid_idx] = sums[centroid_idx] / counts[centroid_idx]

    return np.clip(np.rint(centroids), 0, 255).astype(np.uint8)


def assign_nearest_chunked(
    colors: np.ndarray, centroids: np.ndarray, chunk_size: int = 50000
) -> np.ndarray:
    if colors.size == 0:
        return np.empty((0,), dtype=np.uint16)

    indices = np.empty((len(colors),), dtype=np.uint16)
    centroids_i32 = centroids.astype(np.int32)

    for start in range(0, len(colors), chunk_size):
        end = min(start + chunk_size, len(colors))
        block = colors[start:end].astype(np.int32)
        diffs = block[:, None, :] - centroids_i32[None, :, :]
        distances = np.sum(diffs * diffs, axis=2)
        indices[start:end] = np.argmin(distances, axis=1).astype(np.uint16)

    return indices


def quantize_image(rgba_data: np.ndarray, k: int):
    height, width, _ = rgba_data.shape
    flat = rgba_data.reshape(-1, 4)
    rgb = flat[:, :3]
    alpha = flat[:, 3]
    opaque_mask = alpha > 0

    samples = build_sample_pixels(rgba_data)
    centroids = run_kmeans(samples, k)

    indexed_pixels = np.zeros((width * height,), dtype=np.uint16)
    counts = np.zeros((k,), dtype=np.uint32)
    out_flat = np.zeros_like(flat)

    if np.any(opaque_mask):
        opaque_colors = rgb[opaque_mask]
        unique_colors, inverse = np.unique(opaque_colors, axis=0, return_inverse=True)
        nearest_unique = assign_nearest_chunked(unique_colors, centroids)
        opaque_indices = nearest_unique[inverse]

        indexed_pixels[opaque_mask] = opaque_indices
        counts = np.bincount(opaque_indices, minlength=k).astype(np.uint32)
        out_flat[opaque_mask, :3] = centroids[opaque_indices]
        out_flat[opaque_mask, 3] = 255

    total_pixels = width * height
    palette = []
    for idx, (r, g, b) in enumerate(centroids):
        count = int(counts[idx])
        palette.append(
            {
                "index": idx,
                "r": int(r),
                "g": int(g),
                "b": int(b),
                "hex": rgb_to_hex(int(r), int(g), int(b)),
                "count": count,
                "pct": (count / total_pixels) * 100 if total_pixels > 0 else 0.0,
            }
        )

    return out_flat.reshape((height, width, 4)), indexed_pixels, palette


def build_aco_bytes(colors) -> bytes:
    out = io.BytesIO()

    def write_u16(value: int):
        out.write(struct.pack(">H", value & 0xFFFF))

    def write_u32(value: int):
        out.write(struct.pack(">I", value & 0xFFFFFFFF))

    def write_record(color):
        write_u16(0)  # RGB
        write_u16(int(color["r"]) * 257)
        write_u16(int(color["g"]) * 257)
        write_u16(int(color["b"]) * 257)
        write_u16(0)

    write_u16(1)
    write_u16(len(colors))
    for color in colors:
        write_record(color)

    write_u16(2)
    write_u16(len(colors))
    for idx, color in enumerate(colors):
        write_record(color)
        name = f"Color {idx + 1} {color['hex']}"
        encoded = name.encode("utf-16-be")
        write_u32((len(encoded) // 2) + 1)
        out.write(encoded)
        write_u16(0)

    return out.getvalue()


@app.get("/health")
def health():
    """Liveness check endpoint used by local tooling/monitoring."""
    return {"ok": True}


@app.post("/api/process-image")
async def process_image(
    image: UploadFile | None = File(default=None),
    color_count: str = Form(default="32"),
    max_side: str = Form(default="800"),
    remove_bg: str = Form(default="false"),
):
    """
    Quantize an image, optionally removing background before quantization.

    Request (multipart/form-data):
    - image: required binary image file.
    - color_count: optional int in [2, 128], default 32.
    - max_side: optional int in [128, 2048], default 800.
    - remove_bg: optional bool-like string; true values:
      1/true/yes/on (case-insensitive). Default false.

    Response (application/json):
    - width, height: processed image size after resize.
    - palette: centroid list with count/pct for each index.
    - sorted_palette: palette sorted by count descending.
    - indexed_pixels_b64: little-endian uint16 index map (base64).
    - quantized_png_b64: quantized RGBA PNG payload (base64).
    """
    if image is None:
        return error_response("Missing multipart field: image", 400)

    input_bytes = await image.read()
    if not input_bytes:
        return error_response("Empty image payload", 400)

    try:
        parsed_color_count = clamp_int(int(color_count), 2, 128)
    except ValueError:
        return error_response("Invalid color_count", 400)

    try:
        parsed_max_side = clamp_int(int(max_side), 128, 2048)
    except ValueError:
        return error_response("Invalid max_side", 400)

    if parse_bool(remove_bg):
        try:
            input_bytes = remove(input_bytes, session=get_session(DEFAULT_MODEL))
        except Exception as exc:
            return error_response(f"rembg failed: {exc}", 500)

    try:
        source = Image.open(io.BytesIO(input_bytes)).convert("RGBA")
    except Exception:
        return error_response("Unsupported image format", 400)

    resized = resize_image(source, parsed_max_side)
    rgba = np.array(resized, dtype=np.uint8)
    quantized_rgba, indexed_pixels, palette = quantize_image(rgba, parsed_color_count)

    quantized_image = Image.fromarray(quantized_rgba, mode="RGBA")
    quantized_buf = io.BytesIO()
    quantized_image.save(quantized_buf, format="PNG")

    sorted_palette = sorted(palette, key=lambda item: item["count"], reverse=True)

    return {
        "width": resized.width,
        "height": resized.height,
        "palette": palette,
        "sorted_palette": sorted_palette,
        "indexed_pixels_b64": base64.b64encode(indexed_pixels.astype("<u2").tobytes()).decode(
            "ascii"
        ),
        "quantized_png_b64": base64.b64encode(quantized_buf.getvalue()).decode("ascii"),
    }


@app.post("/api/export")
def export_palette(payload: dict[str, Any] | None = Body(default=None)):
    """
    Export palette data to CSV or ACO.

    Request (application/json):
    - file_name: optional source filename used for download naming.
    - format: optional "csv" | "aco", default "csv".
    - palette: required non-empty array of palette entries.

    Response:
    - 200 with file attachment:
      - text/csv for CSV
      - application/octet-stream for ACO
    """
    payload = payload or {}
    palette = payload.get("palette")
    if not isinstance(palette, list) or not palette:
        return error_response("palette must be a non-empty array", 400)

    export_format = str(payload.get("format") or "csv").strip().lower()
    if export_format not in {"csv", "aco"}:
        return error_response("format must be one of: csv, aco", 400)

    file_stem = sanitize_file_stem(payload.get("file_name") or "palette")
    if export_format == "csv":
        download_name = f"{file_stem}_N{len(palette)}.csv"
        text_buf = io.StringIO()
        writer = csv.writer(text_buf, lineterminator="\n")
        writer.writerow(["index", "hex", "r", "g", "b", "count", "percentage"])
        for color in palette:
            writer.writerow(
                [
                    int(color.get("index", 0)),
                    str(color.get("hex", "")),
                    int(color.get("r", 0)),
                    int(color.get("g", 0)),
                    int(color.get("b", 0)),
                    int(color.get("count", 0)),
                    f"{float(color.get('pct', 0.0)):.4f}",
                ]
            )
        raw = text_buf.getvalue().encode("utf-8")
        return Response(
            content=raw,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{download_name}"'},
        )

    download_name = f"{file_stem}_N{len(palette)}.aco"
    aco_bytes = build_aco_bytes(palette)
    return Response(
        content=aco_bytes,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{download_name}"'},
    )


# Mount static files after API routes so /api/* takes precedence.
app.mount("/", StaticFiles(directory=str(APP_DIR), html=True), name="static")


if __name__ == "__main__":
    uvicorn.run("server:app", host="127.0.0.1", port=5000, reload=True)
