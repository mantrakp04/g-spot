import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@g-spot/ui/components/card";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { CreateProjectForm } from "@/components/projects/create-project-form";

export const Route = createFileRoute("/projects/new")({
  component: NewProjectPage,
});

function NewProjectPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="container mx-auto max-w-2xl space-y-8 px-4 py-12">
        <Link
          to="/projects"
          className="inline-flex items-center gap-1.5 text-muted-foreground text-xs transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Back to projects
        </Link>

        <Card>
          <CardHeader>
            <CardTitle>New project</CardTitle>
            <CardDescription>
              A project pins the Pi agent to a specific filesystem directory and
              gives every chat inside it the same custom instructions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateProjectForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
