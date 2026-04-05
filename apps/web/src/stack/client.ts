import { StackClientApp } from "@stackframe/react";

import { GITHUB_OAUTH_SCOPES } from "./github-oauth-scopes";
import { GOOGLE_OAUTH_SCOPES } from "./google-oauth-scopes";

export const stackClientApp = new StackClientApp({
  projectId: import.meta.env.VITE_STACK_PROJECT_ID,
  publishableClientKey: import.meta.env.VITE_STACK_PUBLISHABLE_CLIENT_KEY,
  tokenStore: "cookie",
  redirectMethod: "window",
  oauthScopesOnSignIn: {
    google: [...GOOGLE_OAUTH_SCOPES],
    github: [...GITHUB_OAUTH_SCOPES],
  },
});
