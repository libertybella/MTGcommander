import { CardDatabase, type HttpFetch } from "@mtgcommander/server";
import { browserStore } from "./storage";

export function hostFetch(): HttpFetch {
  const electronFetch = window.mtgCommander?.httpFetch;
  if (electronFetch) {
    return electronFetch;
  }
  return async (url, init) => fetch(url, init);
}

export function cardDatabase(): CardDatabase {
  return new CardDatabase(hostFetch(), browserStore());
}
