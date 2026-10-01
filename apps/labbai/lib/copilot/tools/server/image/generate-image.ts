import { createLogger } from '@labbai/logger'
import { getErrorMessage, toError } from '@labbai/utils/errors'
import {
  executeCopilotFileUseCase,
  resolveCopilotWorkspaceFileReference,
} from '@/lib/copilot/application/execute-file-use-case'
import { GenerateImage } from '@/lib/copilot/generated/tool-catalog-v1'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import {
  assertOpaqueWorkspaceFileModelSafe,
  ServerToolModelInputError,
} from '@/lib/copilot/tools/server/model-input'
import { writeCopilotWorkspaceFileByPath } from '@/lib/copilot/vfs/resource-writer'
import { env } from '@/lib/core/config/env'
import { MAX_MEDIA_BYTES } from '@/lib/media/falai'
import { createWorkspaceFileSecretProvenanceFromRegistry } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { readWorkspaceFileContent } from '@/lib/workspace-files/application/read-workspace-file-content'
import {
  getOpenAIAuthHeaders,
  getOpenAIBaseUrl,
  isOpenAIGatewayMode,
  OPENAI_GATEWAY_API_KEY,
} from '@/providers/openai/client-config'

const logger = createLogger('GenerateImageTool')

/**
 * Labbai: copilot image generation runs on OpenAI's image model with the
 * platform `OPENAI_API_KEY` (previously Gemini "Nano Banana"), or on the
 * Cloudflare AI Gateway (`CLOUDFLARE_AIG_TOKEN`). With neither configured the
 * tool is disabled.
 */
const OPENAI_IMAGE_MODEL = 'gpt-image-1'

/** gpt-image-1 list prices, USD per 1M tokens. */
const IMAGE_PRICING = { textInput: 5, imageInput: 10, imageOutput: 40 } as const
/** Charged when the response carries no usage block (medium quality, landscape). */
const FALLBACK_IMAGE_COST_USD = 0.063

type OpenAIImageSize = '1024x1024' | '1536x1024' | '1024x1536'

const ASPECT_RATIO_TO_SIZE: Record<string, OpenAIImageSize> = {
  '1:1': '1024x1024',
  '16:9': '1536x1024',
  '4:3': '1536x1024',
  '9:16': '1024x1536',
  '3:4': '1024x1536',
}

function getOpenAIImageApiKey(): string | null {
  if (isOpenAIGatewayMode()) return OPENAI_GATEWAY_API_KEY
  return env.OPENAI_API_KEY?.trim() || null
}

interface ReferenceImage {
  buffer: Buffer
  name: string
  mimeType: string
}

interface OpenAIImageResponse {
  data?: Array<{ b64_json?: string }>
  usage?: ImageUsage
  error?: { message?: string }
}

/**
 * Calls OpenAI `/images/generations`, or `/images/edits` (multipart) when
 * reference images are supplied, at `OPENAI_BASE_URL`.
 */
async function requestOpenAIImage(
  apiKey: string,
  prompt: string,
  size: OpenAIImageSize,
  references: ReferenceImage[],
  signal?: AbortSignal
): Promise<OpenAIImageResponse> {
  const headers: Record<string, string> = getOpenAIAuthHeaders(apiKey)
  let response: Response
  if (references.length > 0) {
    const form = new FormData()
    form.append('model', OPENAI_IMAGE_MODEL)
    form.append('prompt', prompt)
    form.append('size', size)
    form.append('n', '1')
    for (const reference of references) {
      form.append(
        'image[]',
        new Blob([new Uint8Array(reference.buffer)], { type: reference.mimeType }),
        reference.name
      )
    }
    response = await fetch(`${getOpenAIBaseUrl()}/images/edits`, {
      method: 'POST',
      headers,
      body: form,
      signal,
    })
  } else {
    response = await fetch(`${getOpenAIBaseUrl()}/images/generations`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OPENAI_IMAGE_MODEL, prompt, size, n: 1 }),
      signal,
    })
  }
  const body = (await response.json().catch(() => ({}))) as OpenAIImageResponse
  if (!response.ok) {
    throw new Error(body.error?.message || `OpenAI image request failed (${response.status})`)
  }
  return body
}

interface ImageUsage {
  input_tokens?: number
  output_tokens?: number
  input_tokens_details?: { text_tokens?: number; image_tokens?: number }
}

function imageCostFromUsage(usage: ImageUsage | undefined): number {
  if (!usage || typeof usage.output_tokens !== 'number') return FALLBACK_IMAGE_COST_USD
  const imageInput = usage.input_tokens_details?.image_tokens ?? 0
  const textInput =
    usage.input_tokens_details?.text_tokens ?? Math.max(0, (usage.input_tokens ?? 0) - imageInput)
  return (
    (textInput * IMAGE_PRICING.textInput +
      imageInput * IMAGE_PRICING.imageInput +
      usage.output_tokens * IMAGE_PRICING.imageOutput) /
    1_000_000
  )
}

interface GenerateImageArgs {
  prompt: string
  inputs?: { files?: Array<{ path: string }> }
  aspectRatio?: string
  outputs?: {
    files?: Array<{
      path: string
      mode?: 'create' | 'overwrite'
      mimeType?: string
    }>
  }
}

