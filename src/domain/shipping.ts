import type { CargoAttribute } from "./status";

/** One priced HioBuy route, in the customer's currency. */
export type RouteQuote = {
  routeCode: string;
  routeName: string;
  description: string;
  currency: "USD";
  estimatedMinFen: number;
  estimatedMaxFen: number;
  daysMin: number;
  daysMax: number;
  supportsTracking: boolean;
  doorToDoor: boolean;
  taxNote: string;
  cargoCapabilities: CargoAttribute[];
  restrictions: string;
};

export type QuoteFailure = {
  message: string;
  detail: string;
  packages: { publicId: string; cargo: CargoAttribute[] }[];
};
