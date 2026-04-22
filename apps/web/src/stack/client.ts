import { env } from "@g-spot/env/web";
import { StackClientApp } from "@stackframe/react";

const githubOAuthScopes = [
  "repo",
  "workflow",
  "write:org",
  "user:email",
] as const;

const googleOAuthScopes = [
  "openid",
  "email",
  "profile",
  "https://mail.google.com/",
  "https://www.googleapis.com/auth/calendar",
] as const;

export const stackClientApp = new StackClientApp({
  projectId: env.VITE_STACK_PROJECT_ID,
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
