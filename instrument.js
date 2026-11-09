import "@sentry/node/import";
import "dotenv/config";
import * as Sentry from "@sentry/node";

const dsn = (process.env.SENTRY_DSN || "").trim();

function scrub(event) {
  const request = event?.request;
  if (request) {
    delete request.data;
    delete request.cookies;
    delete request.query_string;
    if (typeof request.url === "string") {
      const query = request.url.indexOf("?");
      if (query !== -1) request.url = request.url.slice(0, query);
    }
    if (request.headers && typeof request.headers === "object") {
      const headers = {};
      for (const [name, value] of Object.entries(request.headers)) {
        const key = name.toLowerCase();
        if (key === "user-agent" || key === "content-type" || key === "accept") headers[name] = value;
      }
      request.headers = headers;
    }
  }
  delete event?.user;
  if (Array.isArray(event?.breadcrumbs)) {
    for (const crumb of event.breadcrumbs) {
      if (!crumb?.data || typeof crumb.data !== "object") continue;
      delete crumb.data.body;
      delete crumb.data.request_body;
      delete crumb.data.cookie;
      delete crumb.data.cookies;
      if (typeof crumb.data.url === "string") {
        const query = crumb.data.url.indexOf("?");
        if (query !== -1) crumb.data.url = crumb.data.url.slice(0, query);
      }
    }
  }
  return event;
}

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || "development",
    release: process.env.SENTRY_RELEASE || process.env.RAILWAY_GIT_COMMIT_SHA || undefined,
    sendDefaultPii: false,
    includeLocalVariables: false,
    tracesSampleRate: 1.0,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
    },
    beforeSend: scrub,
    beforeSendSpan(span) {
      if (!span?.attributes) return span;
      const attributes = { ...span.attributes };
      for (const key of Object.keys(attributes)) {
        const name = key.toLowerCase();
        if (name.includes("cookie") || name.includes("authorization") || name.endsWith(".body")) delete attributes[key];
        if ((name === "http.url" || name === "url.full" || name.endsWith(".url")) && typeof attributes[key] === "string") {
          const query = attributes[key].indexOf("?");
          if (query !== -1) attributes[key] = attributes[key].slice(0, query);
        }
      }
      span.attributes = attributes;
      return span;
    },
  });
}
