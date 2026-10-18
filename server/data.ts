import { and, desc, eq, inArray } from "drizzle-orm";
import { isKnownDial } from "../src/domain/calling-codes";
import { countryName, dialFor, isCountryCode, splitInternationalPhone, splitPersonName } from "../src/domain/countries";
import { type RouteQuote } from "../src/domain/shipping";
import {
  CARGO_ATTRIBUTES,
  getPackageDisplayStatus,
  packageEligibility,
  customerShipmentDisplay,
  customerShipmentMatches,
  type CargoAttribute,
  type CustomerShipmentStatus,
  type PackageState,
} from "../src/domain/status";
import { volumetricGrams } from "../src/domain/units";
import { vasCatalog } from "../src/mocks/vas";
import { customerReceivingLine } from "../src/domain/warehouse-location";
import { warehouseProfile } from "../src/mocks/warehouse";
import { appConfig, exceptionActions } from "./config";
import { liveShipmentRoutes } from "./calculator";
import { customerWarehouse, fulfillmentConnected, listOpenDestinations } from "./freight";
import { recognizeCheckoutPayment } from "./earnings";
import type { Database } from "./db/client";
import {
  addresses,
  cartons,
  charges,
  checkouts,
  checkoutItems,
  claims,
  emailOutbox,
  fulfillmentRemoteLinks,
  fulfillmentSyncAttempts,
  fulfillmentSyncTasks,
  idempotencyKeys,
  notificationPreferences,
  notifications,
  packageAttributes,
  cartonPackages,
  packageExceptions,
  packagePhotos,
  packages,
  payments,
  shipmentAddresses,
  shipmentMethods,
  shipmentPackages,
  shipments,
  shippingQuotes,
  unclaimedParcels,
  vasRequests,
  walletTransactions,
  wallets,
} from "./db/schema";
import { movePhotosToPackage, photoUrl } from "./photos";
import { AppError, logEvent } from "./errors";
import { allocateNumber } from "./numbering";
import { moveWallet } from "./wallet";

const day = 24 * 60 * 60 * 1000;

/** Columns every new package row starts with. */
const NEW_PACKAGE_STATE = {
  conditionStatus: "NORMAL",
  exceptionStatus: "NONE",
  vasStatus: "NONE",
  lockStatus: "AVAILABLE",
  disposition: "NONE",
} as const;

type UserRef = { id: string; name: string; email: string; memberCode: string; phone: string | null; country: string | null };

function asCargo(value: string): CargoAttribute {
  return (CARGO_ATTRIBUTES as readonly string[]).includes(value) ? (value as CargoAttribute) : "GENERAL";
}

function packageState(row: typeof packages.$inferSelect): PackageState {
  return {
    packageStatus: row.packageStatus as PackageState["packageStatus"],
    conditionStatus: row.conditionStatus === "EXCEPTION" ? "EXCEPTION" : "NORMAL",
    exceptionStatus: row.exceptionStatus as PackageState["exceptionStatus"],
    vasStatus: row.vasStatus as PackageState["vasStatus"],
    lockStatus: row.lockStatus as PackageState["lockStatus"],
    disposition: row.disposition as PackageState["disposition"],
  };
}

function storageOf(receivedAt: number | null, now: number) {
  if (receivedAt == null) {
    return { freeStorageRemainingDays: null, storageWarning: false, storageFeeFen: 0 };
  }
  const remaining = Math.ceil((receivedAt + appConfig.freeStorageDays * day - now) / day);
  const overdue = remaining < 0 ? -remaining : 0;
  return {
    freeStorageRemainingDays: remaining,
    storageWarning: remaining <= 7,
    storageFeeFen: overdue * appConfig.storageFeeFenPerDay,
  };
}

async function readIdempotent(db: Database, userId: string, operation: string, key: string | null) {
  if (!key) return null;
  const rows = await db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.operation, operation), eq(idempotencyKeys.key, key)));
  return rows[0] ? (JSON.parse(rows[0].responseJson) as unknown) : null;
}

async function saveIdempotent(db: Database, userId: string, operation: string, key: string | null, response: unknown) {
  if (!key) return;
  await db.insert(idempotencyKeys).values({
    id: crypto.randomUUID(),
    userId,
    operation,
    key,
    responseJson: JSON.stringify(response),
    createdAt: Date.now(),
  });
}

