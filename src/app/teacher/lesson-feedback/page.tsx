import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/features/auth/authOptions';
import { prisma } from '@/db/prisma';
import { LearningPageShell } from '@/components/LearningPageShell';
import { STATUS_LABEL } from './statusLabels';

export default async function LessonFeedbackPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/login');
  const user = session.user as { id?: string; role?: string };
  if (!user.id || (user.role !== 'TEACHER' && user.role !== 'ADMIN' && user.role !== 'LEADERSHIP')) {
    redirect('/dashboard');
  }

  const recordings = await prisma.lessonRecording.findMany({
    where: { teacherUserId: user.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, status: true, startedAt: true, endedAt: true },
    take: 100,
  });

  return (
    <LearningPageShell
      title="Lesson feedback"
      subtitle="Record a lesson and get private, evidence-based feedback on your teacher talk. Only you can see your recordings."
      appChrome="teacher"
      appChromeShowLeadershipNav={user.role === 'ADMIN' || user.role === 'LEADERSHIP'}
      actions={
        <Link href="/teacher/lesson-feedback/record" className="anx-btn-primary no-underline">
          Record a lesson
        </Link>
      }
    >
      {recordings.length === 0 ? (
        <div className="anx-card p-6 text-sm text-muted">
          No recordings yet. Start one at the beginning of your next lesson — audio uploads automatically as you teach.
        </div>
      ) : (
        <ul className="m-0 list-none space-y-3 p-0">
          {recordings.map((r) => {
            const minutes = r.endedAt ? Math.round((r.endedAt.getTime() - r.startedAt.getTime()) / 60000) : null;
            return (
              <li key={r.id}>
                <Link
                  href={`/teacher/lesson-feedback/${r.id}`}
                  className="anx-card flex items-center justify-between gap-4 p-4 no-underline"
                >
                  <div className="min-w-0">
                    <p className="m-0 truncate font-semibold text-on-surface">{r.title}</p>
                    <p className="m-0 text-xs text-muted">
                      {r.startedAt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                      {minutes !== null ? ` · ${minutes} min` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-muted">{STATUS_LABEL[r.status]}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </LearningPageShell>
  );
}
