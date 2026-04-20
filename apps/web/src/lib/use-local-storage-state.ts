import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

export function useLocalStorageState<T>(
  key: string,
  defaultValue: T,
  parse: (raw: string) => T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return defaultValue;
    const raw = window.localStorage.getItem(key);
    return raw == null ? defaultValue : parse(raw);
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, String(value));
  }, [key, value]);
  return [value, setValue];
}
