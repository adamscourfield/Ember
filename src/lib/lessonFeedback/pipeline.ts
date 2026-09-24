/**
 * Moves a lesson recording through its states:
 *
 *   RECORDING ──finish──▶ TRANSCRIBING ──transcript ready──▶ ANALYSING ──▶ READY
 *                                  └────────── any failure ──────────▶ FAILED ──retry──▶ (failed step)
 *
 * There is no background worker: the report page polls, and each poll calls
 * advanceRecording(). Transitions use a conditional updateMany on the current
 * status so concurrent polls can't run the same step twice.
 */

import type { LessonRecording, LessonRecordingStatus, Prisma } from '@prisma/client';
import { prisma } from '@/db/prisma';
import { getTranscription, startTranscription } from './assemblyai';
import { generateLessonFeedback } from './analyse';
import { computeLessonMetrics, labelUtterances } from './metrics';

/** A step that has been claimed for longer than this is assumed dead and may be retried. */
const STALE_CLAIM_MS = 10 * 60_000;

async function claim(
  id: string,
  from: LessonRecordingStatus,
  data: Prisma.LessonRecordingUpdateManyMutationInput = {},
  ifUpdatedAt?: Date,
): Promise<boolean> {
  const { count } = await prisma.lessonRecording.updateMany({
    where: { id, status: from, ...(ifUpdatedAt ? { updatedAt: ifUpdatedAt } : {}) },
    data: { ...data, updatedAt: new Date() },
  });
  return count === 1;
}

async function fail(id: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await prisma.lessonRecording.update({
    where: { id },
    data: { status: 'FAILED', error: message.slice(0, 2000) },
  });
}

/** Called when the teacher stops recording: assembles the chunks and starts transcription. */
export async function finishRecording(recording: LessonRecording): Promise<void> {
  if (recording.status !== 'RECORDING') return;
  if (!(await claim(recording.id, 'RECORDING', { status: 'TRANSCRIBING', endedAt: new Date() }))) return;

  try {
    const chunks = await prisma.lessonRecordingChunk.findMany({
      where: { recordingId: recording.id },
      orderBy: { seq: 'asc' },
      select: { data: true },
    });
    if (chunks.length === 0) throw new Error('No audio was received for this recording');

    const audio = Buffer.concat(chunks.map((c) => Buffer.from(c.data)));
    const jobId = await startTranscription(audio);
    await prisma.lessonRecording.update({
      where: { id: recording.id },
      data: { transcriptJobId: jobId },
    });
  } catch (err) {
    await fail(recording.id, err);
  }
}

/** Advances a TRANSCRIBING or ANALYSING recording by at most one step. */
export async function advanceRecording(recording: LessonRecording): Promise<void> {
  try {
    if (recording.status === 'TRANSCRIBING' && recording.transcriptJobId) {
      const job = await getTranscription(recording.transcriptJobId);
      if (job.status === 'error') throw new Error(job.error);
      if (job.status !== 'completed') return;

      const metrics = computeLessonMetrics(job.utterances, job.durationSec);
      const utterances = labelUtterances(job.utterances, metrics.teacherSpeaker);
      if (
        !(await claim(recording.id, 'TRANSCRIBING', {
          status: 'ANALYSING',
          transcript: {
            durationSec: job.durationSec,
            teacherSpeaker: metrics.teacherSpeaker,
            utterances,
          } as unknown as Prisma.InputJsonValue,
          metrics: metrics as unknown as Prisma.InputJsonValue,
        }))
      ) {
        return;
      }
      await analyse(recording.id);
      return;
    }

    // Retry an analysis step whose worker died (e.g. the request was cut off).
    if (
      recording.status === 'ANALYSING' &&
      Date.now() - recording.updatedAt.getTime() > STALE_CLAIM_MS &&
      (await claim(recording.id, 'ANALYSING', {}, recording.updatedAt))
    ) {
      await analyse(recording.id);
    }
  } catch (err) {
    await fail(recording.id, err);
  }
}

/**
 * Retries a FAILED recording from the step that failed: re-analyses when the
 * transcript is already stored, otherwise re-submits the saved audio.
 */
export async function retryRecording(recording: LessonRecording): Promise<void> {
  if (recording.status !== 'FAILED') return;

  if (recording.transcript) {
    if (!(await claim(recording.id, 'FAILED', { status: 'ANALYSING', error: null }))) return;
    try {
      await analyse(recording.id);
    } catch (err) {
      await fail(recording.id, err);
    }
    return;
  }

  if (!(await claim(recording.id, 'FAILED', { status: 'RECORDING', error: null, transcriptJobId: null }))) return;
  await finishRecording({ ...recording, status: 'RECORDING' });
}

async function analyse(id: string): Promise<void> {
  const rec = await prisma.lessonRecording.findUniqueOrThrow({
    where: { id },
    select: { transcript: true, metrics: true },
  });
  const transcript = rec.transcript as unknown as { utterances: Parameters<typeof generateLessonFeedback>[0] };
  const metrics = rec.metrics as unknown as Parameters<typeof generateLessonFeedback>[1];

  const feedback = await generateLessonFeedback(transcript.utterances, metrics);
  await prisma.lessonRecording.update({
    where: { id },
    data: { status: 'READY', feedback: feedback as unknown as Prisma.InputJsonValue, error: null },
  });
}
