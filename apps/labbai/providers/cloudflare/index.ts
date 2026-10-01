import { createLogger } from '@labbai/logger'
import { getErrorMessage, toError } from '@labbai/utils/errors'
import { isRecordLike } from '@labbai/utils/object'
import OpenAI from 'openai'
import type { NormalizedBlockOutput, StreamingExecution } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import { formatMessagesForProvider } from '@/providers/attachments'
import {
  CLOUDFLARE_AIG_GATEWAY_ID_HEADER,
  getCloudflareAIConfig,
  getCloudflareUnifiedBaseUrl,
} from '@/providers/cloudflare/config'
import {
  isConversationContextError,
  prepareConversationGeneration,
} from '@/providers/conversation-generation'
import {
  captureProviderConversationStep,
  recordProviderConversationToolError,
  recordProviderConversationUsage,
} from '@/providers/conversation-history'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import { getChatCompletionConversationUsage } from '@/providers/openai-compat/conversation-usage'
import { readChatCompletionSse } from '@/providers/openai-compat/sse'
import { createOpenAICompatibleAgentEventStream } from '@/providers/openai-compat/stream-events'
import { createOpenAICompatStreamingToolLoopStream } from '@/providers/openai-compat/streaming-tool-loop'
import { executeProviderTool } from '@/providers/runtime-context'
import { createStreamingExecution } from '@/providers/streaming-execution'
import { isAbortError, parseToolArguments } from '@/providers/streaming-tool-loop-shared'
import { adaptOpenAIChatToolSchema } from '@/providers/tool-schema-adapter'
import { enrichLastModelSegmentFromChatCompletions } from '@/providers/trace-enrichment'
import { openAICompatTransport } from '@/providers/transport'
import type {
  ProviderConfig,
  ProviderRequest,
  ProviderResponse,
  TimeSegment,
} from '@/providers/types'
import { ProviderError } from '@/providers/types'
import {
  calculateCost,
  isFunctionToolCall,
  prepareToolExecution,
  prepareToolsWithUsageControl,
  trackForcedToolUsage,
} from '@/providers/utils'

const logger = createLogger('CloudflareProvider')

const PROVIDER_NAME = 'Cloudflare'

/**
 * OpenAI SDK client for Cloudflare's unified chat-completions endpoint
 * (`https://api.cloudflare.com/client/v4/accounts/<account>/ai/v1`). The Cloudflare API
 * token is the SDK `apiKey` (sent as `Authorization: Bearer`), and every request names the
 * AI Gateway with `cf-aig-gateway-id` so Unified Billing, logs and limits apply.
 *
 * The token comes from the server env, never from the request: `request.apiKey` only
 * carries a placeholder (see `getApiKeyWithBYOK`).
 */
export function createCloudflareClient(): OpenAI {
  const config = getCloudflareAIConfig()
  if (!config) {
    throw new Error(
      'Cloudflare AI is not configured: set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in the server environment'
    )
  }
  return new OpenAI({
    ...openAICompatTransport(),
    apiKey: config.apiToken,
    baseURL: getCloudflareUnifiedBaseUrl(config),
    defaultHeaders: { [CLOUDFLARE_AIG_GATEWAY_ID_HEADER]: config.gateway },
    // Resolved per call so a test (or runtime) fetch stub applies; init (incl. the abort signal) passes through untouched.
    fetch: (input: string | URL | Request, init?: RequestInit) => fetch(input, init),
  })
}

/**
 * Opens a streaming chat completion and reads the SSE body with the lenient reader
 * instead of the OpenAI SDK's: Cloudflare streams `anthropic/*` models as Anthropic
 * Messages events (padded `data:` lines, no `[DONE]`), which the reader translates into
 * OpenAI chunks. HTTP errors still throw from the SDK before the body is read.
 */
export async function createCloudflareChatCompletionStream(
  client: OpenAI,
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
  options?: { signal?: AbortSignal }
): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  const response = await client.chat.completions.create(params, options).asResponse()
  if (!response.body) {
    throw new Error(`${PROVIDER_NAME} returned an empty streaming response`)
  }
  return readChatCompletionSse(response.body, PROVIDER_NAME)
}

