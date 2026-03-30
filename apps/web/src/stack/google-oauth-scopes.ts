/**
 * Google OAuth scopes for Gmail + Calendar (used when linking Google and at sign-in).
 * `openid` / `email` / `profile` are required to resolve name + email via the userinfo API for the UI.
 * Enable Gmail API and Google Calendar API in Google Cloud Console for your OAuth client.
 */
export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://www.googleapis.com/auth/gmail.settings.basic",
  "https://www.googleapis.com/auth/calendar",
] as const;
