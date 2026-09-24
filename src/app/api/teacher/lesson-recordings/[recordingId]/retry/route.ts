import { NextResponse } from 'next/server';
import { requireOwnRecording } from '@/lib/lessonFeedback/access';
import { retryRecording } from '@/lib/lessonFeedback/pipeline';

interface Props {
  params: Promise<{ recordingId: string }>;
}

export const maxDuration = 300;

/** Retries a failed recording from the step that failed. */
export async function POST(_req: Request, { params }: Props) {
  const { recordingId } = await params;
  const { recording, response } = await requireOwnRecording(recordingId);
  if (!recording) return response;
  if (recording.status !== 'FAILED') {
    return NextResponse.json({ error: 'Only failed recordings can be retried' }, { status: 409 });
  }

  await retryRecording(recording);
  return NextResponse.json({ ok: true });
}
