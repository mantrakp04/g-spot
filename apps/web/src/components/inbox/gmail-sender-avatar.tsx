import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@g-spot/ui/components/avatar";

import {
  getGmailSenderAvatarUrl,
  getGmailSenderInitials,
} from "@/lib/gmail/avatar";

type GmailSenderAvatarProps = {
  name: string;
  email: string;
  avatarUrl?: string | null;
  size?: "default" | "sm" | "lg";
  fallbackClassName?: string;
};

export function GmailSenderAvatar({
  name,
  email,
  avatarUrl,
  size = "default",
  fallbackClassName,
}: GmailSenderAvatarProps) {
  const resolvedAvatarUrl = avatarUrl ?? getGmailSenderAvatarUrl(email);

  return (
    <Avatar size={size}>
      <AvatarImage src={resolvedAvatarUrl ?? undefined} alt={name} />
      <AvatarFallback className={fallbackClassName}>
        {getGmailSenderInitials(name, email)}
      </AvatarFallback>
    </Avatar>
  );
}
