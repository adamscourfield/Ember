/**
 * Generates framework feedback for a transcribed lesson with Claude.
 *
 * The model sees a timestamped, speaker-labelled transcript plus the timing
 * metrics computed in code, and must cite timestamped evidence for every
 * rating so a teacher can check each claim against the recording.
 */

import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod/v4';
import { FRAMEWORK_IDS, TEACHER_TALK_FRAMEWORK } from './framework';
import { formatTimestamp, type LabelledUtterance, type LessonMetrics } from './metrics';

const MODEL = 'claude-opus-5';

const EvidenceSchema = z.object({
  timestamp: z.string().describe('mm:ss from the transcript'),
  quote: z.string().describe('Verbatim words from the transcript'),
  comment: z.string(),
});

const StandardFeedbackSchema = z.object({
  standardId: z.enum(FRAMEWORK_IDS as [string, ...string[]]),
  rating: z.enum(['strong', 'secure', 'developing', 'not_seen', 'not_audible']),
  summary: z.string().describe('One or two sentences, addressed to the teacher'),
  evidence: z.array(EvidenceSchema),
});

export const LessonFeedbackSchema = z.object({
  overview: z.string().describe('Three or four sentences on the lesson as a whole'),
  strengths: z.array(z.string()).describe('Two or three specific strengths'),
  actionSteps: z
    .array(
      z.object({
        standardId: z.enum(FRAMEWORK_IDS as [string, ...string[]]),
        step: z.string().describe('One concrete, practisable change'),
        tryThis: z.string().describe('The exact words the teacher could say next lesson'),
      }),
    )
    .describe('At most two, highest leverage first'),
  standards: z.array(StandardFeedbackSchema),
});

export type LessonFeedback = z.infer<typeof LessonFeedbackSchema>;

const SYSTEM_PROMPT = `You are an expert instructional coach giving a teacher private feedback on a lesson they recorded, the way call reviewers give counsellors feedback: specific, evidence-based and practical.

You will receive the school's framework, timing metrics measured in code, and a transcript. Speaker "T" is the teacher; other labels are students (speaker separation for students is approximate).

Rate every framework standard:
- strong: consistently and skilfully done
- secure: done, with minor gaps
- developing: attempted but inconsistent or ineffective
- not_seen: the recording contains no evidence it happened
- not_audible: the standard cannot be judged from audio for this lesson

Rules:
- Base every rating on the transcript or the metrics. Quote words verbatim with their mm:ss timestamp. Never invent quotes.
- Use the measured metrics for participation and silent practice rather than estimating from the text.
- Speech recognition makes errors; do not criticise wording that is plausibly a transcription error.
- Be direct and specific. Action steps must be small enough to practise next lesson.`;

function buildUserPrompt(utterances: LabelledUtterance[], metrics: LessonMetrics): string {
  const framework = TEACHER_TALK_FRAMEWORK.map(
    (s) => `- ${s.id} — ${s.title}: ${s.lookFor} [evidence: ${s.audibility}]`,
  ).join('\n');

  const silences = metrics.silentPeriods.length
    ? metrics.silentPeriods
        .map((p) => `${formatTimestamp(p.startMs)}–${formatTimestamp(p.endMs)}`)
        .join(', ')
    : 'none';

  const transcript = utterances
    .map((u) => `[${formatTimestamp(u.startMs)}] ${u.isTeacher ? 'T' : `S${u.speaker}`}: ${u.text}`)
    .join('\n');

  return `FRAMEWORK
${framework}

MEASURED METRICS
- Lesson length: ${Math.round(metrics.durationSec / 60)} min
- Teacher share of speech: ${Math.round(metrics.teacherTalkShare * 100)}%
- Teacher turns: ${metrics.teacherTurns}; student turns: ${metrics.studentTurns}; distinct student voices detected: ${metrics.distinctStudentSpeakers}
- Teacher questions: ${metrics.teacherQuestions} (${metrics.teacherQuestionsPerTenMin} per 10 min)
- Silent periods of 60s+: ${silences} (total ${Math.round(metrics.silentPracticeSec / 60)} min)

TRANSCRIPT
${transcript}`;
}

export async function generateLessonFeedback(
  utterances: LabelledUtterance[],
  metrics: LessonMetrics,
): Promise<LessonFeedback> {
  const client = new Anthropic();

  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: 'adaptive' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(utterances, metrics) }],
    output_config: { format: betaZodOutputFormat(LessonFeedbackSchema) },
  });
  const message = await stream.finalMessage();

  if (message.stop_reason === 'refusal') {
    throw new Error('Feedback generation was declined for this transcript');
  }
  if (message.stop_reason === 'max_tokens') {
    throw new Error('Feedback generation ran out of output tokens');
  }

  const text = message.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('No feedback returned');
  return LessonFeedbackSchema.parse(JSON.parse(text.text));
}

export { buildUserPrompt as buildFeedbackPrompt };
