import { CircleDot, GitPullRequest, Mail } from "lucide-react";

type SectionEmptyProps = {
  source: "github_pr" | "github_issue" | "gmail";
  message?: string;
};

export function SectionEmpty({ source, message }: SectionEmptyProps) {
  const Icon =
    source === "github_pr"
      ? GitPullRequest
      : source === "github_issue"
        ? CircleDot
        : Mail;
  const defaultMessage =
    source === "github_pr"
      ? "No pull requests found"
      : source === "github_issue"
        ? "No issues found"
        : "No email threads found";

  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
      <Icon className="size-6" strokeWidth={1.5} />
      <p className="text-sm">{message ?? defaultMessage}</p>
    </div>
  );
}
