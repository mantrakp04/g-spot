import { Button } from "@g-spot/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@g-spot/ui/components/dropdown-menu";
import { useStackApp, useUser } from "@stackframe/react";
import { BadgeCheck, ChevronsUpDown, Link2, LogOut } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { UserIdentity } from "@/components/user-identity";
import { clearDesktopAuthSession } from "@/lib/desktop-auth";

export function NavUser() {
  const user = useUser();
  const app = useStackApp();

  if (!user) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="h-auto w-full justify-start gap-2 px-2 py-1.5"
          >
            <UserIdentity user={user} />
            <ChevronsUpDown className="ml-auto size-4" />
          </Button>
        }
      />
      <DropdownMenuContent
        align="end"
        className="min-w-56"
        side="right"
        sideOffset={4}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="p-0 font-normal">
            <div className="flex items-center gap-2 px-2 py-2 text-left text-xs">
              <UserIdentity user={user} />
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            className="gap-2"
            render={<a href={app.urls.accountSettings} />}
          >
            <BadgeCheck />
            Account settings
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2"
            render={<Link to="/settings/connections" />}
          >
            <Link2 />
            Connected accounts
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2"
          onClick={() => {
            void clearDesktopAuthSession().finally(() => user.signOut());
          }}
          variant="destructive"
        >
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