/** Packages with their attributes, photos, exceptions and services. `null` loads every customer's packages (admin). `ids` limits the rows before related data is loaded. */
export async function loadPackageGraph(db: Database, userId: string | null, onlyIds?: string[]) {
  if (onlyIds && onlyIds.length === 0) return [];
  const where = userId
    ? onlyIds
      ? and(eq(packages.userId, userId), inArray(packages.id, onlyIds))
      : eq(packages.userId, userId)
    : onlyIds
      ? inArray(packages.id, onlyIds)
      : undefined;
  const rows = await db.select().from(packages).where(where);
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return [];
  const [attrs, photos, exceptions, vas] = await Promise.all([
    db.select().from(packageAttributes).where(inArray(packageAttributes.packageId, ids)),
    db.select().from(packagePhotos).where(inArray(packagePhotos.packageId, ids)),
    db.select().from(packageExceptions).where(inArray(packageExceptions.packageId, ids)),
    db.select().from(vasRequests).where(inArray(vasRequests.packageId, ids)),
  ]);
  const now = Date.now();
  return rows
    .map((row) => {
      const cargo = attrs.filter((item) => item.packageId === row.id).map((item) => asCargo(item.attribute));
      const state = packageState(row);
      const eligibility = packageEligibility(state);
      const storage = storageOf(row.receivedAt, now);
      const openException = exceptions.find((item) => item.packageId === row.id && item.status === "OPEN") ?? null;
      return {
        id: row.id,
        ownerId: row.userId,
        publicId: row.publicId,
        domesticTrackingNumber: row.domesticTrackingNumber,
        courier: row.courier,
        receivedAt: row.receivedAt ? new Date(row.receivedAt).toISOString() : null,
        weightGrams: row.weightGrams,
        lengthMm: row.lengthMm,
        widthMm: row.widthMm,
        heightMm: row.heightMm,
        volumetricWeightGrams:
          row.lengthMm && row.widthMm && row.heightMm ? volumetricGrams(row.lengthMm, row.widthMm, row.heightMm) : null,
        cargoAttributes: cargo.length ? cargo : (["GENERAL"] as CargoAttribute[]),
        displayStatus: getPackageDisplayStatus(state),
        packageStatus: state.packageStatus,
        conditionStatus: state.conditionStatus,
        disposition: state.disposition,
        remotePackageId: row.hiobuyPackageId,
        hiobuyStatus: row.hiobuySyncedAt ? row.hiobuyStatus : null,
        hiobuySyncedAt: row.hiobuySyncedAt ? new Date(row.hiobuySyncedAt).toISOString() : null,
        eligible: eligibility.eligible,
        ineligibleReason: eligibility.reason,
        photoCount: photos.filter((item) => item.packageId === row.id).length,
        photos: photos
          .filter((item) => item.packageId === row.id)
          .map((item) => ({ id: item.id, type: item.type, label: item.label, url: photoUrl(item), createdAt: new Date(item.createdAt).toISOString() })),
        productName: row.productName,
        quantity: row.quantity,
        declaredValueFen: row.declaredValueFen,
        sellerPlatform: row.sellerPlatform,
        notes: row.notes,
        freeStorageDays: appConfig.freeStorageDays,
        binLocation: row.binLocation,
        ...storage,
        exception: openException
          ? {
              id: openException.id,
              type: openException.type,
              description: openException.description,
              message: openException.message,
              actions: exceptionActions,
            }
          : null,
        vasRequests: vas
          .filter((item) => item.packageId === row.id)
          .map((item) => ({
            id: item.id,
            name: item.serviceName,
            code: item.serviceCode,
            status: item.status,
            estimatedFen: item.estimatedFen,
            finalFen: item.finalFen,
            paymentState: item.paymentState,
            note: item.note,
            createdAt: new Date(item.createdAt).toISOString(),
            completedAt: item.completedAt ? new Date(item.completedAt).toISOString() : null,
          })),
        timeline: packageTimeline(row, exceptions.filter((item) => item.packageId === row.id), vas.filter((item) => item.packageId === row.id), photos.filter((item) => item.packageId === row.id)),
        createdAt: new Date(row.createdAt).toISOString(),
        updatedAt: row.updatedAt,
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function addressDto(row: typeof addresses.$inferSelect) {
  const named = row.firstName.trim() || row.lastName.trim() ? { firstName: row.firstName.trim(), lastName: row.lastName.trim() } : splitPersonName(row.name);
  const dialed = row.phoneCode.trim() ? { phoneCode: row.phoneCode.trim(), phone: row.phone.trim() } : splitInternationalPhone(row.phone, dialFor(row.countryCode));
  const name = `${named.firstName} ${named.lastName}`.trim() || row.name;
  return {
    id: row.id,
    name,
    firstName: named.firstName,
    lastName: named.lastName,
    email: row.email,
    company: row.company,
    phoneCode: dialed.phoneCode,
    phone: dialed.phone,
    countryCode: row.countryCode,
    regionCode: row.regionCode,
    state: row.state,
    city: row.city,
    district: row.district,
    postalCode: row.postalCode,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    isDefault: row.isDefault,
  };
}

/** Shipments with packages, address, method and charges. `null` loads every customer's shipments (admin). `ids` limits the rows before related data is loaded. */
export async function loadShipments(db: Database, userId: string | null, onlyIds?: string[]) {
  if (onlyIds && onlyIds.length === 0) return [];
  const where = userId
    ? onlyIds
      ? and(eq(shipments.userId, userId), inArray(shipments.id, onlyIds))
      : eq(shipments.userId, userId)
    : onlyIds
      ? inArray(shipments.id, onlyIds)
      : undefined;
  const rows = await db.select().from(shipments).where(where);
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [links, addressRows, methods, chargeRows, photoRows, cartonRows, packageRows, attributeRows] = await Promise.all([
    db.select().from(shipmentPackages).where(inArray(shipmentPackages.shipmentId, ids)),
    db.select().from(shipmentAddresses).where(inArray(shipmentAddresses.shipmentId, ids)),
    db.select().from(shipmentMethods).where(inArray(shipmentMethods.shipmentId, ids)),
    db.select().from(charges).where(inArray(charges.shipmentId, ids)),
    db.select().from(packagePhotos).where(inArray(packagePhotos.shipmentId, ids)),
    db.select().from(cartons).where(inArray(cartons.shipmentId, ids)),
    db.select().from(packages).where(userId ? eq(packages.userId, userId) : inArray(packages.id, db.select({ id: shipmentPackages.packageId }).from(shipmentPackages).where(inArray(shipmentPackages.shipmentId, ids)))),
    db.select().from(packageAttributes).where(inArray(packageAttributes.packageId, db.select({ id: shipmentPackages.packageId }).from(shipmentPackages).where(inArray(shipmentPackages.shipmentId, ids)))),
  ]);
  const cartonIds = cartonRows.map((row) => row.id);
  const cartonContents = cartonIds.length ? await db.select().from(cartonPackages).where(inArray(cartonPackages.cartonId, cartonIds)) : [];
  return rows
    .map((row) => {
      const status = row.status as CustomerShipmentStatus;
      const included = links.filter((link) => link.shipmentId === row.id);
      const address = addressRows.find((item) => item.shipmentId === row.id) ?? null;
      const method = methods.find((item) => item.shipmentId === row.id) ?? null;
      const shipmentCharges = chargeRows.filter((item) => item.shipmentId === row.id);
      const due = shipmentCharges.filter((item) => item.status === "DUE").reduce((sum, item) => sum + item.amountFen, 0);
      const paid = shipmentCharges.filter((item) => item.status === "PAID").reduce((sum, item) => sum + item.amountFen, 0);
      return {
        id: row.id,
        ownerId: row.userId,
        publicId: row.publicId,
        status,
        displayStatus: customerShipmentDisplay({ status, upstreamStatus: row.hiobuyShipmentId ? row.upstreamStatus : null, linked: Boolean(row.hiobuyShipmentId) }),
        hiobuyShipmentId: row.hiobuyShipmentId,
        hiobuyStatus: row.hiobuyShipmentId ? row.upstreamStatus : null,
        hiobuyPaymentStatus: row.hiobuyPaymentStatus,
        interceptionStatus: row.interceptionStatus,
        hiobuySyncedAt: row.hiobuySyncedAt ? new Date(row.hiobuySyncedAt).toISOString() : null,
        createdAt: new Date(row.createdAt).toISOString(),
        updatedAt: row.updatedAt,
        trackingNumber: row.trackingNumber,
        canCancel: row.canCancel,
        packingInstruction: row.packingInstruction,
        packingNote: row.packingNote,
        packageCount: included.length,
        packages: included.map((link) => {
          const pkg = packageRows.find((item) => item.id === link.packageId);
          const cargo = attributeRows.filter((item) => item.packageId === link.packageId).map((item) => asCargo(item.attribute));
          return {
            id: link.packageId,
            publicId: pkg?.publicId ?? link.packageId,
            domesticTrackingNumber: pkg?.domesticTrackingNumber ?? null,
            courier: pkg?.courier ?? null,
            weightGrams: pkg?.weightGrams ?? null,
            lengthMm: pkg?.lengthMm ?? null,
            widthMm: pkg?.widthMm ?? null,
            heightMm: pkg?.heightMm ?? null,
            cargoAttributes: cargo.length ? cargo : (["GENERAL"] as CargoAttribute[]),
          };
        }),
        destination: address
          ? {
              name: address.name,
              phone: address.phone,
              countryCode: address.countryCode,
              state: address.state,
              city: address.city,
              district: address.district,
              postalCode: address.postalCode,
              addressLine1: address.addressLine1,
              addressLine2: address.addressLine2,
            }
          : null,
        shippingMethod: method
          ? {
              routeCode: method.routeCode,
              routeName: method.routeName,
              estimatedDaysMin: method.estimatedDaysMin,
              estimatedDaysMax: method.estimatedDaysMax,
              estimatedMinFen: method.estimatedMinFen,
              estimatedMaxFen: method.estimatedMaxFen,
              currency: method.currency,
              description: method.description,
            }
          : null,
        finalWeightGrams: row.finalWeightGrams,
        finalLengthMm: row.finalLengthMm,
        finalWidthMm: row.finalWidthMm,
        finalHeightMm: row.finalHeightMm,
        finalVolumetricWeightGrams:
          row.finalLengthMm && row.finalWidthMm && row.finalHeightMm
            ? volumetricGrams(row.finalLengthMm, row.finalWidthMm, row.finalHeightMm)
            : null,
        charges: shipmentCharges.map((item) => ({
          id: item.id,
          type: item.type,
          name: item.name,
          amountFen: item.amountFen,
          currency: item.currency,
          status: item.status,
        })),
        amountFen: due || paid,
        photos: photoRows
          .filter((item) => item.shipmentId === row.id)
          .map((item) => ({ id: item.id, type: item.type, label: item.label, url: photoUrl(item), createdAt: new Date(item.createdAt).toISOString() })),
        cartons: cartonRows
          .filter((item) => item.shipmentId === row.id)
          .map((item) => ({
            id: item.id,
            code: item.code,
            status: item.status,
            weightGrams: item.weightGrams,
            lengthMm: item.lengthMm,
            widthMm: item.widthMm,
            heightMm: item.heightMm,
            trackingNumber: item.trackingNumber,
            packages: cartonContents
              .filter((link) => link.cartonId === item.id)
              .map((link) => {
                const pkg = packageRows.find((row) => row.id === link.packageId);
                return { id: link.packageId, publicId: pkg?.publicId ?? link.packageId, trackingNumber: pkg?.domesticTrackingNumber ?? null };
              }),
          })),
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getWarehouse(db: Database, user: UserRef) {
  const place = await customerWarehouse(db);
  const memberCode = user.memberCode;
  const recipient = customerReceivingLine(place.synced ? place.recipient : "", memberCode);
  if (!place.synced) {
    return {
      available: false as const,
      memberCode,
      recipient,
      name: "",
      phone: "",
      province: "",
      city: "",
      district: "",
      street: "",
      postalCode: "",
      country: "",
      hours: "",
      freeStorageDays: warehouseProfile.freeStorageDays,
      receivingRules: warehouseProfile.receivingRules,
      prohibitedItems: warehouseProfile.prohibitedItems,
      inboundNotes: warehouseProfile.inboundNotes,
      fullAddress: "",
    };
  }
  const notes = place.notice ? [place.notice, ...place.inboundNotes] : place.inboundNotes;
  const street = customerReceivingLine(place.street, memberCode);
  const fullAddress = [
    `Recipient: ${recipient}`,
    `Phone: ${place.phone}`,
    street,
    `${place.district}, ${place.city}, ${place.province}`,
    place.postalCode,
    place.country,
  ].join("\n");
  return { available: true as const, ...place, street, inboundNotes: notes, recipient, memberCode, fullAddress };
}

function packageTimeline(
  row: { createdAt: number; receivedAt: number | null },
  exceptions: { type: string; status: string; createdAt: number }[],
  requests: { serviceName: string; createdAt: number; completedAt: number | null }[],
  photos: { createdAt: number }[],
) {
  const events: { at: string; title: string; detail: string }[] = [
    { at: new Date(row.createdAt).toISOString(), title: "Package added", detail: "In transit to the warehouse." },
  ];
  if (row.receivedAt) events.push({ at: new Date(row.receivedAt).toISOString(), title: "Received at the warehouse", detail: "The parcel is in the warehouse." });
  for (const exception of exceptions) {
    events.push({
      at: new Date(exception.createdAt).toISOString(),
      title: exception.type,
      detail: exception.status === "OPEN" ? "Waiting for your decision." : "This exception is closed.",
    });
  }
  for (const request of requests) {
    events.push({ at: new Date(request.createdAt).toISOString(), title: `${request.serviceName} requested`, detail: "The warehouse will handle this before shipping." });
    if (request.completedAt) events.push({ at: new Date(request.completedAt).toISOString(), title: `${request.serviceName} finished`, detail: "The service is done." });
  }
  if (photos.length) {
    const latest = Math.max(...photos.map((photo) => photo.createdAt));
    events.push({ at: new Date(latest).toISOString(), title: "Warehouse photos added", detail: photos.length === 1 ? "1 photo" : `${photos.length} photos` });
  }
  return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

function customerPackage<T extends { updatedAt: number; hiobuyStatus: string | null; hiobuySyncedAt: string | null; remotePackageId: string | null }>(item: T) {
  const { updatedAt: _updated, hiobuyStatus: _status, hiobuySyncedAt: _synced, remotePackageId: _remote, ...dto } = item;
  return dto;
}

export async function listPackages(db: Database, userId: string, filter: string, query: string, page: number, pageSize: number) {
  const all = await loadPackageGraph(db, userId);
  const q = query.trim().toLowerCase();
  const filtered = all.filter((item) => {
    const statusOk = filter === "all" || filter === "" || (filter === "exception" ? item.conditionStatus === "EXCEPTION" : item.displayStatus.key === filter);
    const text = `${item.publicId} ${item.domesticTrackingNumber} ${item.productName ?? ""}`.toLowerCase();
    return statusOk && (!q || text.includes(q));
  });
  const start = (page - 1) * pageSize;
  return { items: filtered.slice(start, start + pageSize).map((item) => customerPackage(item)), page, pageSize, total: filtered.length };
}

export async function getPackage(db: Database, userId: string, id: string, envToken?: string) {
  try {
    const { refreshPackageMedia } = await import("./fulfillment-sync");
    await refreshPackageMedia(db, id, envToken);
  } catch (error) {
    logEvent({ level: "error", message: "Could not refresh package photos", detail: error instanceof Error ? error.message : "unknown" });
  }
  const all = await loadPackageGraph(db, userId);
  const item = all.find((pkg) => pkg.id === id);
  if (!item) throw new AppError("NOT_FOUND", "Package not found.", 404);
  const dto = customerPackage(item);
  return { ...dto, timeline: await packageActivity(db, item.id, "customer", item.timeline) };
}

type PrealertInput = {
  courier: string;
  trackingNumber: string;
  productName?: string;
  quantity?: number;
  declaredValueFen?: number;
  platform?: string;
  notes?: string;
};

export async function createPrealerts(db: Database, userId: string, items: PrealertInput[]) {
  if (items.length === 0) throw new AppError("VALIDATION_ERROR", "Enter at least one tracking number.");
  if (items.length > 30) throw new AppError("VALIDATION_ERROR", "You can pre-alert up to 30 tracking numbers at once.");
  const wanted = items.map((item) => item.trackingNumber.trim().toUpperCase());
  const existing = await db
    .select({ tracking: packages.domesticTrackingNumber })
    .from(packages)
    .where(inArray(packages.domesticTrackingNumber, wanted));
  const taken = new Set(existing.map((row) => row.tracking.toUpperCase()));
  const now = Date.now();
  const createdIds: string[] = [];
  const skipped: { trackingNumber: string; message: string }[] = [];

  for (const item of items) {
    const tracking = item.trackingNumber.trim().toUpperCase();
    if (taken.has(tracking)) {
      skipped.push({ trackingNumber: tracking, message: "This tracking number is already used." });
      continue;
    }
    taken.add(tracking);
    const id = crypto.randomUUID();
    createdIds.push(id);
    await db.insert(packages).values({
      id,
      userId,
      publicId: await allocateNumber(db, "package"),
      domesticTrackingNumber: tracking,
      courier: item.courier,
      packageStatus: "PENDING",
      ...NEW_PACKAGE_STATE,
      productName: item.productName ?? null,
      quantity: item.quantity ?? null,
      declaredValueFen: item.declaredValueFen ?? null,
      sellerPlatform: item.platform ?? null,
      notes: item.notes ?? null,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(packageAttributes).values({ id: crypto.randomUUID(), packageId: id, attribute: "GENERAL" });
  }

  if (createdIds.length === 0) {
    throw new AppError("DUPLICATE_TRACKING", "This tracking number is already used.", 409, { skipped });
  }
  try {
    const { enqueueInboundNotices } = await import("./fulfillment-sync");
    await enqueueInboundNotices(db, createdIds);
  } catch (error) {
    logEvent({ level: "error", message: "Could not queue package sync", detail: error instanceof Error ? error.message : "unknown" });
  }
  const all = await loadPackageGraph(db, userId);
  return {
    created: all.filter((item) => createdIds.includes(item.id)).map((item) => customerPackage(item)),
    skipped,
  };
}

export async function listClaims(db: Database, userId: string) {
  const rows = await db.select().from(claims).where(and(eq(claims.userId, userId), eq(claims.status, "PENDING")));
  const unclaimedIds = rows.map((row) => row.unclaimedId).filter((id): id is string => Boolean(id));
  const realPhotos = unclaimedIds.length ? await db.select().from(packagePhotos).where(inArray(packagePhotos.unclaimedId, unclaimedIds)) : [];
  return rows.map((row) => ({
    id: row.id,
    domesticTrackingNumber: row.trackingNumber,
    courier: row.courier,
    receivedAt: new Date(row.receivedAt).toISOString(),
    weightGrams: row.weightGrams,
    lengthMm: row.lengthMm,
    widthMm: row.widthMm,
    heightMm: row.heightMm,
    photos: realPhotos.some((photo) => photo.unclaimedId === row.unclaimedId)
      ? realPhotos
          .filter((photo) => photo.unclaimedId === row.unclaimedId)
          .map((photo) => ({ id: photo.id, type: photo.type, label: photo.label, url: photoUrl(photo), createdAt: new Date(photo.createdAt).toISOString() }))
      : [{ id: `${row.id}-photo`, type: "INBOUND", label: "Warehouse receiving photo", url: null, createdAt: new Date(row.receivedAt).toISOString() }],
  }));
}

export async function confirmClaim(db: Database, userId: string, claimId: string) {
  const rows = await db.select().from(claims).where(and(eq(claims.id, claimId), eq(claims.userId, userId)));
  const claim = rows[0];
  if (!claim || claim.status !== "PENDING") throw new AppError("NOT_FOUND", "Claim package not found.", 404);
  const trackingNumber = claim.trackingNumber.trim().toUpperCase();
  const taken = await db.select({ id: packages.id }).from(packages).where(eq(packages.domesticTrackingNumber, trackingNumber));
  if (taken[0]) throw new AppError("DUPLICATE_TRACKING", "This tracking number is already used.", 409);
  const now = Date.now();
  const id = crypto.randomUUID();
  const publicId = await allocateNumber(db, "package");
  await db.update(claims).set({ status: "CLAIMED" }).where(eq(claims.id, claimId));
  await db.insert(packages).values({
    id,
    userId,
    publicId,
    domesticTrackingNumber: trackingNumber,
    courier: claim.courier,
    packageStatus: "RECEIVED",
    ...NEW_PACKAGE_STATE,
    weightGrams: claim.weightGrams,
    lengthMm: claim.lengthMm || null,
    widthMm: claim.widthMm || null,
    heightMm: claim.heightMm || null,
    receivedAt: claim.receivedAt,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(packageAttributes).values({ id: crypto.randomUUID(), packageId: id, attribute: "GENERAL" });
  if (claim.unclaimedId) {
    // A parcel the warehouse set aside: carry over its shelf and real photos.
    const parcel = (await db.select().from(unclaimedParcels).where(eq(unclaimedParcels.id, claim.unclaimedId)))[0];
    if (parcel?.binLocation) await db.update(packages).set({ binLocation: parcel.binLocation }).where(eq(packages.id, id));
    await db.update(unclaimedParcels).set({ status: "CLAIMED", updatedAt: now }).where(eq(unclaimedParcels.id, claim.unclaimedId));
    await movePhotosToPackage(db, claim.unclaimedId, id);
  } else {
    await db.insert(packagePhotos).values({
      id: crypto.randomUUID(),
      packageId: id,
      shipmentId: null,
      type: "INBOUND",
      label: "Warehouse receiving photo",
      createdAt: claim.receivedAt,
    });
  }
  try {
    const { noteClaimedPackage } = await import("./fulfillment-sync");
    await noteClaimedPackage(db, id);
  } catch (error) {
    logEvent({ level: "error", message: "Could not record claim sync review", detail: error instanceof Error ? error.message : "unknown" });
  }
  return getPackage(db, userId, id);
}

export async function rejectClaim(db: Database, userId: string, claimId: string) {
  const rows = await db.select().from(claims).where(and(eq(claims.id, claimId), eq(claims.userId, userId)));
  if (!rows[0] || rows[0].status !== "PENDING") throw new AppError("NOT_FOUND", "Claim package not found.", 404);
  await db.update(claims).set({ status: "REJECTED" }).where(eq(claims.id, claimId));
  // Not theirs: the parcel goes back to the unclaimed pile.
  if (rows[0].unclaimedId) await db.update(unclaimedParcels).set({ status: "OPEN", assignedUserId: null, updatedAt: Date.now() }).where(eq(unclaimedParcels.id, rows[0].unclaimedId));
  return { ok: true };
}

export async function resolveException(db: Database, userId: string, packageId: string, action: string) {
  const pkg = await ownedPackage(db, userId, packageId);
  const open = await db
    .select()
    .from(packageExceptions)
    .where(and(eq(packageExceptions.packageId, packageId), eq(packageExceptions.status, "OPEN")));
  if (!open[0]) throw new AppError("NO_EXCEPTION", "This package has no open exception.");
  const now = Date.now();
  if (action === "ACCEPT") {
    await db.update(packageExceptions).set({ status: "RESOLVED", resolution: action }).where(eq(packageExceptions.id, open[0].id));
    await db.update(packages).set({ exceptionStatus: "RESOLVED", conditionStatus: "NORMAL", updatedAt: now }).where(eq(packages.id, pkg.id));
  } else if (action === "INSPECTION") {
    await db.update(packageExceptions).set({ status: "RESOLVED", resolution: action }).where(eq(packageExceptions.id, open[0].id));
    await db.insert(vasRequests).values({
      id: crypto.randomUUID(),
      packageId,
      serviceCode: "INSPECTION",
      serviceName: "Open Package Inspection",
      status: "REQUESTED",
      estimatedFen: 1500,
      finalFen: null,
      paymentState: "UNBILLED",
      note: "Requested while resolving an exception.",
      createdAt: now,
    });
    await db.update(packages).set({ exceptionStatus: "RESOLVED", conditionStatus: "NORMAL", vasStatus: "PROCESSING", updatedAt: now }).where(eq(packages.id, pkg.id));
  } else if (action === "RETURN") {
    await db.update(packageExceptions).set({ status: "RESOLVED", resolution: action }).where(eq(packageExceptions.id, open[0].id));
    await db.update(packages).set({ exceptionStatus: "RESOLVED", conditionStatus: "NORMAL", disposition: "RETURN_REQUESTED", lockStatus: "BLOCKED", updatedAt: now }).where(eq(packages.id, pkg.id));
  } else if (action === "DISPOSAL") {
    await db.update(packageExceptions).set({ status: "RESOLVED", resolution: action }).where(eq(packageExceptions.id, open[0].id));
    await db
      .update(packages)
      .set({ exceptionStatus: "RESOLVED", conditionStatus: "NORMAL", disposition: "DISPOSAL_REQUESTED", lockStatus: "BLOCKED", updatedAt: now })
      .where(eq(packages.id, pkg.id));
  } else if (action === "SUPPORT") {
    return {
      supportEmail: appConfig.supportEmail,
      context: `Package ${pkg.publicId}\nTracking ${pkg.domesticTrackingNumber}`,
    };
  } else {
    throw new AppError("VALIDATION_ERROR", "Unknown exception action.");
  }
  return getPackage(db, userId, packageId);
}

/**
 * Deletes a package the warehouse has not received. `ownerId` null means an admin. A HioBuy inbound notice is
 * cancelled first; if HioBuy refuses or cannot be reached, nothing local is removed.
 */
export async function deletePendingPackage(db: Database, env: { HIOBUY_API_TOKEN?: string }, packageId: string, ownerId: string | null) {
  const pkg = ownerId ? await ownedPackage(db, ownerId, packageId) : (await db.select().from(packages).where(eq(packages.id, packageId)))[0];
  if (!pkg) throw new AppError("NOT_FOUND", "Package not found.", 404);
  if (pkg.packageStatus !== "PENDING") throw new AppError("PACKAGE_NOT_PENDING", "Only packages the warehouse has not received can be deleted.", 409);
  const linked = await db.select({ id: shipmentPackages.shipmentId }).from(shipmentPackages).where(eq(shipmentPackages.packageId, pkg.id)).limit(1);
  if (linked.length) throw new AppError("PACKAGE_NOT_PENDING", "This package is on a shipment. Cancel the shipment first.", 409);
  const { withdrawInboundNotice } = await import("./fulfillment-sync");
  await withdrawInboundNotice(db, env, pkg);
  const tasks = await db
    .select({ id: fulfillmentSyncTasks.id })
    .from(fulfillmentSyncTasks)
    .where(and(eq(fulfillmentSyncTasks.entityType, "package"), eq(fulfillmentSyncTasks.entityId, pkg.id)));
  await db.batch([
    db.delete(fulfillmentSyncAttempts).where(inArray(fulfillmentSyncAttempts.taskId, tasks.length ? tasks.map((task) => task.id) : [""])),
    db.delete(fulfillmentSyncTasks).where(and(eq(fulfillmentSyncTasks.entityType, "package"), eq(fulfillmentSyncTasks.entityId, pkg.id))),
    db.delete(fulfillmentRemoteLinks).where(and(eq(fulfillmentRemoteLinks.localType, "package"), eq(fulfillmentRemoteLinks.localId, pkg.id))),
    db.delete(packageAttributes).where(eq(packageAttributes.packageId, pkg.id)),
    db.delete(packagePhotos).where(eq(packagePhotos.packageId, pkg.id)),
    db.delete(packageExceptions).where(eq(packageExceptions.packageId, pkg.id)),
    db.delete(vasRequests).where(eq(vasRequests.packageId, pkg.id)),
    db.delete(notifications).where(eq(notifications.href, `/app/packages/${pkg.id}`)),
    db.delete(packages).where(and(eq(packages.id, pkg.id), eq(packages.packageStatus, "PENDING"))),
  ]);
  return { id: pkg.id, publicId: pkg.publicId, userId: pkg.userId };
}

async function ownedPackage(db: Database, userId: string, packageId: string) {
  const rows = await db.select().from(packages).where(and(eq(packages.id, packageId), eq(packages.userId, userId)));
  const pkg = rows[0];
  if (!pkg) throw new AppError("NOT_FOUND", "Package not found.", 404);
  return pkg;
}

export async function requestVas(db: Database, userId: string, packageId: string, serviceCode: string, note: string | undefined, idempotencyKey: string | null) {
  const replay = await readIdempotent(db, userId, "vas", idempotencyKey);
  if (replay) return replay;
  const pkg = await ownedPackage(db, userId, packageId);
  const state = packageState(pkg);
  if (state.packageStatus !== "RECEIVED") throw new AppError("PACKAGE_NOT_ELIGIBLE", "VAS can only be requested after the warehouse receives the package.");
  if (state.exceptionStatus === "ACTION_REQUIRED") throw new AppError("PACKAGE_NOT_ELIGIBLE", "Resolve the package exception before requesting a service.");
  const service = vasCatalog.find((item) => item.code === serviceCode);
  if (!service) throw new AppError("VALIDATION_ERROR", "Unknown warehouse service.");
  const now = Date.now();
  await db.insert(vasRequests).values({
    id: crypto.randomUUID(),
    packageId,
    serviceCode: service.code,
    serviceName: service.name,
    status: "REQUESTED",
    estimatedFen: service.estimatedFen,
    finalFen: null,
    paymentState: "UNBILLED",
    note: note ?? null,
    createdAt: now,
  });
  await db.update(packages).set({ vasStatus: "PROCESSING", updatedAt: now }).where(eq(packages.id, packageId));
  const result = await getPackage(db, userId, packageId);
  await saveIdempotent(db, userId, "vas", idempotencyKey, result);
  return result;
}

export async function listAddresses(db: Database, userId: string) {
  const rows = await db.select().from(addresses).where(eq(addresses.userId, userId)).orderBy(desc(addresses.createdAt));
  return rows.map(addressDto);
}

export async function saveAddress(
  db: Database,
  userId: string,
  input: {
    id?: string;
    firstName: string;
    lastName: string;
    email?: string;
    company?: string;
    phoneCode: string;
    phone: string;
    countryCode: string;
    regionCode: string;
    state: string;
    city: string;
    district?: string;
    postalCode: string;
    addressLine1: string;
    addressLine2?: string;
    isDefault?: boolean;
  },
) {
  const open = await listOpenDestinations(db);
  const destination = open.countries.find((country) => country.code === input.countryCode);
  if (!destination) throw new AppError("DESTINATION_CLOSED", "That country is not open for delivery.");
  if (!destination.regions.some((region) => region.code === input.regionCode)) throw new AppError("VALIDATION_ERROR", "Choose a region that is open for this country.");
  if (!isKnownDial(input.phoneCode)) throw new AppError("VALIDATION_ERROR", "Choose a country calling code.");
  const now = Date.now();
  const contact = {
    name: `${input.firstName.trim()} ${input.lastName.trim()}`.trim(),
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    email: input.email?.trim() || null,
    company: input.company?.trim() || null,
    phoneCode: input.phoneCode,
    phone: input.phone.trim(),
  };
  const existing = input.id
    ? (await db.select().from(addresses).where(and(eq(addresses.id, input.id), eq(addresses.userId, userId))))[0]
    : undefined;
  if (input.id && !existing) throw new AppError("NOT_FOUND", "Address not found.", 404);
  const others = await db.select({ id: addresses.id }).from(addresses).where(eq(addresses.userId, userId));
  const makeDefault = Boolean(input.isDefault) || (!existing && others.length === 0);
  if (makeDefault) {
    await db.update(addresses).set({ isDefault: false }).where(eq(addresses.userId, userId));
  }
  if (existing) {
    await db
      .update(addresses)
      .set({
        ...contact,
        countryCode: input.countryCode,
        regionCode: input.regionCode,
        state: input.state,
        city: input.city,
        district: input.district ?? null,
        postalCode: input.postalCode,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2 ?? null,
        isDefault: makeDefault ? true : existing.isDefault,
        updatedAt: now,
      })
      .where(eq(addresses.id, existing.id));
    return addressDto((await db.select().from(addresses).where(eq(addresses.id, existing.id)))[0]!);
  }
  const id = crypto.randomUUID();
  await db.insert(addresses).values({
    id,
    userId,
    ...contact,
    countryCode: input.countryCode,
    regionCode: input.regionCode,
    state: input.state,
    city: input.city,
    district: input.district ?? null,
    postalCode: input.postalCode,
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2 ?? null,
    isDefault: makeDefault,
    createdAt: now,
    updatedAt: now,
  });
  return addressDto((await db.select().from(addresses).where(eq(addresses.id, id)))[0]!);
}

export async function deleteAddress(db: Database, userId: string, id: string) {
  const rows = await db.select().from(addresses).where(and(eq(addresses.id, id), eq(addresses.userId, userId)));
  if (!rows[0]) throw new AppError("NOT_FOUND", "Address not found.", 404);
  await db.delete(addresses).where(eq(addresses.id, id));
  if (rows[0].isDefault) {
    const rest = await db.select().from(addresses).where(eq(addresses.userId, userId));
    const next = rest[0];
    if (next) await db.update(addresses).set({ isDefault: true }).where(eq(addresses.id, next.id));
  }
  return { ok: true };
}

export async function setDefaultAddress(db: Database, userId: string, id: string) {
  const rows = await db.select().from(addresses).where(and(eq(addresses.id, id), eq(addresses.userId, userId)));
  if (!rows[0]) throw new AppError("NOT_FOUND", "Address not found.", 404);
  await db.update(addresses).set({ isDefault: false }).where(eq(addresses.userId, userId));
  await db.update(addresses).set({ isDefault: true, updatedAt: Date.now() }).where(eq(addresses.id, id));
  return { ok: true };
}

async function quoteForPackages(db: Database, userId: string, packageIds: string[], addressId: string, envToken?: string) {
  const uniqueIds = [...new Set(packageIds)];
  if (uniqueIds.length === 0) throw new AppError("VALIDATION_ERROR", "Select at least one package.");
  const graph = await loadPackageGraph(db, userId);
  const selected = uniqueIds.map((id) => graph.find((pkg) => pkg.id === id));
  if (selected.some((pkg) => !pkg)) throw new AppError("NOT_FOUND", "One or more packages were not found.", 404);
  const blocked = selected.find((pkg) => pkg && !pkg.eligible);
  if (blocked && blocked.ineligibleReason) {
    throw new AppError("PACKAGE_NOT_ELIGIBLE", blocked.ineligibleReason, 409, { packageId: blocked.publicId });
  }
  const addressRows = await db.select().from(addresses).where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)));
  const address = addressRows[0];
  if (!address) throw new AppError("NOT_FOUND", "Address not found.", 404);
  const weight = selected.reduce((sum, pkg) => sum + (pkg!.weightGrams ?? 0), 0);
  const sized = selected.filter((pkg) => pkg?.lengthMm && pkg.widthMm && pkg.heightMm);
  const box = sized.length === 1 ? sized[0] : null;
  const live = await quoteRoutes(
    db,
    envToken,
    {
      countryCode: address.countryCode,
      weightGrams: weight,
      lengthMm: box?.lengthMm ?? null,
      widthMm: box?.widthMm ?? null,
      heightMm: box?.heightMm ?? null,
      cargo: [...new Set(selected.flatMap((pkg) => pkg!.cargoAttributes))],
    },
    selected.map((pkg) => ({ publicId: pkg!.publicId, cargo: pkg!.cargoAttributes })),
  );
  return { selected, address, quotes: live.routes, failure: live.failure, weight, uniqueIds };
}

type RouteRequest = { countryCode: string; weightGrams: number; lengthMm: number | null; widthMm: number | null; heightMm: number | null; cargo: CargoAttribute[] };

/** Live HioBuy routes, or the reason none can be offered. `listed` is echoed back so the page can show what was quoted. */
async function quoteRoutes(db: Database, envToken: string | undefined, request: RouteRequest, listed: { publicId: string; cargo: CargoAttribute[] }[]) {
  const none = (message: string, detail: string) => ({ routes: [] as RouteQuote[], failure: { message, detail, packages: listed } });
  if (!(await fulfillmentConnected(db))) return none("Shipping methods aren't available yet.", "HioBuy isn't connected, so no live routes are offered.");
  const live = await liveShipmentRoutes(db, envToken, request);
  if (live.closed) return none("No shipping methods are available for this destination.", `Shipping to ${countryName(request.countryCode)} is not open.`);
  if (live.upstreamMessage || !live.routes.length) {
    return none("No shipping methods are available for this shipment.", live.upstreamMessage ?? "HioBuy did not return a route for this weight and cargo.");
  }
  return { routes: live.routes, failure: null };
}

export async function createShippingQuote(db: Database, userId: string, packageIds: string[], addressId: string, envToken?: string) {
  const quoted = await quoteForPackages(db, userId, packageIds, addressId, envToken);
  const now = Date.now();
  const id = crypto.randomUUID();
  const payload = { packageIds: quoted.uniqueIds, addressId, routes: quoted.quotes };
  await db.insert(shippingQuotes).values({
    id,
    userId,
    packageKey: [...quoted.uniqueIds].sort().join(","),
    addressId,
    payload: JSON.stringify(payload),
    createdAt: now,
    expiresAt: now + appConfig.quoteTtlMs,
  });
  return {
    quoteId: id,
    expiresAt: new Date(now + appConfig.quoteTtlMs).toISOString(),
    estimatedWeightGrams: quoted.weight,
    routes: quoted.quotes,
    failure: quoted.failure,
    address: addressDto(quoted.address),
  };
}

/** Freight estimate before any package exists. Used by the assistant. */
export async function calculateRates(db: Database, input: { countryCode: string; weightGrams: number; cargo: CargoAttribute[] }, envToken?: string) {
  if (!isCountryCode(input.countryCode)) throw new AppError("VALIDATION_ERROR", "Choose a supported country.");
  if (input.weightGrams <= 0) throw new AppError("VALIDATION_ERROR", "Weight must be greater than 0.");
  const cargo: CargoAttribute[] = input.cargo.length ? input.cargo : ["GENERAL"];
  return quoteRoutes(db, envToken, { countryCode: input.countryCode, weightGrams: input.weightGrams, lengthMm: null, widthMm: null, heightMm: null, cargo }, [{ publicId: "ESTIMATE", cargo }]);
}

export async function createShipment(
  db: Database,
  userId: string,
  input: { packageIds: string[]; addressId: string; quoteId: string; routeCode: string; packingInstruction: string; packingNote?: string },
  idempotencyKey: string | null,
  envToken?: string,
) {
  const replay = await readIdempotent(db, userId, "shipment", idempotencyKey);
  if (replay) return replay;
  const quoteRows = await db.select().from(shippingQuotes).where(and(eq(shippingQuotes.id, input.quoteId), eq(shippingQuotes.userId, userId)));
  const quote = quoteRows[0];
  if (!quote) throw new AppError("QUOTE_NOT_FOUND", "Shipping quote not found.", 404);
  if (quote.expiresAt < Date.now()) throw new AppError("QUOTE_EXPIRED", "This shipping quote has expired. Please search for routes again.");
  const payload = JSON.parse(quote.payload) as { packageIds: string[]; addressId: string; routes: RouteQuote[] };
  const requested = [...new Set(input.packageIds)].sort().join(",");
  if (requested !== [...payload.packageIds].sort().join(",") || payload.addressId !== input.addressId) {
    throw new AppError("QUOTE_MISMATCH", "The selected packages or address changed. Please search for routes again.");
  }
  const fresh = await quoteForPackages(db, userId, input.packageIds, input.addressId, envToken);
  const route = fresh.quotes.find((item) => item.routeCode === input.routeCode);
  if (!route) throw new AppError("ROUTE_UNAVAILABLE", "That shipping method is no longer available for these packages.", 409);
  const now = Date.now();
  const shipmentId = crypto.randomUUID();
  const publicId = await allocateNumber(db, "shipment");
  await db.insert(shipments).values({
    id: shipmentId,
    userId,
    publicId,
    status: "CONSOLIDATING",
    upstreamStatus: "PENDING",
    canCancel: true,
    packingInstruction: input.packingInstruction,
    packingNote: input.packingNote ?? null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(shipmentPackages).values(fresh.uniqueIds.map((packageId) => ({ shipmentId, packageId })));
  await db.insert(shipmentAddresses).values({
    shipmentId,
    name: fresh.address.name,
    phone: [fresh.address.phoneCode, fresh.address.phone].filter(Boolean).join(" "),
    countryCode: fresh.address.countryCode,
    state: fresh.address.state,
    city: fresh.address.city,
    district: fresh.address.district,
    postalCode: fresh.address.postalCode,
    addressLine1: fresh.address.addressLine1,
    addressLine2: fresh.address.addressLine2,
  });
  await db.insert(shipmentMethods).values({
    shipmentId,
    routeCode: route.routeCode,
    routeName: route.routeName,
    estimatedDaysMin: route.daysMin,
    estimatedDaysMax: route.daysMax,
    estimatedMinFen: route.estimatedMinFen,
    estimatedMaxFen: route.estimatedMaxFen,
    currency: appConfig.currency,
    description: route.description,
  });
  await db.insert(charges).values({
    id: crypto.randomUUID(),
    shipmentId,
    type: "FREIGHT",
    name: "Estimated freight",
    amountFen: route.estimatedMaxFen,
    currency: appConfig.currency,
    status: "ESTIMATED",
  });
  await db
    .update(packages)
    .set({ lockStatus: "LOCKED", packageStatus: "CONSOLIDATED", updatedAt: now })
    .where(and(eq(packages.userId, userId), inArray(packages.id, fresh.uniqueIds)));
  const result = await getShipment(db, userId, shipmentId);
  await saveIdempotent(db, userId, "shipment", idempotencyKey, result);
  try {
    const { enqueueShipmentCreate } = await import("./fulfillment-sync");
    await enqueueShipmentCreate(db, shipmentId);
  } catch (error) {
    logEvent({ level: "error", message: "Could not queue shipment sync", detail: error instanceof Error ? error.message : "unknown" });
  }
  return result;
}

export async function listShipments(db: Database, userId: string, filter: string, query: string, page: number, pageSize: number) {
  const all = await loadShipments(db, userId);
  const q = query.trim().toLowerCase();
  const filtered = all.filter((item) => {
    const statusOk = customerShipmentMatches(item.displayStatus.key, filter || "all");
    const text = `${item.publicId} ${item.trackingNumber ?? ""}`.toLowerCase();
    return statusOk && (!q || text.includes(q));
  });
  const start = (page - 1) * pageSize;
  return {
    items: filtered.slice(start, start + pageSize).map(({ updatedAt: _updated, ...item }) => item),
    page,
    pageSize,
    total: filtered.length,
  };
}

export async function getShipment(db: Database, userId: string, id: string, envToken?: string) {
  try {
    const { refreshShipmentMedia } = await import("./fulfillment-sync");
    await refreshShipmentMedia(db, id, envToken);
  } catch (error) {
    logEvent({ level: "error", message: "Could not refresh shipment media", detail: error instanceof Error ? error.message : "unknown" });
  }
  const all = await loadShipments(db, userId);
  const item = all.find((shipment) => shipment.id === id);
  if (!item) throw new AppError("NOT_FOUND", "Shipment not found.", 404);
  const { updatedAt: _updated, ...dto } = item;
  return { ...dto, timeline: await shipmentActivity(db, item.id, "customer", item.createdAt) };
}

async function shipmentPaidAt(db: Database, shipmentId: string) {
  const links = await db.select({ checkoutId: checkoutItems.checkoutId }).from(checkoutItems).where(and(eq(checkoutItems.referenceType, "SHIPMENT"), eq(checkoutItems.referenceId, shipmentId)));
  if (!links.length) return null;
  const paid = await db.select({ paidAt: checkouts.paidAt }).from(checkouts).where(and(inArray(checkouts.id, links.map((link) => link.checkoutId)), eq(checkouts.status, "PAID")));
  const times = paid.map((row) => row.paidAt).filter((value): value is number => value != null);
  if (!times.length) return null;
  return new Date(Math.min(...times)).toISOString();
}

export async function shipmentActivity(db: Database, shipmentId: string, audience: "admin" | "customer", createdAt: string) {
  const { businessTimeline } = await import("./fulfillment-sync");
  const paidAt = await shipmentPaidAt(db, shipmentId);
  const base = [{ at: createdAt, title: "Consolidation submitted", detail: "The consolidation was created." }];
  if (paidAt) base.push({ at: paidAt, title: "Payment received", detail: "Freight was paid." });
  return businessTimeline(db, "shipment", shipmentId, audience, base);
}

export async function packageActivity(db: Database, packageId: string, audience: "admin" | "customer", base: { at: string; title: string; detail: string }[]) {
  const { businessTimeline } = await import("./fulfillment-sync");
  return businessTimeline(db, "package", packageId, audience, base);
}

export async function cancelShipment(db: Database, userId: string, id: string) {
  const rows = await db.select().from(shipments).where(and(eq(shipments.id, id), eq(shipments.userId, userId)));
  const shipment = rows[0];
  if (!shipment) throw new AppError("NOT_FOUND", "Shipment not found.", 404);
  if (!shipment.canCancel || shipment.status !== "CONSOLIDATING") {
    throw new AppError("CANCEL_NOT_ALLOWED", "Warehouse packing has already started, so this shipment cannot be cancelled here.");
  }
  const links = await db.select().from(shipmentPackages).where(eq(shipmentPackages.shipmentId, id));
  const now = Date.now();
  await db.update(shipments).set({ status: "CANCELLED", canCancel: false, updatedAt: now }).where(eq(shipments.id, id));
  if (links.length) {
    await db
      .update(packages)
      .set({ lockStatus: "AVAILABLE", updatedAt: now })
      .where(inArray(packages.id, links.map((link) => link.packageId)));
    await db
      .update(packages)
      .set({ packageStatus: "RECEIVED", updatedAt: now })
      .where(and(inArray(packages.id, links.map((link) => link.packageId)), eq(packages.packageStatus, "CONSOLIDATED")));
  }
  try {
    const { noteShipmentCancelled } = await import("./fulfillment-sync");
    await noteShipmentCancelled(db, id);
  } catch (error) {
    logEvent({ level: "error", message: "Could not queue shipment cancellation", detail: error instanceof Error ? error.message : "unknown" });
  }
  return getShipment(db, userId, id);
}

async function dueAmounts(db: Database, shipmentIds: string[]) {
  const rows = shipmentIds.length ? await db.select().from(charges).where(and(inArray(charges.shipmentId, shipmentIds), eq(charges.status, "DUE"))) : [];
  const due = new Map(shipmentIds.map((id) => [id, 0]));
  for (const row of rows) due.set(row.shipmentId, (due.get(row.shipmentId) ?? 0) + row.amountFen);
  return due;
}

export async function createCheckout(db: Database, userId: string, shipmentIds: string[]) {
  const unique = [...new Set(shipmentIds)];
  if (unique.length === 0) throw new AppError("VALIDATION_ERROR", "Select at least one shipment.");
  const rows = await db.select().from(shipments).where(and(eq(shipments.userId, userId), inArray(shipments.id, unique)));
  if (rows.length !== unique.length) throw new AppError("NOT_FOUND", "One or more shipments were not found.", 404);
  const invalid = rows.filter((row) => row.status !== "TO_PAY");
  if (invalid.length) throw new AppError("SHIPMENT_NOT_PAYABLE", "One or more shipments are no longer waiting for payment.", 409);
  const now = Date.now();
  const due = await dueAmounts(db, unique);
  const total = [...due.values()].reduce((sum, amount) => sum + amount, 0);
  const id = crypto.randomUUID();
  await db.insert(checkouts).values({
    id,
    userId,
    status: "READY",
    currency: appConfig.currency,
    totalFen: total,
    createdAt: now,
    expiresAt: now + appConfig.checkoutTtlMs,
  });
  await db.insert(checkoutItems).values(
    rows.map((row) => ({
      id: crypto.randomUUID(),
      checkoutId: id,
      referenceType: "SHIPMENT",
      referenceId: row.id,
      amountFen: due.get(row.id) ?? 0,
      label: row.publicId,
    })),
  );
  return getCheckout(db, userId, id);
}

export async function getCheckout(db: Database, userId: string, id: string) {
  const rows = await db.select().from(checkouts).where(and(eq(checkouts.id, id), eq(checkouts.userId, userId)));
  const checkout = rows[0];
  if (!checkout) throw new AppError("NOT_FOUND", "Checkout not found.", 404);
  const items = await db.select().from(checkoutItems).where(eq(checkoutItems.checkoutId, id));
  const wallet = await db.select().from(wallets).where(eq(wallets.userId, userId));
  const balance = wallet[0]?.balanceFen ?? 0;
  return {
    id: checkout.id,
    status: checkout.status,
    currency: checkout.currency,
    totalFen: checkout.totalFen,
    createdAt: new Date(checkout.createdAt).toISOString(),
    expiresAt: new Date(checkout.expiresAt).toISOString(),
    paidAt: checkout.paidAt ? new Date(checkout.paidAt).toISOString() : null,
    items: items.map((item) => ({ id: item.referenceId, label: item.label, amountFen: item.amountFen })),
    walletBalanceFen: balance,
    amountNeededFen: Math.max(checkout.totalFen - balance, 0),
  };
}

export async function payCheckout(db: Database, userId: string, checkoutId: string, idempotencyKey: string | null) {
  const replay = await readIdempotent(db, userId, "pay", idempotencyKey);
  if (replay) return replay;
  const current = await getCheckout(db, userId, checkoutId);
  if (current.status === "PAID") {
    await recognizeCheckoutPayment(db, checkoutId);
    return current;
  }
  if (current.status !== "READY") throw new AppError("CHECKOUT_CLOSED", "This checkout is no longer payable.");
  if (new Date(current.expiresAt).getTime() < Date.now()) throw new AppError("CHECKOUT_EXPIRED", "This checkout has expired. Please start again.");
  const shipmentIds = current.items.map((item) => item.id);
  const shipmentRows = await db.select().from(shipments).where(and(eq(shipments.userId, userId), inArray(shipments.id, shipmentIds)));
  const due = await dueAmounts(db, shipmentIds);
  const problems = [];
  let total = 0;
  for (const item of current.items) {
    const shipment = shipmentRows.find((row) => row.id === item.id);
    const amount = shipment ? (due.get(shipment.id) ?? 0) : 0;
    if (!shipment || shipment.status !== "TO_PAY" || amount !== item.amountFen) {
      problems.push({ id: item.label, status: shipment?.status === "TO_PAY" ? "Amount changed" : shipment ? "Already paid" : "Missing" });
    }
    total += amount;
  }
  if (problems.length) {
    throw new AppError("CHECKOUT_CHANGED", "Checkout has changed. Please review the updated amount.", 409, { shipments: problems });
  }
  if (total !== current.totalFen) {
    throw new AppError("CHECKOUT_CHANGED", "Checkout has changed. Please review the updated amount.", 409);
  }
  const alreadyPaid = await db.select().from(payments).where(and(eq(payments.checkoutId, checkoutId), eq(payments.status, "paid")));
  if (alreadyPaid.length) throw new AppError("CHECKOUT_CLOSED", "This shipment is already paid.");
  const connected = await fulfillmentConnected(db);
  const moved = await moveWallet(db, {
    userId,
    amountFen: -total,
    type: "SHIPMENT_PAYMENT",
    referenceType: "CHECKOUT",
    referenceId: checkoutId,
    description: "Shipment Payment",
  });
  if (!moved.applied) throw new AppError("CHECKOUT_CLOSED", "This checkout is already paid.");
  const now = Date.now();
  await db.batch([
    db
      .update(shipments)
      .set({ status: "READY_TO_SHIP", upstreamStatus: connected ? "WAIT_PAYMENT" : "WAIT_SHIP", canCancel: false, updatedAt: now })
      .where(and(eq(shipments.userId, userId), inArray(shipments.id, shipmentIds), eq(shipments.status, "TO_PAY"))),
    db.update(charges).set({ status: "PAID" }).where(and(inArray(charges.shipmentId, shipmentIds), eq(charges.status, "DUE"))),
    db.update(checkouts).set({ status: "PAID", paidAt: now, totalFen: total }).where(eq(checkouts.id, checkoutId)),
  ]);
  const result = await getCheckout(db, userId, checkoutId);
  await recognizeCheckoutPayment(db, checkoutId);
  const { recordWalletShipmentPayment } = await import("./payments");
  await recordWalletShipmentPayment(db, userId, checkoutId, total);
  const { safeIssueCheckoutDocuments } = await import("./invoicing");
  await safeIssueCheckoutDocuments(db, checkoutId);
  await saveIdempotent(db, userId, "pay", idempotencyKey, result);
  return result;
}

export async function getWallet(db: Database, userId: string) {
  const wallet = (await db.select().from(wallets).where(eq(wallets.userId, userId)))[0];
  return { balanceFen: wallet?.balanceFen ?? 0, currency: appConfig.currency, lowBalance: (wallet?.balanceFen ?? 0) < appConfig.lowBalanceFen };
}

export async function listTransactions(db: Database, userId: string, type: string, page: number, pageSize: number) {
  const rows = await db.select().from(walletTransactions).where(eq(walletTransactions.userId, userId)).orderBy(desc(walletTransactions.createdAt));
  const filtered = rows.filter((row) => type === "all" || type === "" || row.type === type);
  const start = (page - 1) * pageSize;
  return {
    items: filtered.slice(start, start + pageSize).map((row) => ({
      id: row.id,
      type: row.type,
      amountFen: row.amountFen,
      currency: row.currency,
      balanceBefore: row.balanceBefore,
      balanceAfter: row.balanceAfter,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      description: row.description,
      createdAt: new Date(row.createdAt).toISOString(),
    })),
    page,
    pageSize,
    total: filtered.length,
  };
}

export async function getDashboard(db: Database, user: UserRef) {
  const [packageItems, shipmentItems, claimItems, wallet, txs, notes] = await Promise.all([
    loadPackageGraph(db, user.id),
    loadShipments(db, user.id),
    listClaims(db, user.id),
    getWallet(db, user.id),
    listTransactions(db, user.id, "all", 1, 5),
    db.select().from(notifications).where(eq(notifications.userId, user.id)).orderBy(desc(notifications.createdAt)),
  ]);
  const counts = {
    toClaim: claimItems.length,
    actionRequired: packageItems.filter((item) => item.conditionStatus === "EXCEPTION").length,
    ready: packageItems.filter((item) => item.eligible).length,
    toPay: shipmentItems.filter((item) => item.status === "TO_PAY").length,
    inTransit: shipmentItems.filter((item) => item.status === "IN_TRANSIT" || item.status === "SHIPPED").length,
    totalPackages: packageItems.length,
  };
  const attention = [
    ...claimItems.map((claim) => ({
      tone: "warning" as const,
      title: "Package waiting to be claimed",
      body: `${claim.domesticTrackingNumber} arrived without a package on file.`,
      href: "/app/claim-packages",
    })),
    ...packageItems
      .filter((item) => item.conditionStatus === "EXCEPTION")
      .map((item) => ({
        tone: "danger" as const,
        title: "Package exception requiring confirmation",
        body: `${item.publicId} · ${item.exception?.type ?? "Action required"}`,
        href: `/app/packages/${item.id}`,
      })),
    ...packageItems
      .filter((item) => item.vasRequests.some((vas) => vas.status === "COMPLETED"))
      .slice(0, 1)
      .map((item) => ({
        tone: "info" as const,
        title: "VAS completed",
        body: `${item.publicId} photos are ready to view.`,
        href: `/app/packages/${item.id}`,
      })),
    ...(counts.toPay
      ? [
          {
            tone: "warning" as const,
            title: "Shipment ready for payment",
            body: `${counts.toPay} shipment${counts.toPay === 1 ? "" : "s"} waiting for payment.`,
            href: "/app/shipments?status=to_pay",
          },
        ]
      : []),
    ...(wallet.lowBalance
      ? [{ tone: "warning" as const, title: "Wallet balance low", body: "Top up before the next freight payment.", href: "/app/wallet/top-up" }]
      : []),
  ];
  return {
    warehouse: await getWarehouse(db, user),
    wallet,
    counts,
    attention,
    recentPackages: packageItems.slice(0, 4).map(({ updatedAt: _u, photos: _p, ...item }) => item),
    recentShipments: shipmentItems.slice(0, 4).map(({ updatedAt: _u, ...item }) => item),
    recentTransactions: txs.items,
    unreadNotifications: notes.filter((item) => item.readAt == null).length,
  };
}

export async function listNotifications(db: Database, userId: string) {
  const rows = await db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt));
  return rows.slice(0, 20).map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    href: row.href,
    read: row.readAt != null,
    createdAt: new Date(row.createdAt).toISOString(),
  }));
}

export async function markNotificationsRead(db: Database, userId: string) {
  await db.update(notifications).set({ readAt: Date.now() }).where(eq(notifications.userId, userId));
  return { ok: true };
}

export async function getPreferences(db: Database, userId: string) {
  const rows = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId));
  const row = rows[0];
  if (!row) return null;
  return {
    emailEnabled: row.emailEnabled,
    packageReceived: row.packageReceived,
    actionRequired: row.actionRequired,
    vasCompleted: row.vasCompleted,
    paymentDue: row.paymentDue,
    shipmentShipped: row.shipmentShipped,
    shipmentDelivered: row.shipmentDelivered,
  };
}

export async function updatePreferences(db: Database, userId: string, input: Record<string, boolean>) {
  await db
    .update(notificationPreferences)
    .set({
      emailEnabled: input.emailEnabled,
      packageReceived: input.packageReceived,
      actionRequired: input.actionRequired,
      vasCompleted: input.vasCompleted,
      paymentDue: input.paymentDue,
      shipmentShipped: input.shipmentShipped,
      shipmentDelivered: input.shipmentDelivered,
    })
    .where(eq(notificationPreferences.userId, userId));
  return getPreferences(db, userId);
}

export async function updateProfile(db: Database, userId: string, input: { name: string; phone: string | null; country: string | null }) {
  const { user } = await import("./db/schema");
  await db.update(user).set({ name: input.name, phone: input.phone, country: input.country, updatedAt: new Date() }).where(eq(user.id, userId));
  return { ok: true };
}

export async function devMailbox(db: Database, email: string) {
  const rows = await db.select().from(emailOutbox).where(eq(emailOutbox.toAddress, email)).orderBy(desc(emailOutbox.createdAt));
  return rows.slice(0, 5).map((row) => ({
    id: row.id,
    kind: row.kind,
    subject: row.subject,
    body: row.body,
    url: row.url,
    createdAt: new Date(row.createdAt).toISOString(),
  }));
}

export async function navCounts(db: Database, userId: string) {
  const [claimItems, shipmentItems] = await Promise.all([listClaims(db, userId), loadShipments(db, userId)]);
  return { claims: claimItems.length, unpaidShipments: shipmentItems.filter((item) => item.status === "TO_PAY").length };
}
