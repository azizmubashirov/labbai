"""Synthesizes the narration lines in narration.json with Kokoro TTS.

Usage: python3 voice.py --model kokoro.onnx --voices voices.bin [--voice af_heart] [--speed 1.1]
Model files: https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0
Writes build/line-<n>.wav (24 kHz mono) and prints each line's duration.
"""

import argparse
import json
from pathlib import Path

import soundfile as sf
from kokoro_onnx import Kokoro
from kokoro_onnx.tokenizer import Tokenizer

HERE = Path(__file__).parent
# "Labbai" is stressed on the last syllable (lab-BAI), which espeak gets wrong by default.
BRAND_PHONEMES = "læbˈaɪ"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--voices", required=True)
    parser.add_argument("--voice", default="af_heart")
    parser.add_argument("--speed", type=float, default=1.1)
    args = parser.parse_args()

    kokoro = Kokoro(args.model, args.voices)
    tokenizer = Tokenizer()
    out = HERE / "build"
    out.mkdir(exist_ok=True)

    for i, line in enumerate(json.loads((HERE / "narration.json").read_text()), 1):
        marker = "Zorblat"
        phonemes = tokenizer.phonemize(line["text"].replace("[Labbai]", marker), "en-us")
        marker_phonemes = tokenizer.phonemize(marker, "en-us").strip(" .")
        phonemes = phonemes.replace(marker_phonemes, BRAND_PHONEMES)
        samples, rate = kokoro.create(phonemes, voice=args.voice, speed=args.speed, is_phonemes=True)
        sf.write(out / f"line-{i}.wav", samples, rate)
        print(f"line {i}: at {line['at']:.1f}s, {len(samples) / rate:.2f}s")


if __name__ == "__main__":
    main()
