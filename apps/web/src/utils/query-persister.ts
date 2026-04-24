import { experimental_createQueryPersister } from "@tanstack/react-query-persist-client";
import { get, set, del } from "idb-keyval";

function createIdbQueryPersister(prefix: string, maxAge: number) {
  return experimental_createQueryPersister({
    storage: { getItem: get, setItem: set, removeItem: del },
    maxAge,
    prefix,
  }).persisterFn;
}

export const queryPersister = createIdbQueryPersister(
  "gspot-",
  1000 * 60 * 60 * 24,
);
