'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LessonRecordingStatus } from '@prisma/client';
import { TEACHER_TALK_FRAMEWORK } from '@/lib/lessonFeedback/framework';
import { formatTimestamp, type LabelledUtterance, type LessonMetrics } from '@/lib/lessonFeedback/metrics';
import type { LessonFeedback } from '@/lib/lessonFeedback/analyse';
import { STATUS_LABEL } from '../statusLabels';

const POLL_MS = 5000;

interface RecordingView {
  id: string;
  title: string;
  status: LessonRecordingStatus;
  startedAt: string;
  endedAt: string | null;
  transcript: { utterances: LabelledUtterance[] } | null;
  metrics: LessonMetrics | null;
  feedback: LessonFeedback | null;
  error: string | null;
  _count: { chunks: number };
}

const RATING_LABEL: Record<LessonFeedback['standards'][number]['rating'], string> = {
  strong: 'Strong',
  secure: 'Secure',
  developing: 'Developing',
  not_seen: 'Not seen',
  not_audible: "Can't judge from audio",
};

const RATING_STYLE: Record<LessonFeedback['standards'][number]['rating'], string> = {
  strong: 'bg-[color:var(--anx-tertiary)] text-white',
  secure: 'bg-[color:var(--anx-primary-soft)] text-[color:var(--anx-primary)]',
  developing: 'bg-[#fde8ec] text-[color:var(--anx-danger)]',
  not_seen: 'bg-surface-container-highest text-on-surface',
  not_audible: 'bg-surface-container-highest text-muted',
};

const STANDARD_TITLE = new Map(TEACHER_TALK_FRAMEWORK.map((s) => [s.id, s.title]));

