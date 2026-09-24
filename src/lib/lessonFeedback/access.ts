import { NextResponse } from 'next/server';
import { prisma } from '@/db/prisma';
import { requireApiUser, STAFF_ROLES } from '@/lib/api/auth';

/**
 * Recordings are private to the teacher who made them — no other role,
 * including leadership, can read them in this prototype.
 */
export async function requireOwnRecording(recordingId: string) {
  const { user, response } = await requireApiUser(STAFF_ROLES);
  if (!user) return { recording: null, response };

  const recording = await prisma.lessonRecording.findUnique({ where: { id: recordingId } });
  if (!recording || recording.teacherUserId !== user.id) {
    return { recording: null, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }
  return { recording, response: null };
}
