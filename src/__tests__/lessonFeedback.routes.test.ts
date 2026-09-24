import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getServerSessionMock } = vi.hoisted(() => ({ getServerSessionMock: vi.fn() }));

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }));
vi.mock('@/features/auth/authOptions', () => ({ authOptions: {} }));
vi.mock('@/db/prisma', () => ({
  prisma: {
    lessonRecording: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), delete: vi.fn() },
    lessonRecordingChunk: { upsert: vi.fn() },
  },
}));
vi.mock('@/lib/lessonFeedback/pipeline', () => ({
  advanceRecording: vi.fn(),
  finishRecording: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/db/prisma';
import { POST as createRecording } from '@/app/api/teacher/lesson-recordings/route';
import { PUT as putChunk } from '@/app/api/teacher/lesson-recordings/[recordingId]/chunks/[seq]/route';
import { DELETE as deleteRecording, GET as getRecording } from '@/app/api/teacher/lesson-recordings/[recordingId]/route';

const p = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const ownRecording = { id: 'rec-1', teacherUserId: 't1', status: 'RECORDING' };

function chunkRequest(bytes = 10) {
  return new NextRequest('http://localhost/api', { method: 'PUT', body: new Uint8Array(bytes) });
}
const chunkParams = (seq = '0') => ({ params: Promise.resolve({ recordingId: 'rec-1', seq }) });
const recParams = { params: Promise.resolve({ recordingId: 'rec-1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  getServerSessionMock.mockResolvedValue({ user: { id: 't1', role: 'TEACHER' } });
  p.lessonRecording.findUnique.mockResolvedValue(ownRecording);
});

describe('lesson recording routes', () => {
  it('rejects students', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 's1', role: 'STUDENT' } });
    const res = await createRecording(
      new NextRequest('http://localhost/api', { method: 'POST', body: JSON.stringify({ title: 'Y8 maths' }) }),
    );
    expect(res.status).toBe(403);
  });

  it('creates a recording owned by the caller', async () => {
    p.lessonRecording.create.mockResolvedValue({ id: 'rec-1' });
    const res = await createRecording(
      new NextRequest('http://localhost/api', { method: 'POST', body: JSON.stringify({ title: 'Y8 maths' }) }),
    );
    expect(res.status).toBe(201);
    expect(p.lessonRecording.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ teacherUserId: 't1', title: 'Y8 maths' }) }),
    );
  });

  it("hides another teacher's recording, even from leadership", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 'head', role: 'LEADERSHIP' } });
    expect((await getRecording(new Request('http://localhost'), recParams)).status).toBe(404);
    expect((await putChunk(chunkRequest(), chunkParams())).status).toBe(404);
    expect((await deleteRecording(new Request('http://localhost'), recParams)).status).toBe(404);
    expect(p.lessonRecordingChunk.upsert).not.toHaveBeenCalled();
    expect(p.lessonRecording.delete).not.toHaveBeenCalled();
  });

  it('stores a chunk idempotently by sequence number', async () => {
    const res = await putChunk(chunkRequest(), chunkParams('3'));
    expect(res.status).toBe(200);
    expect(p.lessonRecordingChunk.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { recordingId_seq: { recordingId: 'rec-1', seq: 3 } } }),
    );
  });

  it('rejects bad sequence numbers, empty chunks and finished recordings', async () => {
    expect((await putChunk(chunkRequest(), chunkParams('-1'))).status).toBe(400);
    expect((await putChunk(chunkRequest(), chunkParams('abc'))).status).toBe(400);
    expect((await putChunk(chunkRequest(0), chunkParams())).status).toBe(413);
    p.lessonRecording.findUnique.mockResolvedValue({ ...ownRecording, status: 'TRANSCRIBING' });
    expect((await putChunk(chunkRequest(), chunkParams())).status).toBe(409);
  });
});
