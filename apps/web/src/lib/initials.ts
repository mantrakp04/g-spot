/** Compute display initials from a name/email pair. */
export function getInitials(name?: string | null, email?: string | null): string {
  const trimmed = name?.trim();
  if (trimmed) {
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      const a = parts[0]?.[0] ?? "";
      const b = parts[parts.length - 1]?.[0] ?? "";
      return `${a}${b}`.toUpperCase();
    }
    return trimmed.slice(0, 2).toUpperCase();
  }
  const emailTrimmed = email?.trim();
  if (emailTrimmed) return emailTrimmed.slice(0, 2).toUpperCase();
  return "?";
}
