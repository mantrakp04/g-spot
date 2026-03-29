import { Skeleton } from "@g-spot/ui/components/skeleton";
import { Table, TableBody, TableCell, TableRow } from "@g-spot/ui/components/table";

export function SectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <Table>
      <TableBody>
        {Array.from({ length: rows }, (_, i) => (
          <TableRow key={i} className="pointer-events-none">
            <TableCell className="w-full pl-3">
              <div className="flex items-center gap-2.5">
                <Skeleton className="size-1.5 rounded-full" />
                <Skeleton className="size-6 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
            </TableCell>
            <TableCell className="hidden md:table-cell">
              <div className="flex -space-x-1">
                <Skeleton className="size-6 rounded-full" />
                <Skeleton className="size-6 rounded-full" />
              </div>
            </TableCell>
            <TableCell className="hidden sm:table-cell">
              <Skeleton className="mx-auto size-3.5 rounded-full" />
            </TableCell>
            <TableCell className="hidden sm:table-cell">
              <Skeleton className="mx-auto size-3.5 rounded-full" />
            </TableCell>
            <TableCell className="hidden lg:table-cell">
              <Skeleton className="h-3 w-14" />
            </TableCell>
            <TableCell className="pr-3 text-right">
              <Skeleton className="ml-auto h-3 w-6" />
            </TableCell>
            <TableCell className="w-8 pr-3" />
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
