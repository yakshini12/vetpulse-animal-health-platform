import { z } from 'zod';

/** Schema for the shared list query: pagination + sorting with safe bounds. */
export function listQuerySchema(sortFields: readonly string[]) {
  return z.object({
    search: z.string().trim().max(160).optional(),
    sort: z
      .string()
      .optional()
      .refine((value) => value === undefined || sortFields.includes(value), 'Unknown sort field'),
    order: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  });
}

export function paginated<T>(items: T[], total: number, query: { page: number; pageSize: number }) {
  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

/** Case-insensitive "contains" for a literal search string with LIKE wildcards escaped. */
export function containsLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
