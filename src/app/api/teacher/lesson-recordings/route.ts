import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/db/prisma';
import { requireApiUser, STAFF_ROLES } from '@/lib/api/auth';

const CreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  mimeType: z.string().max(100).optional(),
});

export async function GET() {
  const { user, response } = await requireApiUser(STAFF_ROLES);
  if (!user) return response;

  const recordings = await prisma.lessonRecording.findMany({
    where: { teacherUserId: user.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, status: true, startedAt: true, endedAt: true },
    take: 100,
  });
  return NextResponse.json({ recordings });
}

export async function POST(req: NextRequest) {
  const { user, response } = await requireApiUser(STAFF_ROLES);
  if (!user) return response;

  const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'A lesson title is required' }, { status: 400 });
  }

  const recording = await prisma.lessonRecording.create({
    data: { teacherUserId: user.id, title: parsed.data.title, mimeType: parsed.data.mimeType },
    select: { id: true },
  });
  return NextResponse.json(recording, { status: 201 });
}
