/**
 * Timing metrics computed in code from a speaker-labelled transcript.
 *
 * These are facts, not judgments: talk time per speaker, how often students
 * speak, long silences (candidate silent-practice periods) and question
 * counts. The feedback model receives them alongside the transcript so it
 * doesn't have to estimate numbers from text.
 */

export interface Utterance {
  speaker: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface LabelledUtterance extends Utterance {
  isTeacher: boolean;
}

export interface SilentPeriod {
  startMs: number;
  endMs: number;
}

export interface LessonMetrics {
  durationSec: number;
  teacherSpeaker: string | null;
  teacherTalkSec: number;
  studentTalkSec: number;
  /** Share of all speech that is the teacher's, 0–1. */
  teacherTalkShare: number;
  teacherTurns: number;
  studentTurns: number;
  /** Distinct non-teacher speaker labels (a rough lower bound on contributors). */
  distinctStudentSpeakers: number;
  teacherQuestions: number;
  teacherQuestionsPerTenMin: number;
  /** Gaps of at least SILENCE_MIN_MS with no detected speech. */
  silentPeriods: SilentPeriod[];
  silentPracticeSec: number;
}

/** A pause this long is treated as a candidate silent-practice period. */
export const SILENCE_MIN_MS = 60_000;

/** The teacher is taken to be the speaker with the most talk time. */
export function identifyTeacher(utterances: Utterance[]): string | null {
  const talk = new Map<string, number>();
  for (const u of utterances) {
    talk.set(u.speaker, (talk.get(u.speaker) ?? 0) + (u.endMs - u.startMs));
  }
  let best: string | null = null;
  let bestMs = -1;
  for (const [speaker, ms] of talk) {
    if (ms > bestMs) {
      best = speaker;
      bestMs = ms;
    }
  }
  return best;
}

export function labelUtterances(utterances: Utterance[], teacherSpeaker: string | null): LabelledUtterance[] {
  return utterances.map((u) => ({ ...u, isTeacher: u.speaker === teacherSpeaker }));
}

function countQuestions(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

export function computeLessonMetrics(utterances: Utterance[], durationSec: number): LessonMetrics {
  const sorted = [...utterances].sort((a, b) => a.startMs - b.startMs);
  const teacherSpeaker = identifyTeacher(sorted);

  let teacherMs = 0;
  let studentMs = 0;
  let teacherTurns = 0;
  let studentTurns = 0;
  let teacherQuestions = 0;
  const studentSpeakers = new Set<string>();

  for (const u of sorted) {
    const ms = Math.max(0, u.endMs - u.startMs);
    if (u.speaker === teacherSpeaker) {
      teacherMs += ms;
      teacherTurns++;
      teacherQuestions += countQuestions(u.text);
    } else {
      studentMs += ms;
      studentTurns++;
      studentSpeakers.add(u.speaker);
    }
  }

  const silentPeriods: SilentPeriod[] = [];
  let cursor = 0;
  for (const u of sorted) {
    if (u.startMs - cursor >= SILENCE_MIN_MS) {
      silentPeriods.push({ startMs: cursor, endMs: u.startMs });
    }
    cursor = Math.max(cursor, u.endMs);
  }
  const endMs = durationSec * 1000;
  if (endMs - cursor >= SILENCE_MIN_MS) {
    silentPeriods.push({ startMs: cursor, endMs });
  }

  const totalTalk = teacherMs + studentMs;
  const minutes = durationSec / 60;

  return {
    durationSec,
    teacherSpeaker,
    teacherTalkSec: Math.round(teacherMs / 1000),
    studentTalkSec: Math.round(studentMs / 1000),
    teacherTalkShare: totalTalk > 0 ? round2(teacherMs / totalTalk) : 0,
    teacherTurns,
    studentTurns,
    distinctStudentSpeakers: studentSpeakers.size,
    teacherQuestions,
    teacherQuestionsPerTenMin: minutes > 0 ? round2((teacherQuestions / minutes) * 10) : 0,
    silentPeriods,
    silentPracticeSec: Math.round(silentPeriods.reduce((s, p) => s + (p.endMs - p.startMs), 0) / 1000),
  };
}

export function formatTimestamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
