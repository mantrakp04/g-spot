import { afterEach, describe, expect, it, vi } from "vitest";

import { searchPiCatalog } from "./pi-catalog";

describe("searchPiCatalog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves npm search relevance instead of sorting by downloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const href = String(url);
        if (href.startsWith("https://registry.npmjs.org/-/v1/search")) {
          return Response.json({
            objects: [
              {
                package: {
                  name: "pi-agent-browser",
                  version: "1.0.0",
                  description: "Browser automation for Pi",
                  keywords: ["pi-package", "browser"],
                  date: "2026-01-01T00:00:00.000Z",
                  publisher: { username: "pi-user" },
                  links: { npm: "https://www.npmjs.com/package/pi-agent-browser" },
                },
                downloads: { monthly: 10 },
              },
              {
                package: {
                  name: "pi-markdown-preview",
                  version: "1.0.0",
                  description: "Markdown preview",
                  keywords: ["pi-package"],
                  date: "2026-01-02T00:00:00.000Z",
                  publisher: { username: "pi-user" },
                  links: { npm: "https://www.npmjs.com/package/pi-markdown-preview" },
                },
                downloads: { monthly: 10_000 },
              },
            ],
          });
        }

        return Response.json({
          pi: { extensions: ["./extension.ts"] },
        });
      }),
    );

    const results = await searchPiCatalog("browser", 2);

    expect(results.map((pkg) => pkg.name)).toEqual([
      "pi-agent-browser",
      "pi-markdown-preview",
    ]);
  });
});
