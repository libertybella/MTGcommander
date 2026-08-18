import { HIDDEN_DEFINITION_ID } from "@mtgcommander/engine";

export function cardArtUrl(def: { id: string; name: string; imageUrl?: string }): string | null {
  if (def.imageUrl) {
    return def.imageUrl;
  }
  if (def.id === HIDDEN_DEFINITION_ID || def.name === "Unknown Card") {
    return null;
  }
  if (def.id.startsWith("oracle:")) {
    return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(def.name)}&format=image`;
  }
  return null;
}
