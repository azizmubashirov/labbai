/**
 * Anthropic Messages SSE bodies as Cloudflare's unified chat-completions endpoint streams
 * them for `anthropic/*` models (captured live): JSON padded with trailing spaces, a stray
 * closing brace after `message_start`, `event:` lines only on some streams and no
 * `data: [DONE]`.
 */

/** Plain text answer "OK" with `event:` lines (usage: 12 in / 4 out). */
export const cloudflareAnthropicTextSse = String.raw`event: message_start
data: {"type":"message_start","message":{"model":"claude-opus-4-6","id":"msg_01","type":"message","role":"assistant","content":[],"stop_reason":null,"usage":{"input_tokens":12,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":4}}}            }

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}  }

event: ping
data: {"type": "ping"}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"OK"}               }

event: content_block_stop
data: {"type":"content_block_stop","index":0            }

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"input_tokens":12,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":4}   }

event: message_stop
data: {"type":"message_stop"             }

`

/**
 * Text then a `get_weather` tool call whose JSON arguments arrive split across deltas,
 * `data:` lines only (usage: 20 in + 100 cache read + 30 cache write, 15 out).
 */
export const cloudflareAnthropicToolUseSse = String.raw`data: {"type":"message_start","message":{"model":"claude-opus-4-6","id":"msg_02","type":"message","role":"assistant","content":[],"stop_reason":null,"usage":{"input_tokens":20,"cache_creation_input_tokens":30,"cache_read_input_tokens":100,"output_tokens":1}}}
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Checking."}}
data: {"type":"content_block_stop","index":0}
data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_01","name":"get_weather","input":{},"caller":{"type":"direct"}}          }
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":""}          }
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"city\""}           }
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":": \"Tash"} }
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"kent\"}"}}
data: {"type":"content_block_stop","index":1}
data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"input_tokens":20,"cache_creation_input_tokens":30,"cache_read_input_tokens":100,"output_tokens":15}}
data: {"type":"message_stop"}
`

/** A thinking block (with signature) before the answer "OK", `data:` lines only. */
export const cloudflareAnthropicThinkingSse = String.raw`data: {"type":"message_start","message":{"model":"claude-opus-4-6","id":"msg_03","usage":{"input_tokens":8,"output_tokens":1}}}
data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"The user wants OK."}}
data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"c2lnbmF0dXJl"}}
data: {"type":"content_block_stop","index":0}
data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}
data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"OK"}}
data: {"type":"content_block_stop","index":1}
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":9}}
data: {"type":"message_stop"}
`

/** The stream fails mid-message with an in-band `error` event. */
export const cloudflareAnthropicErrorSse = String.raw`event: message_start
data: {"type":"message_start","message":{"model":"claude-opus-4-6","id":"msg_04","usage":{"input_tokens":5,"output_tokens":1}}}

event: error
data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}

`

/** An SSE `Response` carrying `body` as-is. */
export function sseResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}
