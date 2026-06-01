import { env } from "@g-spot/env/web";
import { HexclaveClientApp, stackAppInternalsSymbol } from "@hexclave/react";

import { getExternalHttpUrl, openExternalUrl } from "@/lib/external-url";

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

function navigateOrOpenExternal(to: string): void {
  if (typeof window === "undefined") return;

  const externalUrl = getExternalHttpUrl(to);
  if (externalUrl) {
    void openExternalUrl(externalUrl);
    return;
  }

  window.location.assign(to);
}

export const stackClientApp = new HexclaveClientApp({
  projectId: env.VITE_STACK_PROJECT_ID,
  noAutomaticPrefetch: env.VITE_DEMO_MODE,
  tokenStore: isDesktopRenderer() ? "memory" : "cookie",
  redirectMethod: {
    useNavigate: () => navigateOrOpenExternal,
    navigate: navigateOrOpenExternal,
  },
  analytics: {
    replays: {
      enabled: false,
    },
  },
  oauthScopesOnSignIn: {
    google: [...googleOAuthScopes],
    github: [...githubOAuthScopes],
  },
  urls: {
    afterSignUp: "/onboarding",
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
