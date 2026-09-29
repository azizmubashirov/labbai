/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url":"https://www.labbai.example.com"}
 *
 * A document that never ran the root layout: no `window.__ENV`, no
 * `data-public-env` attribute, so every `NEXT_PUBLIC_*` read is unset and the env
 * fallback resolves to self-hosted. That is the state a tab keeps after recovering
 * in place from Next's bare 404 shell or `global-error`.
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
  vi.stubEnv('NEXT_PUBLIC_FORCE_HOSTED', '')
  document.documentElement.id = '__next_error__'
})

vi.unmock('@/lib/core/config/env')
vi.unmock('@/lib/core/config/env-flags')
vi.mock('@/lib/oauth/utils', () => ({ getScopesForService: () => [] }))
vi.mock('@/providers/utils', () => ({ getProviderFromModel: () => 'openai' }))

import type { DeploymentShape } from '@/lib/api/contracts/workspaces'
import {
  getDeploymentShape,
  resetDeploymentShape,
  resolveDeploymentShape,
  seedDeploymentShape,
  useDeploymentShape,
} from '@/lib/core/config/deployment-shape'
import { PUBLIC_ENV_ATTRIBUTE } from '@/lib/core/config/env'
import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import { getApiKeyCondition } from '@/blocks/utils'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Every model runs on the server's OpenAI key, so no deployment shows an API key field. */
const MODELS = ['gpt-5.5', 'gpt-5-mini', 'custom/model']

const HOSTED: DeploymentShape = {
  ...resolveDeploymentShape(),
  hosted: true,
  azureConfigured: true,
}

function apiKeyFieldShown(model: string): boolean {
  return evaluateSubBlockCondition(getApiKeyCondition(), { model })
}

function HookReader() {
  const { hosted, azureConfigured } = useDeploymentShape()
  return <output data-testid='hook'>{`${hosted}/${azureConfigured}`}</output>
}

let host: HTMLDivElement
let root: Root

function render(ui: ReactNode) {
  act(() => root.render(ui))
}

function textOf(testId: string): string | undefined {
  return host.querySelector(`[data-testid="${testId}"]`)?.textContent ?? undefined
}

beforeEach(() => {
  resetDeploymentShape()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.documentElement.removeAttribute(PUBLIC_ENV_ATTRIBUTE)
  Reflect.deleteProperty(window, '__ENV')
})

describe('env fallback on a document without the root layout', () => {
  it('resolves as self-hosted and keeps API key fields hidden', () => {
    expect(window.__ENV).toBeUndefined()
    expect(document.documentElement.getAttribute(PUBLIC_ENV_ATTRIBUTE)).toBeNull()
    expect(resolveDeploymentShape().hosted).toBe(false)
    expect(getDeploymentShape().hosted).toBe(false)

    for (const model of MODELS) {
      expect(apiKeyFieldShown(model)).toBe(false)
    }
  })
})

describe('seeded server shape', () => {
  it('wins over the env fallback for readers outside React', () => {
    seedDeploymentShape(HOSTED)

    expect(getDeploymentShape()).toBe(HOSTED)
    for (const model of MODELS) {
      expect(apiKeyFieldShown(model)).toBe(false)
    }
  })

  it('keeps the seeded object when an equal shape is seeded again', () => {
    seedDeploymentShape(HOSTED)
    seedDeploymentShape({ ...HOSTED, features: { ...HOSTED.features } })

    expect(getDeploymentShape()).toBe(HOSTED)
  })

  it('is ignored when the server predates deployment projection', () => {
    seedDeploymentShape(undefined)

    expect(getDeploymentShape().hosted).toBe(false)
  })

  it('returns to the env fallback after a reset', () => {
    seedDeploymentShape(HOSTED)
    resetDeploymentShape()

    expect(getDeploymentShape().hosted).toBe(false)
  })
})

describe('useDeploymentShape', () => {
  it('follows the seeded shape and falls back to the env fallback otherwise', () => {
    render(<HookReader />)
    expect(textOf('hook')).toBe('false/false')

    act(() => seedDeploymentShape(HOSTED))

    expect(textOf('hook')).toBe('true/true')
  })
})
