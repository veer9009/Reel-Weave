"""Deterministic real media helpers; only installed FFmpeg and Python stdlib."""

import json
import math
import struct
import subprocess
import wave


def make_song(path, seconds=8):
    with wave.open(str(path), "wb") as out:
        out.setnchannels(2)
        out.setsampwidth(2)
        out.setframerate(48000)
        raw = bytearray()
        for i in range(round(seconds * 48000)):
            tone = 330 if i < 96000 else 660 if i < 144000 else 990
            sample = round(2500 * math.sin(2 * math.pi * tone * i / 48000))
            raw.extend(struct.pack("<hh", sample, sample))
        out.writeframes(raw)


def run_media(args):
    result = subprocess.run(args, capture_output=True, timeout=120, check=False)
    assert result.returncode == 0, result.stderr.decode(errors="replace")[-4000:]
    return result.stdout


def make_video(ffmpeg, path, color, frames=150, fps=25, tone=440):
    args = [
        ffmpeg,
        "-v",
        "error",
        "-nostdin",
        "-y",
        "-f",
        "lavfi",
        "-i",
        f"color=c={color}:s=320x180:r={fps}",
    ]
    if tone:
        args += [
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency={tone}:sample_rate=48000",
            "-af",
            "volume=0.5",
            "-c:a",
            "aac",
        ]
    args += [
        "-frames:v",
        str(frames),
        "-t",
        str(frames / fps),
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-pix_fmt",
        "yuv420p",
        str(path),
    ]
    run_media(args)


def make_marked_video(ffmpeg, path, frames, fps, phase=0):
    """Lossless per-frame luminance markers, independent of final H.264 bytes."""
    run_media(
        [
            ffmpeg,
            "-v",
            "error",
            "-nostdin",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"color=black:s=160x90:r={fps}",
            "-vf",
            f"geq=lum='32+mod(N*17+{phase},180)':cb=128:cr=128",
            "-frames:v",
            str(frames),
            "-an",
            "-c:v",
            "ffv1",
            str(path),
        ]
    )


def frame_markers(ffmpeg, path):
    raw = run_media(
        [
            ffmpeg,
            "-v",
            "error",
            "-i",
            str(path),
            "-map",
            "0:v:0",
            "-vf",
            "scale=1:1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1",
        ]
    )
    return [tuple(raw[i : i + 3]) for i in range(0, len(raw), 3)]


def probe(ffprobe, path):
    return json.loads(
        run_media(
            [
                ffprobe,
                "-v",
                "error",
                "-count_frames",
                "-show_streams",
                "-show_format",
                "-of",
                "json",
                str(path),
            ]
        )
    )


def pixel(ffmpeg, path, frame, x=None, y=None):
    crop = f",crop=1:1:{x}:{y}:exact=1" if x is not None else ",scale=1:1"
    raw = run_media(
        [
            ffmpeg,
            "-v",
            "error",
            "-i",
            str(path),
            "-vf",
            f"select=eq(n\\,{frame})" + crop,
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1",
        ]
    )
    return tuple(raw[:3])


def samples(ffmpeg, path, start, duration):
    raw = run_media(
        [
            ffmpeg,
            "-v",
            "error",
            "-i",
            str(path),
            "-ss",
            str(start),
            "-t",
            str(duration),
            "-map",
            "0:a:0",
            "-ac",
            "1",
            "-ar",
            "48000",
            "-f",
            "f32le",
            "pipe:1",
        ]
    )
    return struct.unpack("<" + "f" * (len(raw) // 4), raw)


def energy(values, tone):
    count = len(values)
    return (
        sum(v * math.sin(2 * math.pi * tone * i / 48000) for i, v in enumerate(values)) ** 2
        + sum(v * math.cos(2 * math.pi * tone * i / 48000) for i, v in enumerate(values)) ** 2
    ) / max(1, count * count)
