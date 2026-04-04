import { env } from "@g-spot/env/web";
import { getInitials } from "@/lib/oauth";

const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "yahoo.com", "yahoo.co.uk", "ymail.com",
  "hotmail.com", "outlook.com", "live.com", "msn.com",
  "aol.com", "icloud.com", "me.com", "mac.com",
  "protonmail.com", "proton.me", "pm.me",
  "mail.com", "zoho.com", "gmx.com", "gmx.net",
  "yandex.com", "yandex.ru", "tutanota.com", "tuta.io",
]);

function getRootDomain(domain: string): string {
  const parts = domain.split(".");
  if (parts.length <= 2) return domain;

  const sld = parts[parts.length - 2];
  if (sld.length <= 3 && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }

  return parts.slice(-2).join(".");
}

export function getGmailSenderAvatarUrl(email: string): string | null {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;

  const root = getRootDomain(domain);
  if (PERSONAL_DOMAINS.has(root)) return null;

  return `${env.VITE_SERVER_URL}/api/favicon/${encodeURIComponent(root)}`;
}

export function getGmailSenderInitials(name: string, email?: string): string {
  return getInitials(name, email);
}
