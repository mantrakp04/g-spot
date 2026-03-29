import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@g-spot/ui/components/avatar";
import { cn } from "@g-spot/ui/lib/utils";

export type UserIdentityUser = {
  displayName: string | null;
  primaryEmail: string | null;
  profileImageUrl: string | null;
};

export function userIdentityInitials(user: UserIdentityUser) {
  const name = user.displayName?.trim();
  if (name) {
    const parts = name.split(/\s+/);
    if (parts.length >= 2) {
      const a = parts[0]?.[0];
      const b = parts[parts.length - 1]?.[0];
      return `${a ?? ""}${b ?? ""}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  if (user.primaryEmail) return user.primaryEmail.slice(0, 2).toUpperCase();
  return "?";
}

function linesForUser(user: UserIdentityUser) {
  const hasDisplayName = Boolean(user.displayName?.trim());
  const primary =
    user.displayName?.trim() || user.primaryEmail || "Account";
  const secondary =
    hasDisplayName && user.primaryEmail ? user.primaryEmail : null;
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
