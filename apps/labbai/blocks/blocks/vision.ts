import { EyeIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { createVersionedToolSelector, normalizeFileInput } from '@/blocks/utils'
import {
  OPENAI_DEFAULT_MODEL,
  OPENAI_MODEL_GPT_4_1,
  OPENAI_MODEL_GPT_4_1_MINI,
  OPENAI_MODEL_GPT_5_5,
  OPENAI_MODEL_GPT_5_MINI,
} from '@/providers/openai/model-ids'
import type { VisionResponse } from '@/tools/vision/types'

/** Labbai: vision runs on OpenAI only; every curated id accepts image input. */
const VISION_MODEL_OPTIONS = [
  { label: 'GPT 5 Mini', id: OPENAI_MODEL_GPT_5_MINI },
  { label: 'GPT 5.5', id: OPENAI_MODEL_GPT_5_5 },
  { label: 'GPT 4.1', id: OPENAI_MODEL_GPT_4_1 },
  { label: 'GPT 4.1 Mini', id: OPENAI_MODEL_GPT_4_1_MINI },
]

const IMAGE_FIELD = ['imageFile', 'imageFileReference', 'imageUrl'] as const
/* v2 drops the URL input, keeping only the upload/reference pair. */
const IMAGE_V2_FIELD = ['imageFile', 'imageFileReference'] as const

export const VisionBlock: BlockConfig<VisionResponse> = {
  type: 'vision',
  name: 'Vision (Legacy)',
  description: 'Analyze images with vision models',
  hideFromToolbar: true,
  authMode: AuthMode.ApiKey,
  longDescription: 'Integrate Vision into the workflow. Can analyze images with vision models.',
  category: 'blocks',
  integrationType: IntegrationType.AI,
  bgColor: '#4D5FFF',
  icon: EyeIcon,
  canvasPresentation: {
    defaultTitle: 'Vision',
    sentences: {
      default: [
        { text: 'Analyze', field: IMAGE_FIELD, core: true },
        { text: ', asking', field: 'prompt' },
      ],
    },
  },
  subBlocks: [
    // Image file upload (basic mode)
    {
      id: 'imageFile',
      title: 'Image File',
      type: 'file-upload',
      canonicalParamId: 'imageFile',
      placeholder: 'Upload an image file',
      mode: 'basic',
      multiple: false,
      required: false,
      acceptedTypes: '.jpg,.jpeg,.png,.gif,.webp',
    },
    // Image file reference (advanced mode)
    {
      id: 'imageFileReference',
      title: 'Image File Reference',
      type: 'short-input',
      canonicalParamId: 'imageFile',
      placeholder: 'Reference an image from previous blocks',
      mode: 'advanced',
      required: false,
    },
    {
      id: 'imageUrl',
      title: 'Image URL (alternative)',
      type: 'short-input',
      placeholder: 'Or enter publicly accessible image URL',
      required: false,
    },
    {
      id: 'model',
      title: 'Vision Model',
      type: 'dropdown',
      options: VISION_MODEL_OPTIONS,
      value: () => OPENAI_DEFAULT_MODEL,
    },
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      placeholder: 'Enter prompt for image analysis',
      required: true,
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your OpenAI API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: ['vision_tool'],
  },
  inputs: {
    apiKey: { type: 'string', description: 'OpenAI API key' },
    imageUrl: { type: 'string', description: 'Image URL' },
    imageFile: { type: 'json', description: 'Image file (UserFile)' },
    model: { type: 'string', description: 'Vision model' },
    prompt: { type: 'string', description: 'Analysis prompt' },
  },
  outputs: {
    content: { type: 'string', description: 'Analysis result' },
    model: { type: 'string', description: 'Model used' },
    tokens: { type: 'number', description: 'Token usage' },
  },
}

export const VisionV2Block: BlockConfig<VisionResponse> = {
  ...VisionBlock,
  type: 'vision_v2',
  name: 'Vision',
  description: 'Analyze images with vision models',
  hideFromToolbar: true,
  canvasPresentation: {
    defaultTitle: 'Vision',
    sentences: {
      default: [
        { text: 'Analyze', field: IMAGE_V2_FIELD, core: true },
        { text: ', asking', field: 'prompt' },
      ],
    },
  },
  tools: {
    access: ['vision_tool_v2'],
    config: {
      tool: createVersionedToolSelector({
        baseToolSelector: () => 'vision_tool',
        suffix: '_v2',
        fallbackToolId: 'vision_tool_v2',
      }),
      params: (params) => {
        // imageFile is the canonical param for both basic and advanced modes
        const imageFile = normalizeFileInput(params.imageFile, {
          single: true,
        })
        return {
          ...params,
          imageFile,
        }
      },
    },
  },
  subBlocks: [
    {
      id: 'imageFile',
      title: 'Image File',
      type: 'file-upload',
      canonicalParamId: 'imageFile',
      placeholder: 'Upload an image file',
      mode: 'basic',
      multiple: false,
      required: true,
      acceptedTypes: '.jpg,.jpeg,.png,.gif,.webp',
    },
    {
      id: 'imageFileReference',
      title: 'Image File Reference',
      type: 'short-input',
      canonicalParamId: 'imageFile',
      placeholder: 'Reference an image from previous blocks',
      mode: 'advanced',
      required: true,
    },
    {
      id: 'model',
      title: 'Vision Model',
      type: 'dropdown',
      options: VISION_MODEL_OPTIONS,
      value: () => OPENAI_DEFAULT_MODEL,
    },
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      placeholder: 'Enter prompt for image analysis',
      required: true,
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your OpenAI API key',
      password: true,
      required: true,
    },
  ],
  inputs: {
    apiKey: { type: 'string', description: 'OpenAI API key' },
    imageFile: { type: 'json', description: 'Image file (UserFile)' },
    model: { type: 'string', description: 'Vision model' },
    prompt: { type: 'string', description: 'Analysis prompt' },
  },
}
