import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Check } from "lucide-react";

type TourStepProps = {
  icon: LucideIcon;
  title: string;
  tagline: string;
  description: string;
  bullets: string[];
  visual?: ReactNode;
};

export function TourStep({
  icon: Icon,
  title,
  tagline,
  description,
  bullets,
  visual,
}: TourStepProps) {
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:items-center">
      <div className="space-y-6">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{tagline}</p>
          </div>
        </div>
        <p className="text-sm leading-7 text-muted-foreground">{description}</p>
        <ul className="space-y-2">
          {bullets.map((bullet) => (
            <li key={bullet} className="flex items-start gap-2 text-sm">
              <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      </div>
      {visual ? (
        <div className="relative flex min-h-[280px] items-center justify-center">
          {visual}
        </div>
      ) : null}
    </div>
  );
}
