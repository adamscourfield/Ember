import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/features/auth/authOptions';
import { LearningPageShell } from '@/components/LearningPageShell';
import { LessonReport } from './LessonReport';

interface Props {
  params: Promise<{ recordingId: string }>;
}

export default async function LessonReportPage({ params }: Props) {
  const { recordingId } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/login');
  const role = (session.user as { role?: string }).role;
  if (role !== 'TEACHER' && role !== 'ADMIN' && role !== 'LEADERSHIP') redirect('/dashboard');

  return (
    <LearningPageShell
      title="Lesson feedback"
      appChrome="teacher"
      appChromeShowLeadershipNav={role === 'ADMIN' || role === 'LEADERSHIP'}
    >
      <LessonReport recordingId={recordingId} />
    </LearningPageShell>
  );
}
