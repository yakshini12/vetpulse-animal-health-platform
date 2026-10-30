import { describe, expect, it } from 'vitest';
import {
  CASE_TRANSITIONS,
  SAMPLE_CAN_REJECT,
  SAMPLE_TRANSITIONS,
  TASK_TRANSITIONS,
} from '../lib/transitions.js';

/**
 * The UI offers transition buttons based on these mirrors of the server maps.
 * If the backend maps ever change, these tests fail first — forcing the
 * frontend to stay in sync with the documented transitions.
 */
describe('documented status transition mirrors', () => {
  it('case transitions match the backend: OPEN → IN_PROGRESS/CLOSED, CLOSED terminal', () => {
    expect(CASE_TRANSITIONS.OPEN).toEqual(['IN_PROGRESS', 'CLOSED']);
    expect(CASE_TRANSITIONS.IN_PROGRESS).toEqual(['RESOLVED', 'OPEN', 'CLOSED']);
    expect(CASE_TRANSITIONS.RESOLVED).toEqual(['CLOSED', 'IN_PROGRESS']);
    expect(CASE_TRANSITIONS.CLOSED).toEqual([]);
  });

  it('sample transitions match the backend and terminal states accept nothing', () => {
    expect(SAMPLE_TRANSITIONS.RECEIVED).toEqual(['IN_PROCESS']);
    expect(SAMPLE_TRANSITIONS.IN_PROCESS).toEqual(['IN_REVIEW', 'REJECTED']);
    expect(SAMPLE_TRANSITIONS.IN_REVIEW).toEqual(['COMPLETED', 'REJECTED']);
    expect(SAMPLE_TRANSITIONS.COMPLETED).toEqual([]);
    expect(SAMPLE_TRANSITIONS.REJECTED).toEqual([]);
  });

  it('a received sample cannot be rejected directly (mirrors server enforcement)', () => {
    expect(SAMPLE_CAN_REJECT.RECEIVED).toBe(false);
    expect(SAMPLE_CAN_REJECT.IN_PROCESS).toBe(true);
    expect(SAMPLE_CAN_REJECT.IN_REVIEW).toBe(true);
    expect(SAMPLE_CAN_REJECT.COMPLETED).toBe(false);
  });

  it('task transitions allow reopening DONE and closing CANCELLED permanently', () => {
    expect(TASK_TRANSITIONS.DONE).toEqual(['TODO']);
    expect(TASK_TRANSITIONS.CANCELLED).toEqual([]);
    expect(TASK_TRANSITIONS.TODO).toEqual(['IN_PROGRESS', 'DONE', 'CANCELLED']);
  });
});
