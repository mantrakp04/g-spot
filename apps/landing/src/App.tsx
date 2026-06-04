import { useEffect, useState } from "react";
import { Footer, Header } from "./components/chrome";
import { Home } from "./sections/home";
import { Privacy, Terms } from "./pages/legal";

function useHashRoute(): string {
  const [hash, setHash] = useState(() =>
    typeof window === "undefined" ? "" : window.location.hash.replace(/^#/, ""),
  );
  useEffect(() => {
    const onHash = () => setHash(window.location.hash.replace(/^#/, ""));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return hash;
}

export default function App() {
  const route = useHashRoute();
  const page =
    route === "terms" ? <Terms /> : route === "privacy" ? <Privacy /> : <Home />;

  return (
    <div className="min-h-svh bg-background text-foreground">
      <Header />
      <main className="container mx-auto max-w-3xl px-4 py-7 sm:py-10">
        {page}
      </main>
      <Footer />
    </div>
  );
}