interface GenerateImageResult {
  success: boolean
  message: string
  fileId?: string
  fileName?: string
  vfsPath?: string
  downloadUrl?: string
  _serviceCost?: { service: string; cost: number }
}

export const generateImageServerTool: BaseServerTool<GenerateImageArgs, GenerateImageResult> = {
  name: GenerateImage.id,

  async execute(
    params: GenerateImageArgs,
    context?: ServerToolContext
  ): Promise<GenerateImageResult> {
    if (!context?.userId) {
      throw new Error('Authentication required')
    }
    const workspaceId = context.workspaceId
    if (!workspaceId) {
      return { success: false, message: 'Workspace ID is required' }
    }

    if (!params.prompt) {
      return { success: false, message: 'prompt is required' }
    }

    const apiKey = getOpenAIImageApiKey()
    if (!apiKey) {
      return {
        success: false,
        message: 'Image generation is not available: no OpenAI API key is configured.',
      }
    }

    try {
      const prompt = params.prompt

      const aspectRatio = params.aspectRatio || '1:1'
      const size = ASPECT_RATIO_TO_SIZE[aspectRatio] ?? '1024x1024'

      const referenceImages: ReferenceImage[] = []

      const referencePaths = params.inputs?.files?.map((file) => file.path) ?? []

      if (referencePaths.length) {
        for (const filePath of referencePaths) {
          try {
            const fileRecord = await resolveCopilotWorkspaceFileReference(
              context,
              fileOperations.readContent,
              {
                workspaceId,
                reference: filePath,
              }
            )
            await assertOpaqueWorkspaceFileModelSafe({ workspaceId, file: fileRecord })
            const { content: buffer } = await executeCopilotFileUseCase(
              context,
              readWorkspaceFileContent,
              {
                fileId: fileRecord.id,
                assertedWorkspaceId: workspaceId,
                maxBytes: MAX_MEDIA_BYTES,
              },
              { fileId: fileRecord.id }
            )
            const mime = fileRecord.type || 'image/png'
            referenceImages.push({
              buffer,
              name: fileRecord.name || 'reference.png',
              mimeType: mime,
            })
            logger.info('Loaded reference image', {
              filePath,
              name: fileRecord.name,
              size: buffer.length,
              mimeType: mime,
            })
          } catch (err) {
            if (err instanceof ServerToolModelInputError) throw err
            logger.warn('Failed to load reference image, skipping', {
              filePath,
              error: toError(err).message,
            })
          }
        }
      }

      logger.info('Generating image with OpenAI', {
        model: OPENAI_IMAGE_MODEL,
        aspectRatio,
        size,
        promptLength: prompt.length,
        referenceImageCount: referenceImages.length,
      })

      const response = await requestOpenAIImage(
        apiKey,
        prompt,
        size,
        referenceImages,
        context.abortSignal
      )

      const imageBase64 = response.data?.[0]?.b64_json ?? undefined
      const mimeType = 'image/png'

      if (!imageBase64) {
        return {
          success: false,
          message: 'Image generation returned no image data.',
        }
      }

      const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? '.jpg' : '.png'
      const outputFile = params.outputs?.files?.[0]
      const outputPath = outputFile?.path || `files/generated-image${ext}`
      const imageBuffer = Buffer.from(imageBase64, 'base64')
      const mode = outputFile?.mode ?? 'create'

      assertServerToolNotAborted(context)
      // Reference images were asserted opaque-egress-safe above, so the prompt
      // is the only secret-bearing input this file can inherit. Recording its
      // provenance is what keeps the written file readable by the model later:
      // a write without a sidecar stamps the file "unknown" and every
      // content-view read of it is refused.
      const promptProvenance = await createWorkspaceFileSecretProvenanceFromRegistry(
        context.resolvedSecretTraceRegistry,
        prompt,
        { userId: context.userId, workspaceId }
      )
      const written = await writeCopilotWorkspaceFileByPath(context, {
        workspaceId,
        target: {
          path: outputPath,
          mode,
          mimeType: outputFile?.mimeType,
        },
        buffer: imageBuffer,
        inferredMimeType: mimeType,
        secretProvenance: promptProvenance.safe
          ? promptProvenance.provenance
          : { status: 'unknown' },
      })

      logger.info('Generated image saved', {
        fileId: written.id,
        fileName: written.name,
        vfsPath: written.vfsPath,
        size: imageBuffer.length,
        mimeType,
      })

      return {
        success: true,
        message: `Image ${referenceImages.length ? 'edited' : 'generated'} and ${written.mode === 'overwrite' ? 'updated' : 'saved'} at "${written.vfsPath}" (${imageBuffer.length} bytes)`,
        fileId: written.id,
        fileName: written.name,
        vfsPath: written.vfsPath,
        downloadUrl: written.downloadUrl,
        _serviceCost: {
          service: OPENAI_IMAGE_MODEL,
          cost: imageCostFromUsage(response.usage),
        },
      }
    } catch (error) {
      const msg = getErrorMessage(error, 'Unknown error')
      logger.error('Image generation failed', { error: msg })
      return { success: false, message: `Failed to generate image: ${msg}` }
    }
  },
}
