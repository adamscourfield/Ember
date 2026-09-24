import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db/prisma', () => ({
  prisma: {
    lessonRecording: { updateMany: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
    lessonRecordingChunk: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/lessonFeedback/assemblyai', () => ({
  startTranscription: vi.fn(),
  getTranscription: vi.fn(),
}));
vi.mock('@/lib/lessonFeedback/analyse', () => ({ generateLessonFeedback: vi.fn() }));

import type { LessonRecording } from '@prisma/client';
import { prisma } from '@/db/prisma';
import { getTranscription, startTranscription } from '@/lib/lessonFeedback/assemblyai';
import { generateLessonFeedback } from '@/lib/lessonFeedback/analyse';
import { advanceRecording, finishRecording, retryRecording } from '@/lib/lessonFeedback/pipeline';

const p = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const startMock = vi.mocked(startTranscription);
const getMock = vi.mocked(getTranscription);
const feedbackMock = vi.mocked(generateLessonFeedback);

function rec(overrides: Partial<LessonRecording> = {}): LessonRecording {
  return {
    id: 'rec-1',
    teacherUserId: 't1',
    title: 'Y8',
    status: 'RECORDING',
    mimeType: 'audio/webm',
    startedAt: new Date(),
    endedAt: null,
    transcriptJobId: null,
    transcript: null,
    metrics: null,
    feedback: null,
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const utterances = [
  { speaker: 'A', startMs: 0, endMs: 10_000, text: 'What is a factor, Sam?' },
  { speaker: 'B', startMs: 11_000, endMs: 13_000, text: 'It divides exactly.' },
];

beforeEach(() => {
  vi.clearAllMocks();
  p.lessonRecording.updateMany.mockResolvedValue({ count: 1 });
});

describe('finishRecording', () => {
  it('joins chunks in order and starts transcription', async () => {
    p.lessonRecordingChunk.findMany.mockResolvedValue([
      { data: Buffer.from('ab') },
      { data: Buffer.from('cd') },
    ]);
    startMock.mockResolvedValue('job-1');

    await finishRecording(rec());

    expect(p.lessonRecordingChunk.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { seq: 'asc' } }));
    expect(startMock.mock.calls[0][0].toString()).toBe('abcd');
    expect(p.lessonRecording.update).toHaveBeenCalledWith({ where: { id: 'rec-1' }, data: { transcriptJobId: 'job-1' } });
  });

  it('does nothing when another request already claimed the recording', async () => {
    p.lessonRecording.updateMany.mockResolvedValue({ count: 0 });
    await finishRecording(rec());
    expect(startMock).not.toHaveBeenCalled();
  });

  it('fails the recording when no audio arrived', async () => {
    p.lessonRecordingChunk.findMany.mockResolvedValue([]);
    await finishRecording(rec());
    expect(p.lessonRecording.update).toHaveBeenCalledWith({
      where: { id: 'rec-1' },
      data: { status: 'FAILED', error: 'No audio was received for this recording' },
    });
  });
});

describe('advanceRecording', () => {
  it('waits while the transcript is still processing', async () => {
    getMock.mockResolvedValue({ status: 'processing' });
    await advanceRecording(rec({ status: 'TRANSCRIBING', transcriptJobId: 'job-1' }));
    expect(p.lessonRecording.updateMany).not.toHaveBeenCalled();
  });

  it('stores transcript and metrics, then writes feedback', async () => {
    getMock.mockResolvedValue({ status: 'completed', durationSec: 60, utterances });
    p.lessonRecording.findUniqueOrThrow.mockImplementation(async () => {
      const data = p.lessonRecording.updateMany.mock.calls[0][0].data;
      return { transcript: data.transcript, metrics: data.metrics };
    });
    feedbackMock.mockResolvedValue({ overview: 'ok', strengths: [], actionSteps: [], standards: [] });

    await advanceRecording(rec({ status: 'TRANSCRIBING', transcriptJobId: 'job-1' }));

    const claimed = p.lessonRecording.updateMany.mock.calls[0][0];
    expect(claimed.where).toEqual({ id: 'rec-1', status: 'TRANSCRIBING' });
    expect(claimed.data.status).toBe('ANALYSING');
    expect(claimed.data.metrics.teacherSpeaker).toBe('A');
    expect(claimed.data.transcript.utterances[0].isTeacher).toBe(true);
    expect(feedbackMock).toHaveBeenCalledTimes(1);
    expect(p.lessonRecording.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'READY' }) }),
    );
  });

  it('fails the recording when transcription errors', async () => {
    getMock.mockResolvedValue({ status: 'error', error: 'unsupported audio' });
    await advanceRecording(rec({ status: 'TRANSCRIBING', transcriptJobId: 'job-1' }));
    expect(p.lessonRecording.update).toHaveBeenCalledWith({
      where: { id: 'rec-1' },
      data: { status: 'FAILED', error: 'unsupported audio' },
    });
  });

  it('only retries an analysis step once it has gone stale', async () => {
    await advanceRecording(rec({ status: 'ANALYSING', updatedAt: new Date() }));
    expect(p.lessonRecording.updateMany).not.toHaveBeenCalled();
  });
});

describe('retryRecording', () => {
  it('re-analyses when the transcript is already stored', async () => {
    p.lessonRecording.findUniqueOrThrow.mockResolvedValue({ transcript: { utterances: [] }, metrics: {} });
    feedbackMock.mockResolvedValue({ overview: 'ok', strengths: [], actionSteps: [], standards: [] });
    await retryRecording(rec({ status: 'FAILED', transcript: { utterances: [] } }));
    expect(p.lessonRecording.updateMany.mock.calls[0][0].data.status).toBe('ANALYSING');
    expect(startMock).not.toHaveBeenCalled();
    expect(feedbackMock).toHaveBeenCalledTimes(1);
  });

  it('re-submits the saved audio when transcription never finished', async () => {
    p.lessonRecordingChunk.findMany.mockResolvedValue([{ data: Buffer.from('ab') }]);
    startMock.mockResolvedValue('job-2');
    await retryRecording(rec({ status: 'FAILED' }));
    expect(p.lessonRecording.updateMany.mock.calls[0][0].data.status).toBe('RECORDING');
    expect(p.lessonRecording.updateMany.mock.calls[1][0].data.status).toBe('TRANSCRIBING');
    expect(startMock).toHaveBeenCalledTimes(1);
  });
});
