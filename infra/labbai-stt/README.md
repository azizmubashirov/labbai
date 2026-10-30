# labbai-stt

RubaiSTT (`islomov/rubaistt_v2_medium`) on Modal: Uzbek speech-to-text for the
Speech-to-Text block's `rubai` provider. OpenAI and Gemini recognize Uzbek poorly, so
this model runs on its own GPU.

It is separate from VisaReady's `visaready-stt` deployment, which keeps a GPU for live
interviews. Labbai voice messages arrive far apart, so this app uses a cheaper GPU and
shuts down after 60 idle seconds.

## Deploy

The Modal CLI imports this file locally, so FastAPI must be available at deploy time. Modal
does not support Python 3.15 yet, so the command pins 3.12.

```bash
uvx --python 3.12 --with fastapi modal deploy infra/labbai-stt/modal_app.py
```

The first deploy downloads and converts the model, so it is slow. Later deploys reuse the
image layer unless `_convert_model` or the pinned versions change.

## Connect Labbai

1. Copy the `transcribe` URL from the app's page in the Modal dashboard. `modal deploy` may
   not print it.
2. In the Modal dashboard, create a **proxy auth token**. It can only call endpoints that
   require proxy auth, so it cannot deploy anything. Do not use a Modal API token here.
3. Set these on the server, in the same env file the app and its workers read:

```bash
RUBAI_STT_URL=<transcribe URL>
RUBAI_STT_TOKEN_ID=<proxy auth token ID>
RUBAI_STT_TOKEN_SECRET=<proxy auth token secret>
```

Every workspace on the deployment can then use RubaiSTT. The block has no API key field,
and runs fail with `RubaiSTT is not configured on this deployment` until all three are set.

## Test

```bash
uvx --python 3.12 --with fastapi modal run infra/labbai-stt/modal_app.py --audio-path sample.ogg
```

```bash
curl -X POST "$RUBAI_STT_URL" -H "Modal-Key: $RUBAI_STT_TOKEN_ID" -H "Modal-Secret: $RUBAI_STT_TOKEN_SECRET" -H "Content-Type: audio/ogg" --data-binary @sample.ogg
```

The response is `{"text": "...", "confidence": 0.82, "duration": 3.4, "language": "uz"}`.
`confidence` is 0 to 1, and `null` when no speech was found.

## Cost and speed

Modal bills per second while a container is up: about $0.59/hr for T4 and $1.10/hr for
A10G. One isolated message keeps a container up for about 80 seconds, which is roughly 1
to 3 cents. Back-to-back messages share that time.

The first message after an idle period waits for a cold start, about 15 seconds on T4
when measured for VisaReady. Later messages take about 1 second of decoding.

## Limits

- Audio is capped at 25 MB per request.
- At most 2 containers run at once, so a burst of messages queues.
- The checkpoint is tuned for Tashkent speech. Other dialects are expected to be weaker.
- It decodes whole files only, so it cannot stream text while someone is speaking.
