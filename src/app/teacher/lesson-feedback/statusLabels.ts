import type { LessonRecordingStatus } from '@prisma/client';

export const STATUS_LABEL: Record<LessonRecordingStatus, string> = {
  RECORDING: 'Recording',
  TRANSCRIBING: 'Transcribing…',
  ANALYSING: 'Writing feedback…',
  READY: 'Feedback ready',
  FAILED: 'Failed',
};
