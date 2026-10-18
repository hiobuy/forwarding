import type { CargoAttribute, DisplayStatus } from "../domain/status";

/** `url` is set when a real image exists; older photos are placeholders. */
export type Photo = { id: string; type: string; label: string; url?: string | null; createdAt: string };

export type PackageItem = {
  id: string;
  publicId: string;
  domesticTrackingNumber: string;
  courier: string;
  receivedAt: string | null;
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  volumetricWeightGrams: number | null;
  cargoAttributes: CargoAttribute[];
  packageStatus: string;
  conditionStatus: "NORMAL" | "EXCEPTION";
  displayStatus: DisplayStatus;
  eligible: boolean;
  ineligibleReason: string | null;
  photoCount: number;
  photos: Photo[];
  productName: string | null;
  quantity: number | null;
  declaredValueFen: number | null;
  sellerPlatform: string | null;
  notes: string | null;
  freeStorageDays: number;
  /** Shelf location, e.g. A-01-03. */
  binLocation?: string | null;
  freeStorageRemainingDays: number | null;
  storageWarning: boolean;
  storageFeeFen: number;
  exception: null | {
    id: string;
    type: string;
    description: string;
    message: string;
    actions: { code: string; label: string }[];
  };
  vasRequests: {
    id: string;
    name: string;
    code: string;
    status: string;
    estimatedFen: number;
    finalFen: number | null;
    paymentState: string;
    note?: string | null;
    createdAt?: string;
    completedAt?: string | null;
  }[];
  timeline?: { at: string; title: string; detail: string }[];
  createdAt: string;
};

export type Page<T> = { items: T[]; page: number; pageSize: number; total: number };

export type ClaimItem = {
  id: string;
  domesticTrackingNumber: string;
  courier: string;
  receivedAt: string;
  weightGrams: number;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  photos: Photo[];
};

export type Address = {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string | null;
  company: string | null;
  phoneCode: string;
  phone: string;
  countryCode: string;
  regionCode: string | null;
  state: string;
  city: string;
  district: string | null;
  postalCode: string;
  addressLine1: string;
  addressLine2: string | null;
  isDefault: boolean;
};

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

export type QuoteResult = {
  quoteId?: string;
  expiresAt?: string;
  estimatedWeightGrams?: number;
  estimated?: boolean;
  routes: RouteQuote[];
  failure: null | { message: string; detail: string; packages: { publicId: string; cargo: CargoAttribute[] }[] };
  address?: Address;
};

export type Shipment = {
  id: string;
  publicId: string;
  status: string;
  displayStatus: DisplayStatus;
  createdAt: string;
  trackingNumber: string | null;
  canCancel: boolean;
  packingInstruction: string | null;
  packingNote: string | null;
  packageCount: number;
  packages: {
    id: string;
    publicId: string;
    domesticTrackingNumber: string | null;
    courier: string | null;
    weightGrams: number | null;
    lengthMm: number | null;
    widthMm: number | null;
    heightMm: number | null;
    cargoAttributes: CargoAttribute[];
  }[];
  destination: Omit<Address, "id" | "isDefault"> | null;
  shippingMethod: null | {
    routeCode: string;
    routeName: string;
    estimatedDaysMin: number;
    estimatedDaysMax: number;
    estimatedMinFen: number;
    estimatedMaxFen: number;
    currency: string;
    description: string;
  };
  finalWeightGrams: number | null;
  finalLengthMm: number | null;
  finalWidthMm: number | null;
  finalHeightMm: number | null;
  finalVolumetricWeightGrams: number | null;
  charges: { id: string; type: string; name: string; amountFen: number; currency: string; status: string }[];
  amountFen: number;
  photos: Photo[];
  timeline?: { at: string; title: string; detail: string }[];
  cartons: {
    id: string;
    code: string;
    status: string;
    weightGrams: number | null;
    lengthMm: number | null;
    widthMm: number | null;
    heightMm: number | null;
    trackingNumber: string | null;
    packages: { id: string; publicId: string; trackingNumber: string | null }[];
  }[];
};

export type Checkout = {
  id: string;
  status: string;
  currency: string;
  totalFen: number;
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
  items: { id: string; label: string; amountFen: number }[];
  walletBalanceFen: number;
  amountNeededFen: number;
};

export type WalletTx = {
  id: string;
  type: string;
  amountFen: number;
  currency: string;
  description: string;
  referenceId: string | null;
  createdAt: string;
};

export type Warehouse = {
  available: boolean;
  name: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  street: string;
  postalCode: string;
  country: string;
  hours: string;
  freeStorageDays: number;
  receivingRules: string[];
  prohibitedItems: string[];
  inboundNotes: string[];
  recipient: string;
  memberCode: string;
  fullAddress: string;
};

export type Attention = { tone: DisplayStatus["tone"]; title: string; body: string; href: string };

export type Dashboard = {
  warehouse: Warehouse;
  wallet: { balanceFen: number; currency: "USD"; lowBalance: boolean };
  counts: { toClaim: number; actionRequired: number; ready: number; toPay: number; inTransit: number; totalPackages: number };
  attention: Attention[];
  recentPackages: PackageItem[];
  recentShipments: Shipment[];
  recentTransactions: WalletTx[];
  unreadNotifications: number;
};
