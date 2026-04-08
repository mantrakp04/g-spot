import { StackClientApp } from "@stackframe/react";

const githubOAuthScopes = [
  "repo",
  "read:org",
  "user:email",
] as const;

const googleOAuthScopes = [
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

export const stackClientApp = new StackClientApp({
  projectId: import.meta.env.VITE_STACK_PROJECT_ID,
  publishableClientKey: import.meta.env.VITE_STACK_PUBLISHABLE_CLIENT_KEY,
  tokenStore: "cookie",
  redirectMethod: "window",
  analytics: {
    replays: {
      enabled: false,
    },
  },
  oauthScopesOnSignIn: {
    google: [...googleOAuthScopes],
    github: [...githubOAuthScopes],
  },
});

export const GITHUB_OAUTH_SCOPES = githubOAuthScopes;
export const GOOGLE_OAUTH_SCOPES = googleOAuthScopes;
