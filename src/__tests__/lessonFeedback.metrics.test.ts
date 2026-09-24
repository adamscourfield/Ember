import { describe, expect, it } from 'vitest';
import {
  computeLessonMetrics,
  formatTimestamp,
  identifyTeacher,
  labelUtterances,
  SILENCE_MIN_MS,
  type Utterance,
} from '@/lib/lessonFeedback/metrics';
import { parseTranscript } from '@/lib/lessonFeedback/assemblyai';
import { buildFeedbackPrompt } from '@/lib/lessonFeedback/analyse';
import { TEACHER_TALK_FRAMEWORK } from '@/lib/lessonFeedback/framework';

const lesson: Utterance[] = [
  { speaker: 'A', startMs: 0, endMs: 20_000, text: 'Eyes on me. You have three minutes. What is a factor? Jamal?' },
  { speaker: 'B', startMs: 21_000, endMs: 24_000, text: 'A number that divides into it.' },
  { speaker: 'A', startMs: 25_000, endMs: 35_000, text: 'Good. Why does that work?' },
  { speaker: 'C', startMs: 36_000, endMs: 40_000, text: 'Because there is no remainder.' },
  // 5 minutes of silent practice
  { speaker: 'A', startMs: 340_000, endMs: 350_000, text: 'Pens down.' },
];

describe('lesson metrics', () => {
  it('takes the speaker with the most talk time as the teacher', () => {
    expect(identifyTeacher(lesson)).toBe('A');
    expect(identifyTeacher([])).toBeNull();
  });

  it('splits talk time and turns between teacher and students', () => {
    const m = computeLessonMetrics(lesson, 400);
    expect(m.teacherSpeaker).toBe('A');
    expect(m.teacherTalkSec).toBe(40);
    expect(m.studentTalkSec).toBe(7);
    expect(m.teacherTalkShare).toBeCloseTo(40 / 47, 2);
    expect(m.teacherTurns).toBe(3);
    expect(m.studentTurns).toBe(2);
    expect(m.distinctStudentSpeakers).toBe(2);
  });

  it('counts teacher questions only', () => {
    const m = computeLessonMetrics(lesson, 400);
    expect(m.teacherQuestions).toBe(3);
    expect(m.teacherQuestionsPerTenMin).toBeCloseTo((3 / (400 / 60)) * 10, 2);
  });

  it('finds silences of at least a minute', () => {
    const m = computeLessonMetrics(lesson, 400);
    // 40s–340s is silent practice; the final 50s after "Pens down." is under the threshold.
    expect(m.silentPeriods).toEqual([{ startMs: 40_000, endMs: 340_000 }]);
    expect(m.silentPracticeSec).toBe(300);
  });

  it('counts a long silence at the end of the recording', () => {
    const m = computeLessonMetrics(lesson, 350 + SILENCE_MIN_MS / 1000);
    expect(m.silentPeriods.at(-1)).toEqual({ startMs: 350_000, endMs: 410_000 });
  });

  it('handles overlapping speech without inventing silence', () => {
    const m = computeLessonMetrics(
      [
        { speaker: 'A', startMs: 0, endMs: 100_000, text: 'Long explanation' },
        { speaker: 'B', startMs: 50_000, endMs: 60_000, text: 'Interruption' },
        { speaker: 'A', startMs: 110_000, endMs: 120_000, text: 'Next' },
      ],
      120,
    );
    expect(m.silentPeriods).toEqual([]);
  });

  it('labels the teacher on each utterance', () => {
    const labelled = labelUtterances(lesson, 'A');
    expect(labelled.map((u) => u.isTeacher)).toEqual([true, false, true, false, true]);
  });

  it('formats timestamps as mm:ss', () => {
    expect(formatTimestamp(0)).toBe('00:00');
    expect(formatTimestamp(65_400)).toBe('01:05');
    expect(formatTimestamp(3_725_000)).toBe('62:05');
  });
});

describe('AssemblyAI transcript parsing', () => {
  it('maps utterances to milliseconds and rounds the duration', () => {
    expect(
      parseTranscript({
        id: 't1',
        status: 'completed',
        audio_duration: 3599.6,
        utterances: [{ speaker: 'A', start: 10, end: 900, text: 'Morning' }],
      }),
    ).toEqual({
      status: 'completed',
      durationSec: 3600,
      utterances: [{ speaker: 'A', startMs: 10, endMs: 900, text: 'Morning' }],
    });
  });

  it('passes through in-progress and error states', () => {
    expect(parseTranscript({ id: 't1', status: 'processing' })).toEqual({ status: 'processing' });
    expect(parseTranscript({ id: 't1', status: 'error', error: 'bad audio' })).toEqual({
      status: 'error',
      error: 'bad audio',
    });
  });
});

describe('feedback prompt', () => {
  it('includes every framework standard, the measured metrics and a labelled transcript', () => {
    const metrics = computeLessonMetrics(lesson, 400);
    const prompt = buildFeedbackPrompt(labelUtterances(lesson, 'A'), metrics);
    for (const s of TEACHER_TALK_FRAMEWORK) expect(prompt).toContain(s.id);
    expect(prompt).toContain('Teacher share of speech: 85%');
    expect(prompt).toContain('00:40–05:40');
    expect(prompt).toContain('[00:00] T: Eyes on me.');
    expect(prompt).toContain('[00:21] SB: A number');
  });
});
