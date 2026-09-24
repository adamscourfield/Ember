import { NextResponse } from 'next/server';
import { prisma } from '@/db/prisma';
import { requireOwnRecording } from '@/lib/lessonFeedback/access';
import { advanceRecording } from '@/lib/lessonFeedback/pipeline';

interface Props {
  params: Promise<{ recordingId: string }>;
}

export const maxDuration = 300;

/**
 * Returns the recording and, while it is processing, advances it one step.
 * The report page polls this; there is no separate background worker.
 */
export async function GET(_req: Request, { params }: Props) {
  const { recordingId } = await params;
  const { recording, response } = await requireOwnRecording(recordingId);
  if (!recording) return response;

  if (recording.status === 'TRANSCRIBING' || recording.status === 'ANALYSING') {
    await advanceRecording(recording);
  }

  const current = await prisma.lessonRecording.findUniqueOrThrow({
    where: { id: recordingId },
    select: {
      id: true,
      title: true,
      status: true,
      startedAt: true,
      endedAt: true,
      transcript: true,
      metrics: true,
      feedback: true,
      error: true,
      _count: { select: { chunks: true } },
    },
  });
  return NextResponse.json({ recording: current });
}

/** Deletes the recording, its audio and its feedback. */
export async function DELETE(_req: Request, { params }: Props) {
  const { recordingId } = await params;
  const { recording, response } = await requireOwnRecording(recordingId);
  if (!recording) return response;

  await prisma.lessonRecording.delete({ where: { id: recordingId } });
  return NextResponse.json({ ok: true });
}
