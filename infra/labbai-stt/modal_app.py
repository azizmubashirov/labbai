"""rubaiSTT v2 on Modal: Uzbek speech-to-text behind an HTTP endpoint for Labbai.

OpenAI and Gemini handle Uzbek poorly, so the Speech-to-Text block's `rubai` provider
posts audio here. `islomov/rubaistt_v2_medium` is a Whisper Medium fine-tune (Apache
2.0, ~475h Uzbek).

Labbai is TypeScript, so it cannot use the Modal Python SDK. This app exposes a POST
endpoint guarded by Modal proxy auth instead: the caller sends `Modal-Key` and
`Modal-Secret`, and that token can reach this endpoint without being able to deploy.

The model code and its decoding settings come from VisaReady's `visaready-stt`
deployment. This is a separate app so that voice messages never queue on, or redeploy,
the GPU serving live interviews.

Deploy:  uvx --python 3.12 --with fastapi modal deploy infra/labbai-stt/modal_app.py
"""

import asyncio
import math
import re
from typing import Any

import modal
from fastapi import HTTPException, Request

MODEL_REPO = "islomov/rubaistt_v2_medium"
MODEL_DIR = "/model"
COMPUTE_TYPE = "int8_float16"
LANGUAGE = "uz"
# Telegram bots download at most 20 MB, so this leaves room without inviting long files.
MAX_AUDIO_BYTES = 25 * 1024 * 1024


def _convert_model() -> None:
    """Download the HF checkpoint and convert it to CTranslate2 (image build step)."""
    import subprocess

    from transformers import WhisperTokenizerFast

    subprocess.run(
        [
            "ct2-transformers-converter",
            "--model",
            MODEL_REPO,
            "--output_dir",
            MODEL_DIR,
            "--quantization",
            COMPUTE_TYPE,
            "--copy_files",
            "preprocessor_config.json",
        ],
        check=True,
    )
    # rubaiSTT ships only the slow tokenizer files (vocab.json + merges.txt), but
    # faster-whisper loads `tokenizer.json`. Generate it from the slow files.
    WhisperTokenizerFast.from_pretrained(MODEL_REPO).save_pretrained(MODEL_DIR)


# Trailing punctuation-only "words": Whisper fills the quiet tail of a segment with them.
_TRAILING_MARKS = re.compile(r"(?:\s+[.,!?…]+)+$")


def _collapse_loops(text: str, max_n: int = 4, min_run: int = 3) -> str:
    """Keep one copy of a word n-gram repeated `min_run`+ times in a row, drop trailing marks.

    "uyga. uyga. uyga. uyga." → "uyga." is a decoder loop, not speech. Two in a row
    survives, so a speaker's "ha, ha" or "juda juda" is left alone.
    """
    words = text.split()
    out: list[str] = []
    i = 0
    while i < len(words):
        for n in range(max_n, 0, -1):
            gram = words[i : i + n]
            runs = 1
            while words[i + runs * n : i + (runs + 1) * n] == gram:
                runs += 1
            if len(gram) == n and runs >= min_run:
                out.extend(gram)
                i += runs * n
                break
        else:
            out.append(words[i])
            i += 1
    return _TRAILING_MARKS.sub("", " ".join(out))


def _confidence(avg_logprob: float | None) -> float | None:
    """Whisper's mean token log-probability → a 0..1 geometric-mean probability."""
    if avg_logprob is None:
        return None
    return min(1.0, math.exp(avg_logprob))


# CTranslate2 4.x links against CUDA 12 + cuDNN 9, so the CUDA runtime has to come from
# the base image. `debian_slim` ships none, and the libraries would then arrive only as
# torch's wheels, which break every transcribe the day pip resolves a CUDA 13 build.
CUDA_IMAGE = "nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04"

image = (
    modal.Image.from_registry(CUDA_IMAGE, add_python="3.12")
    # torch is a build-time dependency only (ct2-transformers-converter). The CPU wheel
    # keeps its CUDA libraries out of the image, leaving the base image as the source.
    .pip_install("torch~=2.5", index_url="https://download.pytorch.org/whl/cpu")
    .pip_install(
        "ctranslate2~=4.5",
        "faster-whisper~=1.1",
        # Pinned because faster-whisper's `av>=11` is open-ended: the newest PyAV dropped
        # the `metadata_errors` argument it passes, so every transcribe raises TypeError.
        "av~=16.0",
        "transformers~=4.48",
        "huggingface-hub~=0.27",
        "fastapi[standard]~=0.115",
    )
    .run_function(_convert_model)
)

app = modal.App("labbai-stt", image=image)


@app.cls(
    # T4 first: voice messages tolerate the extra ~200ms per call, and it costs about
    # half of A10G (~$0.59/hr against ~$1.10/hr). Never L4: it sat 6-13 minutes in
    # Modal's queue on 2026-10-27.
    gpu=["T4", "A10G"],
    # Billed per second while up. Messages arrive far apart, so do not idle for long.
    scaledown_window=60,
    max_containers=2,
    timeout=300,
)
class RubaiSTT:
    @modal.enter()
    def load(self) -> None:
        from faster_whisper import WhisperModel

        self.model = WhisperModel(MODEL_DIR, device="cuda", compute_type=COMPUTE_TYPE)

    def _decode(self, audio: bytes) -> dict[str, Any]:
        """Audio in any format PyAV reads (WAV, OGG/Opus, MP3) → text and confidence."""
        import io

        segments, info = self.model.transcribe(
            io.BytesIO(audio),
            language=LANGUAGE,
            beam_size=1,
            # One deterministic decode, never the temperature ladder. A decode below
            # `log_prob_threshold` would otherwise re-decode by sampling and return
            # fluent invented Uzbek for quiet or noisy audio.
            temperature=0.0,
            # No `no_repeat_ngram_size`: it counts BPE tokens, so it blocks legitimate
            # Uzbek repeats mid-word. Loops are collapsed on whole words instead.
            vad_filter=True,
            condition_on_previous_text=False,
        )
        parts = list(segments)
        avg_logprob = sum(s.avg_logprob for s in parts) / len(parts) if parts else None
        return {
            "text": _collapse_loops(" ".join(s.text.strip() for s in parts).strip()),
            "confidence": _confidence(avg_logprob),
            "duration": info.duration,
            "language": LANGUAGE,
        }

    @modal.method()
    def decode(self, audio: bytes) -> dict[str, Any]:
        """Direct call for the smoke test; production traffic uses `transcribe`."""
        return self._decode(audio)

    @modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)
    async def transcribe(self, request: Request) -> dict[str, Any]:
        """Raw audio bytes as the request body → `{text, confidence, duration, language}`."""
        import av

        audio = await request.body()
        if not audio:
            raise HTTPException(status_code=400, detail="Audio body is empty")
        if len(audio) > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="Audio exceeds the 25 MB limit")
        try:
            # The decode blocks for seconds; keep it off the server's event loop.
            return await asyncio.to_thread(self._decode, audio)
        except av.error.InvalidDataError as exc:
            raise HTTPException(status_code=400, detail="Audio could not be decoded") from exc


@app.local_entrypoint()
def main(audio_path: str) -> None:
    """Smoke test, with the same uvx flags as deploy:  modal run modal_app.py --audio-path a.ogg"""
    with open(audio_path, "rb") as fh:
        print(RubaiSTT().decode.remote(fh.read()))
