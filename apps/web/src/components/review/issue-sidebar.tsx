import {
  SidebarAddButton,
  SidebarEmpty,
  SidebarSection,
} from "./sidebar-section";
import { StateBadge } from "./state-badge";

type Actor = { login: string; avatarUrl: string };

export function IssueSidebar({
  state,
  stateReason,
  author,
  assignees,
  labels,
  milestone,
}: {
  state: "open" | "closed";
  stateReason: string | null;
  author: Actor | null;
  assignees: Actor[];
  labels: Array<{ name: string; color: string }>;
  milestone: string | null;
}) {
  return (
    <div>
      <div className="mb-3 rounded-md border border-border/50 bg-card p-3">
        <StateBadge kind="issue" state={state} stateReason={stateReason} />
      </div>

      <SidebarSection label="Assignees" action={<SidebarAddButton />}>
        {assignees.length > 0 ? (
          <ul className="space-y-1">
            {assignees.map((a) => (
              <UserRow key={a.login} user={a} />
            ))}
          </ul>
        ) : (
          <SidebarEmpty>No one assigned</SidebarEmpty>
        )}
      </SidebarSection>

      <SidebarSection label="Labels" action={<SidebarAddButton />}>
        {labels.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {labels.map((l) => (
              <span
                key={l.name}
                className="rounded-md px-2 py-0.5 text-[11px]"
                style={{
                  background: `#${l.color}22`,
                  color: `#${l.color}`,
                }}
              >
                {l.name}
              </span>
            ))}
          </div>
        ) : (
          <SidebarEmpty>No labels</SidebarEmpty>
        )}
      </SidebarSection>

      {milestone ? (
        <SidebarSection label="Milestone">
          <div className="text-[12px]">{milestone}</div>
        </SidebarSection>
      ) : null}

      {author ? (
        <SidebarSection label="Author">
          <UserRow user={author} />
        </SidebarSection>
      ) : null}
    </div>
  );
}

function UserRow({ user }: { user: Actor }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      {user.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.avatarUrl} alt="" className="size-5 rounded-full" />
      ) : (
        <span className="size-5 rounded-full bg-border" />
      )}
      <span className="truncate">{user.login}</span>
    </div>
  );
}
