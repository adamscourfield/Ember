'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/** Each chunk is uploaded as soon as it is recorded, so a closed tab loses at most this much audio. */
const CHUNK_MS = 15_000;
const MAX_RETRY_DELAY_MS = 30_000;

type Phase = 'idle' | 'starting' | 'recording' | 'finishing' | 'error';

interface PendingChunk {
  seq: number;
  blob: Blob;
}

function pickMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return candidates.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t));
}

function defaultTitle(): string {
  return `Lesson – ${new Date().toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function LessonRecorder() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [uploaded, setUploaded] = useState(0);
  const [recorded, setRecorded] = useState(0);
  const [uploadIssue, setUploadIssue] = useState(false);

  const recordingIdRef = useRef<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const queueRef = useRef<PendingChunk[]>([]);
  const seqRef = useRef(0);
  const drainingRef = useRef<Promise<void> | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const startedAtRef = useRef(0);

  useEffect(() => setTitle(defaultTitle()), []);

  // Tick the on-screen timer while recording.
  useEffect(() => {
    if (phase !== 'recording') return;
    const t = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // Warn before leaving mid-lesson or with audio still to upload.
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'finishing') return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [phase]);

  // Keep the screen awake; the lock is released whenever the page is hidden, so re-acquire it.
  const acquireWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
      }
    } catch {
      // Not supported or refused — recording still works, the screen may just sleep.
    }
  }, []);

  useEffect(() => {
    if (phase !== 'recording') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquireWakeLock();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [phase, acquireWakeLock]);

  /** Uploads queued chunks in order, retrying with backoff until each one is stored. */
  const drain = useCallback(() => {
    if (drainingRef.current) return drainingRef.current;
    drainingRef.current = (async () => {
      let delay = 1000;
      while (queueRef.current.length > 0) {
        const chunk = queueRef.current[0];
        try {
          const res = await fetch(
            `/api/teacher/lesson-recordings/${recordingIdRef.current}/chunks/${chunk.seq}`,
            { method: 'PUT', body: chunk.blob },
          );
          if (!res.ok) throw new Error(`Upload failed (${res.status})`);
          queueRef.current.shift();
          setUploaded((n) => n + 1);
          setUploadIssue(false);
          delay = 1000;
        } catch {
          setUploadIssue(true);
          await sleep(delay);
          delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS);
        }
      }
    })().finally(() => {
      drainingRef.current = null;
    });
    return drainingRef.current;
  }, []);

  async function start() {
    setError(null);
    setPhase('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const mimeType = pickMimeType();

      const res = await fetch('/api/teacher/lesson-recordings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim() || defaultTitle(), mimeType }),
      });
      if (!res.ok) throw new Error('Could not start the recording');
      recordingIdRef.current = ((await res.json()) as { id: string }).id;

      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32_000 });
      recorder.ondataavailable = (e) => {
        if (e.data.size === 0) return;
        queueRef.current.push({ seq: seqRef.current++, blob: e.data });
        setRecorded((n) => n + 1);
        void drain();
      };
      recorderRef.current = recorder;
      recorder.start(CHUNK_MS);

      startedAtRef.current = Date.now();
      setElapsedMs(0);
      setPhase('recording');
      void acquireWakeLock();
    } catch (e) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      setError(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it in your browser settings and try again.'
          : e instanceof Error
            ? e.message
            : 'Could not start recording',
      );
      setPhase('error');
    }
  }

  async function stop() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    setPhase('finishing');

    // The final chunk arrives in a dataavailable event just before 'stop'.
    await new Promise<void>((resolve) => {
      recorder.addEventListener('stop', () => resolve(), { once: true });
      recorder.stop();
    });
    streamRef.current?.getTracks().forEach((t) => t.stop());
    void wakeLockRef.current?.release().catch(() => undefined);

    // A chunk can land just as a drain loop exits, so keep draining until the queue is empty.
    while (queueRef.current.length > 0) await drain();
    const id = recordingIdRef.current;
    const res = await fetch(`/api/teacher/lesson-recordings/${id}/finish`, { method: 'POST' });
    if (!res.ok) {
      setError('Audio is saved, but transcription could not be started. Open the recording to retry.');
      setPhase('error');
      return;
    }
    router.push(`/teacher/lesson-feedback/${id}`);
  }

  const pending = recorded - uploaded;

  return (
    <div className="anx-card mx-auto max-w-xl space-y-5 p-6">
      {phase === 'idle' || phase === 'starting' || (phase === 'error' && !recordingIdRef.current) ? (
        <>
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold text-on-surface">Lesson title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface"
            />
          </label>
          <ul className="m-0 list-disc space-y-1 pl-5 text-sm text-muted">
            <li>Use a clip-on mic or keep the device near you. Your voice matters most.</li>
            <li>Keep this page open and the screen on until the lesson ends.</li>
            <li>The recording is private to you and you can delete it at any time.</li>
          </ul>
          <button type="button" className="anx-btn-primary w-full" onClick={start} disabled={phase === 'starting'}>
            {phase === 'starting' ? 'Starting…' : 'Start recording'}
          </button>
        </>
      ) : (
        <div className="space-y-4 text-center">
          <div className="flex items-center justify-center gap-2">
            {phase === 'recording' && (
              <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-[color:var(--anx-danger)]" aria-hidden />
            )}
            <span className="text-sm font-semibold text-on-surface">
              {phase === 'recording' ? 'Recording' : phase === 'finishing' ? 'Finishing upload…' : 'Stopped'}
            </span>
          </div>
          <p className="m-0 text-5xl font-bold tabular-nums text-on-surface" aria-live="off">
            {formatElapsed(elapsedMs)}
          </p>
          <p className="m-0 text-xs text-muted" aria-live="polite">
            {pending === 0
              ? 'All audio uploaded'
              : uploadIssue
                ? `Connection issue — ${pending} part${pending === 1 ? '' : 's'} waiting, retrying automatically`
                : `Uploading… ${pending} part${pending === 1 ? '' : 's'} waiting`}
          </p>
          {phase === 'recording' && (
            <button type="button" className="anx-btn-primary w-full" onClick={stop}>
              Stop and get feedback
            </button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="m-0 text-sm text-[color:var(--anx-danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
