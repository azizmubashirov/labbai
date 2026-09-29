import { isRecordLike } from '@labbai/utils/object'
import type { OutputProperty } from '@/tools/types'

/**
 * Answer shapes of the legacy JEV evaluation models. Labbai removed the TypeSafe
 * provider that served them; the shapes are kept here so workflows that still
 * reference an evaluation model's answers keep a typed output schema.
 */
interface JevChoiceAnswer {
  type: 'choice'
  choice: string
  probabilities: Record<string, number>
  confidence: number
}

interface JevScoreAnswer {
  type: 'score'
  score: number
  legend: Record<string, unknown>
  probabilities: Record<string, number>
  confidence: number
}

interface JevNoulAnswer {
  type: 'noul'
  noul: number
}

type JevAnswer = JevChoiceAnswer | JevScoreAnswer | JevNoulAnswer

const ANSWER_FIELDS = {
  choice: {
    choice: { type: 'string' },
    confidence: { type: 'number' },
    probabilities: { type: 'json' },
    type: { type: 'string' },
  },
  score: {
    score: { type: 'number' },
    confidence: { type: 'number' },
    probabilities: { type: 'json' },
    legend: { type: 'json' },
    type: { type: 'string' },
  },
  noul: {
    noul: { type: 'number' },
    type: { type: 'string' },
  },
} satisfies {
  [Type in JevAnswer['type']]: Record<keyof Extract<JevAnswer, { type: Type }>, OutputProperty>
}

/**
 * Describes answers known from the editor's questions without requiring resolved inputs.
 * Keys containing reference syntax remain accessible through the whole answers object.
 */
export function getJevAnswerOutput(
  questions: unknown
): (OutputProperty & { type: 'json' }) | undefined {
  if (typeof questions === 'string') {
    try {
      questions = JSON.parse(questions)
    } catch {
      return undefined
    }
  }
  if (!isRecordLike(questions)) return undefined

  const entries: Array<[string, OutputProperty]> = []
  for (const [id, question] of Object.entries(questions)) {
    if (!/^[\w-]+$/.test(id) || !isRecordLike(question)) continue
    const { type } = question
    if (type !== 'choice' && type !== 'score' && type !== 'noul') continue
    entries.push([id, { type: 'json', properties: ANSWER_FIELDS[type] }])
  }

  return entries.length > 0 ? { type: 'json', properties: Object.fromEntries(entries) } : undefined
}
