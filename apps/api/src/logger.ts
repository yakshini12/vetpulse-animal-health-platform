/**
 * Minimal logger. Only writes structured diagnostics to stdout/stderr.
 * Never logs request bodies or authorization headers, so no credentials
 * or tokens can leak into logs.
 */
export const logger = {
  info(message: string): void {
    console.log(`[vetpulse] ${message}`);
  },
  error(message: string, err?: unknown): void {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : '';
    console.error(`[vetpulse] ${message}${detail ? ` - ${detail}` : ''}`);
  },
};
