"""Synthesizes the promo's background track and mixes it with the narration.

Usage: python3 music.py [--duration 44] [--scenes 5,11.4,19.6,24.8,30.8,38]
Reads build/line-<n>.wav (from voice.py) and narration.json; writes build/music.wav
and build/mix.wav (48 kHz stereo). Everything is generated here, so the track has no
third-party licensing.
"""

import argparse
import json
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import butter, lfilter, resample_poly, sosfilt

HERE = Path(__file__).parent
SR = 48000
BPM = 118
BEAT = 60 / BPM
BAR = 4 * BEAT

# vi - IV - I - V in C major, voiced around middle C (MIDI note numbers).
PROGRESSION = [
    {"root": 45, "pad": [57, 60, 64, 69]},  # Am
    {"root": 41, "pad": [57, 60, 65, 69]},  # F
    {"root": 48, "pad": [55, 60, 64, 67]},  # C
    {"root": 43, "pad": [55, 59, 62, 67]},  # G
]


def hz(note: float) -> float:
    return 440.0 * 2 ** ((note - 69) / 12)


def lowpass(x: np.ndarray, cutoff: float, order: int = 2) -> np.ndarray:
    return sosfilt(butter(order, cutoff, "low", fs=SR, output="sos"), x)


def highpass(x: np.ndarray, cutoff: float, order: int = 2) -> np.ndarray:
    return sosfilt(butter(order, cutoff, "high", fs=SR, output="sos"), x)


def saw(freq: float, n: int, harmonics: int = 10) -> np.ndarray:
    t = np.arange(n) / SR
    phase = np.random.uniform(0, 2 * np.pi)
    out = np.zeros(n)
    for k in range(1, harmonics + 1):
        if freq * k > SR / 2.5:
            break
        out += np.sin(2 * np.pi * freq * k * t + phase * k) / k
    return out


def env(n: int, attack: float, release: float) -> np.ndarray:
    e = np.ones(n)
    a, r = int(attack * SR), int(release * SR)
    if a:
        e[:a] = np.linspace(0, 1, a)
    if r:
        e[-r:] *= np.linspace(1, 0, r)
    return e


def add(track: np.ndarray, start: float, clip: np.ndarray) -> None:
    i = int(start * SR)
    if i >= len(track):
        return
    end = min(len(track), i + len(clip))
    track[i:end] += clip[: end - i]


def pad(total: int, bars: int) -> np.ndarray:
    out = np.zeros(total)
    n = int(BAR * SR)
    for b in range(bars):
        chord = PROGRESSION[b % 4]
        clip = np.zeros(n + int(0.6 * SR))
        for note in chord["pad"]:
            for detune in (-0.08, 0.0, 0.08):
                clip += saw(hz(note + detune), len(clip), 8)
        clip = lowpass(clip, 1400) * env(len(clip), 0.25, 0.7)
        add(out, b * BAR, clip * 0.035)
    return out


def bass(total: int, bars: int, start_bar: int) -> np.ndarray:
    out = np.zeros(total)
    step = BEAT / 2
    n = int(step * SR)
    t = np.arange(n) / SR
    for b in range(start_bar, bars):
        f = hz(PROGRESSION[b % 4]["root"])
        for s in range(8):
            tone = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t)
            tone = np.tanh(tone * 1.6) * np.exp(-t * 5) * env(n, 0.004, 0.02)
            add(out, b * BAR + s * step, tone * (0.24 if s % 2 == 0 else 0.17))
    return out


def kick(total: int, bars: int, start_bar: int, end_bar: int) -> tuple[np.ndarray, np.ndarray]:
    """Four-on-the-floor kick plus the sidechain gain curve it implies for the pad."""
    out = np.zeros(total)
    duck = np.ones(total)
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    freq = 50 + 110 * np.exp(-t * 30)
    body = np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-t * 9)
    shape = 1 - 0.55 * np.exp(-np.arange(int(BEAT * SR)) / SR * 9)
    for b in range(start_bar, min(bars, end_bar)):
        for beat in range(4):
            at = b * BAR + beat * BEAT
            add(out, at, body * 0.5)
            i = int(at * SR)
            seg = duck[i : i + len(shape)]
            seg *= shape[: len(seg)]
    return out, duck


