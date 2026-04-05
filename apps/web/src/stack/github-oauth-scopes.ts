/**
 * GitHub OAuth scopes for repository and organisation access.
 * `repo` grants read/write to private repos (needed for PR search & status checks).
 * `read:org` allows reading org membership and team review requests.
 * `user:email` is typically granted by default.
 */
export const GITHUB_OAUTH_SCOPES = [
  "repo",
  "read:org",
  "user:email",
] as const;