/**
 * Cloudflare provider: Anthropic, Google and Workers AI models through Cloudflare's
 * OpenAI-compatible unified endpoint (Chat Completions format), paid from Cloudflare
 * Unified Billing. Supports system prompts, multi-turn tool calling (streaming and
 * non-streaming loops), SSE streaming, JSON-schema response formats, temperature, max
 * tokens and (Gemini) reasoning effort. Only reachable in Cloudflare mode
 * (`providers/index.ts` routes here).
 */
export const cloudflareProvider: ProviderConfig = {
  id: 'cloudflare',
  name: PROVIDER_NAME,
  description: 'Anthropic, Google and Workers AI models through Cloudflare AI Gateway',
  version: '1.0.0',
  models: getProviderModels('cloudflare'),
  defaultModel: getProviderDefaultModel('cloudflare'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    const client = createCloudflareClient()

    const allMessages = []

    if (request.systemPrompt) {
      allMessages.push({
        role: 'system',
        content: request.systemPrompt,
      })
    }

    if (request.context) {
      allMessages.push({
        role: 'user',
        content: request.context,
      })
    }

    if (request.messages) {
      allMessages.push(...request.messages)
    }
    const formattedMessages = formatMessagesForProvider(allMessages, 'cloudflare')

    const tools = request.tools?.length
      ? request.tools.map((tool) => adaptOpenAIChatToolSchema(tool))
      : undefined

    const payload: any = {
      model: request.model,
      messages: formattedMessages,
    }

    if (request.temperature !== undefined) payload.temperature = request.temperature
    if (request.maxTokens != null) payload.max_tokens = request.maxTokens
    /**
     * Gemini reads OpenAI's `reasoning_effort` on chat completions (Google's OpenAI
     * compatibility). `sanitizeRequest` keeps an effort only for models that declare one, so
     * Claude and Workers AI never receive it.
     */
    if (request.reasoningEffort !== undefined && request.reasoningEffort !== 'auto') {
      payload.reasoning_effort = request.reasoningEffort
    }

    if (request.responseFormat) {
      payload.response_format = {
        type: 'json_schema',
        json_schema: {
          name: request.responseFormat.name || 'response_schema',
          schema: request.responseFormat.schema || request.responseFormat,
          strict: request.responseFormat.strict !== false,
        },
      }
    }

    let originalToolChoice: any
    let forcedTools: string[] = []

    if (tools?.length) {
      const preparedTools = prepareToolsWithUsageControl(tools, request.tools, logger, 'openai')

      if (preparedTools.tools?.length) {
        payload.tools = preparedTools.tools
        payload.tool_choice = preparedTools.toolChoice || 'auto'
        originalToolChoice = preparedTools.toolChoice
        forcedTools = preparedTools.forcedTools || []

        logger.info('Cloudflare request configuration:', {
          toolCount: preparedTools.tools.length,
          toolChoice: typeof payload.tool_choice === 'string' ? payload.tool_choice : 'forced',
          forcedToolsCount: forcedTools.length,
          hasFilteredTools: preparedTools.hasFilteredTools,
          model: request.model,
        })
      }
    }

    if (request.stream && payload.tools?.length) {
      logger.info('Using streaming tool loop for Cloudflare request')

      const providerStartTime = Date.now()
      const providerStartTimeISO = new Date(providerStartTime).toISOString()
      const timeSegments: TimeSegment[] = []

      return createStreamingExecution({
        model: request.model,
        providerStartTime,
        providerStartTimeISO,
        timing: {
          kind: 'accumulated',
          modelTime: 0,
          toolsTime: 0,
          firstResponseTime: 0,
          iterations: 1,
          timeSegments,
        },
        initialTokens: { input: 0, output: 0, total: 0 },
        initialCost: { total: 0.0, input: 0.0, output: 0.0 },
        isStreaming: true,
        streamFormat: 'agent-events-v1',
        createStream: ({ output, finalizeTiming }) =>
          createOpenAICompatStreamingToolLoopStream({
            providerName: PROVIDER_NAME,
            request,
            basePayload: payload,
            messages:
              // double-cast-allowed: formatMessagesForProvider returns loosely-typed provider messages that are wire-compatible with the OpenAI chat.completions message params the shared loop expects
              formattedMessages as unknown as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
            createStream: async (params, options) =>
              createCloudflareChatCompletionStream(
                client,
                {
                  ...params,
                  stream: true,
                  stream_options: { include_usage: true },
                },
                options
              ),
            logger,
            timeSegments,
            forcedTools,
            onComplete: (result) => {
              output.content = result.content
              output.tokens = result.tokens
              output.cost = result.cost
              output.toolCalls = result.toolCalls as NormalizedBlockOutput['toolCalls']
              if (output.providerTiming) {
                output.providerTiming.modelTime = result.modelTime
                output.providerTiming.toolsTime = result.toolsTime
                output.providerTiming.firstResponseTime = result.firstResponseTime
                output.providerTiming.iterations = result.iterations
              }
              finalizeTiming()
            },
          }),
      })
    }

    if (request.stream && !payload.tools?.length) {
      logger.info('Using streaming response for Cloudflare request (no tools)')

      const providerStartTime = Date.now()
      const providerStartTimeISO = new Date(providerStartTime).toISOString()

      const streamResponse = await createCloudflareChatCompletionStream(
        client,
        await prepareConversationGeneration(request, 'chat-completions', {
          ...payload,
          stream: true,
          stream_options: { include_usage: true },
        }),
        request.abortSignal ? { signal: request.abortSignal } : undefined
      )

      return createStreamingExecution({
        model: request.model,
        providerStartTime,
        providerStartTimeISO,
        timing: { kind: 'simple', segmentName: request.model },
        initialTokens: { input: 0, output: 0, total: 0 },
        initialCost: { input: 0, output: 0, total: 0 },
        isStreaming: true,
        streamFormat: 'agent-events-v1',
        createStream: ({ output, finalizeTiming }) =>
          createOpenAICompatibleAgentEventStream(streamResponse, {
            request,
            providerName: PROVIDER_NAME,
            onComplete: (result) => {
              output.content = result.content
              output.tokens = {
                input: result.usage.prompt_tokens,
                output: result.usage.completion_tokens,
                total: result.usage.total_tokens,
              }

              const costResult = calculateCost(
                request.model,
                result.usage.prompt_tokens,
                result.usage.completion_tokens
              )
              output.cost = {
                input: costResult.input,
                output: costResult.output,
                total: costResult.total,
              }

              if (result.thinking) {
                const segment = output.providerTiming?.timeSegments?.[0]
                if (segment) {
                  segment.thinkingContent = result.thinking
                }
              }
              finalizeTiming()
            },
          }),
      })
    }

    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      const initialCallTime = Date.now()

      let currentResponse = await client.chat.completions.create(
        await prepareConversationGeneration(request, 'chat-completions', payload),
        request.abortSignal ? { signal: request.abortSignal } : undefined
      )
      if (!currentResponse.choices[0]?.message?.tool_calls?.length) {
        await captureProviderConversationStep(
          request,
          'chat-completions',
          currentResponse.choices[0]?.message,
          getChatCompletionConversationUsage(currentResponse.usage)
        )
      }
      const firstResponseTime = Date.now() - initialCallTime

      let content = currentResponse.choices[0]?.message?.content || ''
      const tokens = {
        input: currentResponse.usage?.prompt_tokens || 0,
        output: currentResponse.usage?.completion_tokens || 0,
        total: currentResponse.usage?.total_tokens || 0,
      }
      const toolCalls = []
      const toolResults: Record<string, unknown>[] = []
      const currentMessages = [...formattedMessages]
      let iterationCount = 0
      let modelTime = firstResponseTime
      let toolsTime = 0
      let usedForcedTools: string[] = []

      const timeSegments: TimeSegment[] = [
        {
          type: 'model',
          name: request.model,
          startTime: initialCallTime,
          endTime: initialCallTime + firstResponseTime,
          duration: firstResponseTime,
        },
      ]

      while (iterationCount < MAX_TOOL_ITERATIONS) {
        if (currentResponse.choices[0]?.message?.content) {
          content = currentResponse.choices[0].message.content
        }

        const toolCallsInResponse =
          currentResponse.choices[0]?.message?.tool_calls?.filter(isFunctionToolCall)

        enrichLastModelSegmentFromChatCompletions(
          timeSegments,
          currentResponse,
          toolCallsInResponse,
          { model: request.model, provider: 'cloudflare' }
        )

        if (!toolCallsInResponse || toolCallsInResponse.length === 0) {
          break
        }

        const toolsStartTime = Date.now()

        await captureProviderConversationStep(
          request,
          'chat-completions',
          currentResponse.choices[0]?.message,
          getChatCompletionConversationUsage(currentResponse.usage)
        )

        const executionResults = await Promise.all(
          toolCallsInResponse.map(async (toolCall) => {
            const toolCallStartTime = Date.now()
            const toolName = toolCall.function.name

            try {
              const toolArgs = parseToolArguments(toolCall.function.arguments, toolName)
              const tool = request.tools?.find((t) => t.id === toolName)

              if (!tool) {
                await recordProviderConversationToolError(
                  request,
                  toolCall.id,
                  toolName,
                  `Tool "${toolName}" is not available`
                )
                const toolCallEndTime = Date.now()
                return {
                  toolCall,
                  toolName,
                  toolParams: {},
                  result: {
                    success: false,
                    output: undefined,
                    error: `Tool "${toolName}" is not available`,
                  },
                  startTime: toolCallStartTime,
                  endTime: toolCallEndTime,
                  duration: toolCallEndTime - toolCallStartTime,
                }
              }

              const { toolParams, executionParams } = prepareToolExecution(
                tool,
                toolArgs,
                request,
                toolCall.id
              )
              const { rawResponse, modelResponse } = await executeProviderTool(
                toolName,
                executionParams,
                { signal: request.abortSignal }
              )
              const toolCallEndTime = Date.now()

              return {
                toolCall,
                toolName,
                toolParams,
                result: rawResponse,
                modelResult: modelResponse,
                startTime: toolCallStartTime,
                endTime: toolCallEndTime,
                duration: toolCallEndTime - toolCallStartTime,
              }
            } catch (error) {
              if (isAbortError(error) || request.abortSignal?.aborted) {
                throw error
              }
              await recordProviderConversationToolError(
                request,
                toolCall.id,
                toolName,
                getErrorMessage(error, 'Tool execution failed')
              )
              const toolCallEndTime = Date.now()
              logger.error('Error processing tool call:', { error, toolName })

              return {
                toolCall,
                toolName,
                toolParams: {},
                result: {
                  success: false,
                  output: undefined,
                  error: getErrorMessage(error, 'Tool execution failed'),
                },
                startTime: toolCallStartTime,
                endTime: toolCallEndTime,
                duration: toolCallEndTime - toolCallStartTime,
              }
            }
          })
        )

        currentMessages.push({
          role: 'assistant',
          content: currentResponse.choices[0]?.message?.content ?? '',
          tool_calls: toolCallsInResponse.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          })),
        })

        for (const executionResult of executionResults) {
          const { toolCall, toolName, toolParams, result, startTime, endTime, duration } =
            executionResult
          const modelResult =
            'modelResult' in executionResult ? (executionResult.modelResult ?? result) : result

          timeSegments.push({
            type: 'tool',
            name: toolName,
            startTime,
            endTime,
            duration,
            toolCallId: toolCall.id,
          })

          let resultContent: unknown
          if (result.success) {
            if (isRecordLike(result.output)) {
              toolResults.push(result.output)
            }
            resultContent = result.output ?? null
          } else {
            resultContent = {
              error: true,
              message: result.error || 'Tool execution failed',
              tool: toolName,
            }
          }
          const modelResultContent = modelResult.success
            ? (modelResult.output ?? null)
            : {
                error: true,
                message: modelResult.error || 'Tool execution failed',
                tool: toolName,
              }

          toolCalls.push({
            name: toolName,
            arguments: toolParams,
            startTime: new Date(startTime).toISOString(),
            endTime: new Date(endTime).toISOString(),
            duration,
            result: resultContent,
            success: result.success,
          })

          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(modelResultContent),
          })
        }

        toolsTime += Date.now() - toolsStartTime

        if (typeof originalToolChoice === 'object' && forcedTools.length > 0) {
          const toolTracking = trackForcedToolUsage(
            toolCallsInResponse,
            originalToolChoice,
            logger,
            'openai',
            forcedTools,
            usedForcedTools
          )
          usedForcedTools = toolTracking.usedForcedTools
          const nextToolChoice = toolTracking.nextToolChoice

          if (nextToolChoice && typeof nextToolChoice === 'object') {
            payload.tool_choice = nextToolChoice
          } else {
            payload.tool_choice = 'auto'
          }
        }

        const nextModelStartTime = Date.now()
        currentResponse = await client.chat.completions.create(
          await prepareConversationGeneration(request, 'chat-completions', {
            ...payload,
            messages: currentMessages,
          }),
          request.abortSignal ? { signal: request.abortSignal } : undefined
        )
        if (!currentResponse.choices[0]?.message?.tool_calls?.length) {
          await captureProviderConversationStep(
            request,
            'chat-completions',
            currentResponse.choices[0]?.message,
            getChatCompletionConversationUsage(currentResponse.usage)
          )
        }

        const nextModelEndTime = Date.now()
        const thisModelTime = nextModelEndTime - nextModelStartTime

        timeSegments.push({
          type: 'model',
          name: request.model,
          startTime: nextModelStartTime,
          endTime: nextModelEndTime,
          duration: thisModelTime,
        })

        modelTime += thisModelTime

        if (currentResponse.choices[0]?.message?.content) {
          content = currentResponse.choices[0].message.content
        }

        if (currentResponse.usage) {
          tokens.input += currentResponse.usage.prompt_tokens || 0
          tokens.output += currentResponse.usage.completion_tokens || 0
          tokens.total += currentResponse.usage.total_tokens || 0
        }

        iterationCount++
      }

      if (iterationCount === MAX_TOOL_ITERATIONS) {
        if (currentResponse.choices[0]?.message?.tool_calls?.length) {
          await recordProviderConversationUsage(
            request,
            getChatCompletionConversationUsage(currentResponse.usage)
          )
        }
        enrichLastModelSegmentFromChatCompletions(
          timeSegments,
          currentResponse,
          currentResponse.choices[0]?.message?.tool_calls?.filter(isFunctionToolCall),
          { model: request.model, provider: 'cloudflare' }
        )
      }

      const providerEndTime = Date.now()

      return {
        content,
        model: request.model,
        tokens,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        toolResults: toolResults.length > 0 ? toolResults : undefined,
        timing: {
          startTime: providerStartTimeISO,
          endTime: new Date(providerEndTime).toISOString(),
          duration: providerEndTime - providerStartTime,
          modelTime,
          toolsTime,
          firstResponseTime,
          iterations: iterationCount + 1,
          timeSegments,
        },
      }
    } catch (error) {
      const providerEndTime = Date.now()
      const totalDuration = providerEndTime - providerStartTime

      logger.error('Error in Cloudflare request:', {
        error: toError(error).message,
        duration: totalDuration,
        model: request.model,
      })

      if (
        isAbortError(error) ||
        request.abortSignal?.aborted ||
        isConversationContextError(error)
      ) {
        throw error
      }
      throw new ProviderError(
        toError(error).message,
        {
          startTime: providerStartTimeISO,
          endTime: new Date(providerEndTime).toISOString(),
          duration: totalDuration,
        },
        { cause: error }
      )
    }
  },
}
