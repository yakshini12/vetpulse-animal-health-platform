import { z, type ZodTypeAny } from 'zod';
import { AppError } from '../errors.js';

/**
 * Validates request data against a Zod schema and throws the standard
 * 400 VALIDATION_ERROR AppError with per-field issue details.
 */
export function parseWith<T extends ZodTypeAny>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Request data is invalid.', result.error.issues);
  }
  return result.data;
}
