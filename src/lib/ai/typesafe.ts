/**
 * Minimal client for TypeSafe's System One API (model: Jev).
 *
 * Jev does not generate text. It takes a `state` and a map of typed questions
 * (choice / score / noul) and returns typed answers with probabilities and
 * confidence. Use it where code needs a structured judgment rather than
 * free-form output. Docs: https://docs.typesafe.ai/api
 *
 * Server-side only — requires TYPESAFE_API_KEY.
 */

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const DEFAULT_MODEL = 'jev-latest';
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

type Structured = string | Record<string, unknown> | unknown[];

export interface ChoiceQuestion {
  type: 'choice';
  instructions: Structured;
  criteria: Record<string, Structured | null>;
}

export interface NoulQuestion {
  type: 'noul';
  instructions: Structured;
  criteria?: { true?: Structured; false?: Structured };
}

export interface ScoreQuestion {
  type: 'score';
  instructions: Structured;
  /** Ordered levels, lowest first. */
  criteria: Structured[];
}

export type SystemOneQuestion = ChoiceQuestion | NoulQuestion | ScoreQuestion;

export interface ChoiceAnswer {
  type: 'choice';
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface NoulAnswer {
  type: 'noul';
  /** Probability the answer is yes, 0–1. */
  noul: number;
}

export interface ScoreAnswer {
  type: 'score';
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
}

export type SystemOneAnswer = ChoiceAnswer | NoulAnswer | ScoreAnswer;

export interface SystemOneRequest {
  state: unknown;
  questions: Record<string, SystemOneQuestion>;
  model?: string;
}

export interface SystemOneResponse {
  /** Versioned model ID that answered, e.g. "jev-1.13.0". */
  model: string;
  answers: Record<string, SystemOneAnswer>;
  usage?: { input_tokens: number; output_tokens: number };
}

export class TypeSafeError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'TypeSafeError';
  }
}

export function isTypeSafeConfigured(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function callSystemOne(request: SystemOneRequest): Promise<SystemOneResponse> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new TypeSafeError('TYPESAFE_API_KEY is not set');

  const body = JSON.stringify({ model: DEFAULT_MODEL, ...request });

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body,
    });

    if (res.ok) return (await res.json()) as SystemOneResponse;

    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : BASE_DELAY_MS * 2 ** attempt);
      continue;
    }

    throw new TypeSafeError(`TypeSafe API error ${res.status}: ${await res.text()}`, res.status);
  }
}
