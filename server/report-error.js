import * as Sentry from "@sentry/node";

export function reportError(error) {
  if (!Sentry.isInitialized()) return;
  const exception = error instanceof Error ? error : new Error(error ? String(error) : "Unknown error");
  Sentry.captureException(exception);
}
