import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@g-spot/ui/components/avatar";
import { cn } from "@g-spot/ui/lib/utils";
import { getInitials } from "@/lib/initials";

export type UserIdentityUser = {
  displayName: string | null;
  primaryEmail: string | null;
  profileImageUrl: string | null;
};

export function userIdentityInitials(user: UserIdentityUser) {
  return getInitials(user.displayName, user.primaryEmail);
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const visible = local.slice(0, Math.min(3, local.length));
  return `${visible}***@${domain}`;
}

function linesForUser(user: UserIdentityUser) {
  const hasDisplayName = Boolean(user.displayName?.trim());
  const primary =
    user.displayName?.trim() || user.primaryEmail || "Account";
  const secondary =
    hasDisplayName && user.primaryEmail ? maskEmail(user.primaryEmail) : null;
  return { primary, secondary };
}

type UserIdentityProps = {
  user: UserIdentityUser;
  className?: string;
};

export function UserIdentity({
  user,
  className,
}: UserIdentityProps) {
  const { primary, secondary } = linesForUser(user);

  return (
    <>
      <Avatar className="size-8 shrink-0">
        <AvatarImage alt="" src={user.profileImageUrl ?? undefined} />
        <AvatarFallback>{userIdentityInitials(user)}</AvatarFallback>
      </Avatar>
      <div
        className={cn(
          "grid min-w-0 flex-1 text-left text-sm leading-tight",
          className,
        )}
      >
        <span className="truncate font-semibold">{primary}</span>
        {secondary ? (
          <span className="truncate text-xs text-muted-foreground">
            {secondary}
          </span>
        ) : null}
      </div>
    </>
  );
}
