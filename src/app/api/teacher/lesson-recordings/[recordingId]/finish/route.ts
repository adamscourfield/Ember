import { NextResponse } from 'next/server';
import { requireOwnRecording } from '@/lib/lessonFeedback/access';
import { finishRecording } from '@/lib/lessonFeedback/pipeline';

interface Props {
  params: Promise<{ recordingId: string }>;
}

export const maxDuration = 300;

/** Stops the recording and hands the assembled audio to transcription. */
export async function POST(_req: Request, { params }: Props) {
  const { recordingId } = await params;
  const { recording, response } = await requireOwnRecording(recordingId);
  if (!recording) return response;

  await finishRecording(recording);
  return NextResponse.json({ ok: true });
}
