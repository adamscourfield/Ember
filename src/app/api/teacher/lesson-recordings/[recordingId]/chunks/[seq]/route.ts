import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/db/prisma';
import { requireOwnRecording } from '@/lib/lessonFeedback/access';

interface Props {
  params: Promise<{ recordingId: string; seq: string }>;
}

/** Recorder chunks are ~15s of compressed audio; anything far larger is not ours. */
const MAX_CHUNK_BYTES = 5 * 1024 * 1024;

/**
 * Stores one chunk of lesson audio. Idempotent per (recording, seq) so the
 * recorder can safely retry a chunk whose response was lost.
 */
export async function PUT(req: NextRequest, { params }: Props) {
  const { recordingId, seq: seqParam } = await params;
  const seq = Number(seqParam);
  if (!Number.isInteger(seq) || seq < 0) {
    return NextResponse.json({ error: 'Invalid chunk number' }, { status: 400 });
  }

  const { recording, response } = await requireOwnRecording(recordingId);
  if (!recording) return response;
  if (recording.status !== 'RECORDING') {
    return NextResponse.json({ error: 'Recording has already finished' }, { status: 409 });
  }

  if (Number(req.headers.get('content-length') ?? 0) > MAX_CHUNK_BYTES) {
    return NextResponse.json({ error: 'Invalid chunk size' }, { status: 413 });
  }
  const data = Buffer.from(await req.arrayBuffer());
  if (data.length === 0 || data.length > MAX_CHUNK_BYTES) {
    return NextResponse.json({ error: 'Invalid chunk size' }, { status: 413 });
  }

  await prisma.lessonRecordingChunk.upsert({
    where: { recordingId_seq: { recordingId, seq } },
    create: { recordingId, seq, data },
    update: { data },
  });
  return NextResponse.json({ ok: true });
}
