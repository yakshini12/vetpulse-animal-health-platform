/**
 * Status transition maps mirrored from the backend (documented in
 * apps/api/src/{cases,samples,tasks}/routes.ts). The UI uses them only to
 * decide which action buttons to offer — the server remains the
 * authoritative validator for every change.
 */
import type { CaseStatus, SampleStatus, TaskStatus } from '../api/types.js';

export const CASE_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  OPEN: ['IN_PROGRESS', 'CLOSED'],
  IN_PROGRESS: ['RESOLVED', 'OPEN', 'CLOSED'],
  RESOLVED: ['CLOSED', 'IN_PROGRESS'],
  CLOSED: [],
};

export const SAMPLE_TRANSITIONS: Record<SampleStatus, SampleStatus[]> = {
  RECEIVED: ['IN_PROCESS'],
  IN_PROCESS: ['IN_REVIEW', 'REJECTED'],
  IN_REVIEW: ['COMPLETED', 'REJECTED'],
  COMPLETED: [],
  REJECTED: [],
};

export const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  TODO: ['IN_PROGRESS', 'DONE', 'CANCELLED'],
  IN_PROGRESS: ['DONE', 'CANCELLED', 'TODO'],
  DONE: ['TODO'],
  CANCELLED: [],
};

/** Rejection interactions are only meaningful while a sample can be rejected. */
export const SAMPLE_CAN_REJECT: Record<SampleStatus, boolean> = {
  RECEIVED: false,
  IN_PROCESS: true,
  IN_REVIEW: true,
  COMPLETED: false,
  REJECTED: false,
};
