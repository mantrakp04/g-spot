import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@g-spot/ui/components/resizable";
import { Toaster } from "@g-spot/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { HeadContent, Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider, ThemeScript } from "@/components/tweakcn-theme-provider";
import type { trpc } from "@/utils/trpc";

import "../index.css";

export interface RouterAppContext {
  trpc: typeof trpc;
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  head: () => ({
    meta: [
      {
        title: "g-spot",
      },
      {
        name: "description",
        content: "g-spot is a web application",
      },
    ],
    links: [
      {
        rel: "icon",
        type: "image/png",
        href: "/logo.png",
      },
    ],
  }),
});

function RootComponent() {
  return (
    <>
      <HeadContent />
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
      >
        <ResizablePanelGroup orientation="horizontal" className="h-full">
          <ResizablePanel defaultSize="15" minSize="10" maxSize="25">
            <AppSidebar />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="85" className="overflow-hidden">
            <Outlet />
          </ResizablePanel>
        </ResizablePanelGroup>
        <Toaster richColors />
      </ThemeProvider>
      <TanStackRouterDevtools position="bottom-right" />
      <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
    </>
  );
}
