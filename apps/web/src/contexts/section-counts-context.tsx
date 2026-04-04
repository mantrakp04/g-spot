import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type SectionCountsState = Record<string, number>;

type SectionCountsContextValue = {
  counts: SectionCountsState;
  setCount: (sectionId: string, count: number) => void;
};

const SectionCountsContext = createContext<SectionCountsContextValue | null>(null);

export function SectionCountsProvider({ children }: { children: ReactNode }) {
  const [counts, setCounts] = useState<SectionCountsState>({});

  const setCount = useCallback((sectionId: string, count: number) => {
    setCounts((prev) => {
      if (prev[sectionId] === count) return prev;
      return { ...prev, [sectionId]: count };
    });
  }, []);

  return (
    <SectionCountsContext.Provider value={{ counts, setCount }}>
      {children}
    </SectionCountsContext.Provider>
  );
}

export function useSectionCounts() {
  const ctx = useContext(SectionCountsContext);
  if (!ctx) throw new Error("useSectionCounts must be used within SectionCountsProvider");
  return ctx;
}
