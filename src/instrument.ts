import * as Sentry from "@sentry/react";

const dsn = (import.meta.env.VITE_SENTRY_DSN || "").trim();

function scrub(event: Sentry.ErrorEvent) {
  const request = event.request;
  if (request) {
    delete request.data;
    delete request.cookies;
    delete request.query_string;
    if (typeof request.url === "string") {
      const query = request.url.indexOf("?");
      if (query !== -1) request.url = request.url.slice(0, query);
    }
    if (request.headers && typeof request.headers === "object") {
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers)) {
        const key = name.toLowerCase();
        if ((key === "user-agent" || key === "content-type" || key === "accept") && typeof value === "string") {
          headers[name] = value;
        }
      }
      request.headers = headers;
    }
  }
  delete event.user;
  return event;
}

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 1.0,
    tracePropagationTargets: [/^\//],
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
      genAI: { inputs: false, outputs: false },
    },
    beforeSend: scrub,
  });
}