export function LessonReport({ recordingId }: { recordingId: string }) {
  const router = useRouter();
  const [rec, setRec] = useState<RecordingView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/teacher/lesson-recordings/${recordingId}`, { cache: 'no-store' });
    if (!res.ok) {
      setLoadError(res.status === 404 ? 'Recording not found.' : 'Could not load this recording.');
      return;
    }
    setRec(((await res.json()) as { recording: RecordingView }).recording);
  }, [recordingId]);

  useEffect(() => {
    void load();
  }, [load]);

  const processing = rec?.status === 'TRANSCRIBING' || rec?.status === 'ANALYSING';
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [processing, load]);

  async function finish() {
    setBusy(true);
    await fetch(`/api/teacher/lesson-recordings/${recordingId}/finish`, { method: 'POST' });
    await load();
    setBusy(false);
  }

  async function retry() {
    setBusy(true);
    await fetch(`/api/teacher/lesson-recordings/${recordingId}/retry`, { method: 'POST' });
    await load();
    setBusy(false);
  }

  async function remove() {
    if (!window.confirm('Delete this recording, its transcript and its feedback? This cannot be undone.')) return;
    setBusy(true);
    await fetch(`/api/teacher/lesson-recordings/${recordingId}`, { method: 'DELETE' });
    router.push('/teacher/lesson-feedback');
  }

  if (loadError) return <div className="anx-card p-6 text-sm text-muted">{loadError}</div>;
  if (!rec) return <div className="anx-card p-6 text-sm text-muted">Loading…</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-xl font-bold text-on-surface">{rec.title}</h2>
          <p className="m-0 text-xs text-muted">
            {new Date(rec.startedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
            {STATUS_LABEL[rec.status]}
          </p>
        </div>
        <button type="button" className="anx-btn-ghost" onClick={remove} disabled={busy}>
          Delete recording
        </button>
      </div>

      {rec.status === 'RECORDING' && (
        <div className="anx-card space-y-3 p-6 text-sm text-muted">
          <p className="m-0">
            This recording was not finished ({rec._count.chunks} part{rec._count.chunks === 1 ? '' : 's'} of audio saved).
          </p>
          <button type="button" className="anx-btn-primary" onClick={finish} disabled={busy || rec._count.chunks === 0}>
            Transcribe what was saved
          </button>
        </div>
      )}

      {processing && (
        <div className="anx-card p-6 text-sm text-muted" aria-live="polite">
          {rec.status === 'TRANSCRIBING'
            ? 'Transcribing the lesson. This usually takes a few minutes for a full lesson.'
            : 'Writing your feedback against the framework…'}
        </div>
      )}

      {rec.status === 'FAILED' && (
        <div className="anx-card space-y-3 p-6">
          <p role="alert" className="m-0 text-sm text-[color:var(--anx-danger)]">
            Something went wrong: {rec.error ?? 'unknown error'}
          </p>
          {rec._count.chunks > 0 && (
            <button type="button" className="anx-btn-secondary" onClick={retry} disabled={busy}>
              {busy ? 'Retrying…' : 'Try again'}
            </button>
          )}
        </div>
      )}

      {rec.metrics && <MetricsRow metrics={rec.metrics} />}
      {rec.feedback && <FeedbackView feedback={rec.feedback} />}
      {rec.transcript && <TranscriptView utterances={rec.transcript.utterances} />}
    </div>
  );
}

function MetricsRow({ metrics }: { metrics: LessonMetrics }) {
  const tiles = [
    { label: 'Teacher share of talk', value: `${Math.round(metrics.teacherTalkShare * 100)}%` },
    { label: 'Questions per 10 min', value: String(metrics.teacherQuestionsPerTenMin) },
    { label: 'Student contributions', value: String(metrics.studentTurns) },
    { label: 'Silent practice', value: `${Math.round(metrics.silentPracticeSec / 60)} min` },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="anx-card p-4">
          <p className="m-0 text-2xl font-bold tabular-nums text-on-surface">{t.value}</p>
          <p className="m-0 text-xs text-muted">{t.label}</p>
        </div>
      ))}
    </div>
  );
}

function FeedbackView({ feedback }: { feedback: LessonFeedback }) {
  const byId = new Map(feedback.standards.map((s) => [s.standardId, s]));
  return (
    <div className="space-y-6">
      <section className="anx-card space-y-4 p-6">
        <p className="m-0 text-sm leading-relaxed text-on-surface">{feedback.overview}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="m-0 mb-2 text-xs font-bold uppercase tracking-wide text-muted">Strengths</h3>
            <ul className="m-0 list-disc space-y-1 pl-5 text-sm text-on-surface">
              {feedback.strengths.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="m-0 mb-2 text-xs font-bold uppercase tracking-wide text-muted">Next steps</h3>
            <ol className="m-0 space-y-3 pl-5 text-sm text-on-surface">
              {feedback.actionSteps.map((a, i) => (
                <li key={i}>
                  <span className="font-semibold">{STANDARD_TITLE.get(a.standardId)}:</span> {a.step}
                  <p className="m-0 mt-1 italic text-muted">Try: “{a.tryThis}”</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="m-0 text-xs font-bold uppercase tracking-wide text-muted">Framework</h3>
        <div className="grid gap-3 lg:grid-cols-2">
          {TEACHER_TALK_FRAMEWORK.map((std) => {
            const s = byId.get(std.id);
            return (
              <article key={std.id} className="anx-card space-y-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <h4 className="m-0 text-sm font-semibold text-on-surface">{std.title}</h4>
                  {s && (
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${RATING_STYLE[s.rating]}`}>
                      {RATING_LABEL[s.rating]}
                    </span>
                  )}
                </div>
                {s ? (
                  <>
                    <p className="m-0 text-sm text-on-surface">{s.summary}</p>
                    {s.evidence.length > 0 && (
                      <ul className="m-0 list-none space-y-1.5 p-0">
                        {s.evidence.map((e, i) => (
                          <li key={i} className="text-xs text-muted">
                            <span className="font-mono font-semibold text-on-surface">{e.timestamp}</span> “{e.quote}” — {e.comment}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <p className="m-0 text-sm text-muted">No feedback returned for this standard.</p>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function TranscriptView({ utterances }: { utterances: LabelledUtterance[] }) {
  return (
    <details className="anx-card p-4">
      <summary className="cursor-pointer text-sm font-semibold text-on-surface">Transcript</summary>
      <ol className="m-0 mt-3 max-h-[32rem] list-none space-y-2 overflow-y-auto p-0">
        {utterances.map((u, i) => (
          <li key={i} className="text-sm">
            <span className="mr-2 font-mono text-xs text-muted">{formatTimestamp(u.startMs)}</span>
            <span className={`mr-1 font-semibold ${u.isTeacher ? 'text-[color:var(--anx-primary)]' : 'text-on-surface'}`}>
              {u.isTeacher ? 'You' : `Student ${u.speaker}`}:
            </span>
            <span className="text-on-surface">{u.text}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
