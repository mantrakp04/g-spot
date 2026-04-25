import { env } from "@g-spot/env/web";
import { StackClientApp, stackAppInternalsSymbol } from "@stackframe/react";

const DESKTOP_AUTH_STORAGE_KEY = "g-spot.stack-auth";

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
  tokenStore: isDesktopRenderer() ? "memory" : "cookie",
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
function isDesktopRenderer(): boolean {
  return (
    typeof window !== "undefined" &&
    (window.location.protocol === "views:" || "__electrobunWebviewId" in window)
  );
}

export const GITHUB_OAUTH_SCOPES = githubOAuthScopes;
export const GOOGLE_OAUTH_SCOPES = googleOAuthScopes;
