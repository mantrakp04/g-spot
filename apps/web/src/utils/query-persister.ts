import { experimental_createQueryPersister } from "@tanstack/react-query-persist-client";
import { get, set, del } from "idb-keyval";

const persister = experimental_createQueryPersister({
  storage: { getItem: get, setItem: set, removeItem: del },
  maxAge: 1000 * 60 * 60 * 24, // 24h
  prefix: "gspot-",
});

export const queryPersister = persister.persisterFn;