def hats(total: int, bars: int, start_bar: int, end_bar: int) -> np.ndarray:
    out = np.zeros(total)
    n = int(0.08 * SR)
    for b in range(start_bar, min(bars, end_bar)):
        for s in range(8):
            noise = highpass(np.random.randn(n), 7000, 4) * np.exp(-np.arange(n) / SR * (60 if s % 2 else 90))
            add(out, b * BAR + s * BEAT / 2, noise * (0.05 if s % 2 else 0.025))
    return out


def arp(total: int, bars: int, start_bar: int, end_bar: int) -> np.ndarray:
    out = np.zeros(total)
    step = BEAT / 4
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    pattern = [0, 1, 2, 3, 2, 1, 2, 3]
    for b in range(start_bar, min(bars, end_bar)):
        notes = [x + 12 for x in PROGRESSION[b % 4]["pad"]]
        for s in range(16):
            f = hz(notes[pattern[s % 8]])
            tone = (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * 2 * f * t)) * np.exp(-t * 14)
            add(out, b * BAR + s * step, tone * 0.045)
    return out


def whoosh(total: int, at: float) -> np.ndarray:
    """Short filtered-noise swell that lands on a scene cut."""
    out = np.zeros(total)
    n = int(0.55 * SR)
    shape = np.sin(np.linspace(0, np.pi, n)) ** 2
    noise = lowpass(highpass(np.random.randn(n), 900), 6000) * shape
    add(out, at - 0.4, noise * 0.035)
    return out


def load_voice(duration: float) -> np.ndarray:
    lines = json.loads((HERE / "narration.json").read_text())
    voice = np.zeros(int(duration * SR))
    for i, line in enumerate(lines, 1):
        data, rate = sf.read(HERE / "build" / f"line-{i}.wav")
        data = resample_poly(data, SR, rate) if rate != SR else data
        add(voice, line["at"], data)
    return voice


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--duration", type=float, default=44.0)
    parser.add_argument("--scenes", default="5,11.4,19.6,24.8,30.8,38")
    args = parser.parse_args()

    np.random.seed(7)
    total = int(args.duration * SR)
    bars = int(np.ceil(args.duration / BAR)) + 1
    last = int((args.duration - 5.0) // BAR)  # drums stop so the outro can breathe

    kick_track, duck = kick(total, bars, 2, last)
    music = (
        pad(total, bars) * duck
        + bass(total, bars, 2) * np.minimum(1, duck + 0.25)
        + kick_track
        + hats(total, bars, 4, last)
        + arp(total, bars, 6, last + 1)
    )
    for cut in (float(x) for x in args.scenes.split(",")):
        music += whoosh(total, cut)

    fade_out = int(3.0 * SR)
    music[-fade_out:] *= np.linspace(1, 0, fade_out) ** 1.5
    music[: int(0.8 * SR)] *= np.linspace(0, 1, int(0.8 * SR))
    music = lowpass(music, 15000)
    music /= np.max(np.abs(music)) + 1e-9

    voice = load_voice(args.duration)
    voice = highpass(voice, 80)
    voice /= np.max(np.abs(voice)) + 1e-9

    # Duck the music while the narrator speaks.
    level = lfilter([1 - 0.9995], [1, -0.9995], np.abs(voice))
    speaking = np.clip(level / 0.04, 0, 1)
    speaking = lfilter([1 - 0.9997], [1, -0.9997], speaking)
    music_gain = 0.42 - 0.24 * np.clip(speaking * 1.4, 0, 1)

    mix = voice * 0.9 + music * music_gain
    mix /= np.max(np.abs(mix)) + 1e-9
    mix *= 0.89

    stereo_music = np.stack([music, music], axis=1)
    sf.write(HERE / "build" / "music.wav", stereo_music * 0.89, SR)
    sf.write(HERE / "build" / "mix.wav", np.stack([mix, mix], axis=1), SR)
    print(f"wrote build/music.wav and build/mix.wav ({args.duration:.1f}s)")


if __name__ == "__main__":
    main()
