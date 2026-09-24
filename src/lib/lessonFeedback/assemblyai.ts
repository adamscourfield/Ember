/**
 * AssemblyAI pre-recorded transcription with speaker labels.
 * Docs: https://www.assemblyai.com/docs/pre-recorded-audio/label-speakers
 *
 * Set ASSEMBLYAI_BASE_URL=https://api.eu.assemblyai.com for EU processing.
 */

import type { Utterance } from './metrics';

const DEFAULT_BASE_URL = 'https://api.assemblyai.com';

export type TranscriptJob =
  | { status: 'queued' | 'processing' }
  | { status: 'completed'; durationSec: number; utterances: Utterance[] }
  | { status: 'error'; error: string };

interface AssemblyUtterance {
  speaker: string;
  start: number;
  end: number;
  text: string;
}

interface AssemblyTranscript {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  error?: string | null;
  audio_duration?: number | null;
  utterances?: AssemblyUtterance[] | null;
}

function config() {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) throw new Error('ASSEMBLYAI_API_KEY is not set');
  return { apiKey, baseUrl: process.env.ASSEMBLYAI_BASE_URL || DEFAULT_BASE_URL };
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const { apiKey, baseUrl } = config();
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { authorization: apiKey, ...init.headers },
  });
  if (!res.ok) {
    throw new Error(`AssemblyAI ${path} failed ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

/** Uploads the lesson audio and starts a speaker-labelled transcription job. */
export async function startTranscription(audio: Buffer): Promise<string> {
  const upload = await request<{ upload_url: string }>('/v2/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: new Uint8Array(audio),
  });

  const job = await request<AssemblyTranscript>('/v2/transcript', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ audio_url: upload.upload_url, speaker_labels: true }),
  });
  return job.id;
}

export function parseTranscript(t: AssemblyTranscript): TranscriptJob {
  if (t.status === 'error') return { status: 'error', error: t.error ?? 'Transcription failed' };
  if (t.status !== 'completed') return { status: t.status };
  return {
    status: 'completed',
    durationSec: Math.round(t.audio_duration ?? 0),
    utterances: (t.utterances ?? []).map((u) => ({
      speaker: u.speaker,
      startMs: u.start,
      endMs: u.end,
      text: u.text,
    })),
  };
}

export async function getTranscription(jobId: string): Promise<TranscriptJob> {
  const t = await request<AssemblyTranscript>(`/v2/transcript/${encodeURIComponent(jobId)}`, {
    method: 'GET',
  });
  return parseTranscript(t);
}
