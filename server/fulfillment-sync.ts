import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { customerUsdFen } from "../src/domain/freight";
import { mergeTimeline, timelineFromSync, type TimelineEvent } from "../src/domain/timeline";
import { labelTrackingEvent, resolveTrackingLabels } from "../src/domain/tracking-events";
import {
  afterCredentialChange,
  allowRemoteCreate,
  canManualRetry,
  canonicalRemoteStatus,
  classifyPackageHistory,
  classifyShipmentHistory,
  decidePackagePull,
  decideShipmentPull,
  readCarrierTracking,
  dispatchDecision,
  enqueueShipment,
  explainPackageSyncIssue,
  externalPackageRef,
  externalShipmentRef,
  hiobuyPayReady,
  hiobuyReceiver,
  inboundIdempotencyKey,
  inboundNoticeBody,
  interpretInboundCancel,
  interpretInboundResponse,
  interpretPackageDetail,
  interpretPackageList,
  interpretShipmentDetail,
  interpretShipmentList,
  interpretPayResponse,
  interpretShipmentCreate,
  readFulfillmentPackageView,
  readPackageMedia,
  readShipmentWarehouse,
  readSourcePackageIds,
  shipmentIsPacked,
  nextRetryAt,
  packageCanSync,
  packageSyncLabel,
  payIdempotencyKey,
  payableCnyFen,
  readyForPaymentDecision,
  redactSensitive,
  remoteRank,
  shipmentCreateReady,
  shipmentIdempotencyKey,
  shouldAutoEnqueueInbound,
  syncBucket,
  syncListLabel,
  type SyncOutcome,
  verifyHioBuySignature,
  webhookDisposition,
} from "../src/domain/fulfillment-sync";
import { customerCurrency } from "./locale";
import type { Database } from "./db/client";
import {
  cartonPackages,
  cartons,
  charges,
  checkoutItems,
  fulfillmentRemoteLinks,
  fulfillmentSyncAttempts,
  fulfillmentSyncTasks,
  fulfillmentWebhookEvents,
  freightPolicy,
  packageExceptions,
  packagePhotos,
  packages,
  payments,
  shipmentAddresses,
  shipmentMethods,
  shipmentEarnings,
  shipmentPackages,
  shipments,
} from "./db/schema";
import { snapshotRemoteFreight } from "./earnings";
import { packageRow, shipmentRow } from "./rows";
import { AppError, logEvent } from "./errors";
import { decryptSecret, encryptSecret } from "./email/crypto";
import { SINGLETON_ID } from "./db/singleton";
import { freightPolicyRow, fulfillmentConnected, resolveHioBuyToken, sellingPolicy } from "./freight";
import {
  cancelFulfillmentShipment,
  createFulfillmentShipment,
  cancelInboundNotice,
  createInboundNotice,
  interceptFulfillmentShipment,
  listFulfillmentPackages,
  listFulfillmentShipments,
  payFulfillmentShipment,
  readFulfillmentPackage,
  readFulfillmentShipment,
  readFulfillmentShipmentTracking,
  upstreamRequestId,
} from "./services/hiobuy/fulfillment";
import { emailBrand, storedBusiness } from "./business";
import { enqueueDirect } from "./email/mailer";
import { notify } from "./notify";

const STALE_LOCK_MS = 120_000;

type TaskRow = typeof fulfillmentSyncTasks.$inferSelect;
const WEBHOOK_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type SyncEnv = { HIOBUY_API_TOKEN?: string; BETTER_AUTH_SECRET?: string; DEMO_MODE?: string };

function bucketStatuses(bucket: string) {
  if (bucket === "pending") return ["pending", "waiting"];
  if (bucket === "syncing") return ["syncing"];
  if (bucket === "synced") return ["synced"];
  if (bucket === "failed") return ["failed"];
  if (bucket === "needs_review") return ["needs_review", "candidate", "skipped"];
  return [];
}

export async function decoratePackageSync(db: Database, items: { id: string; packageStatus: string; disposition: string; remotePackageId: string | null }[]) {
  const state = await connectedState(db);
  const ids = items.map((item) => item.id);
  const [inbound, pulls] = await Promise.all([syncLabelsFor(db, "package", ids, "inbound_create"), syncLabelsFor(db, "package", ids, "status_pull")]);
  const connected = state.connected && !state.paused;
  return new Map(
    items.map((item) => {
      const task = inbound.get(item.id);
      const pull = pulls.get(item.id);
      const remoteId = item.remotePackageId ?? task?.remoteId ?? null;
      const pullProblem = pull?.status === "failed" || pull?.status === "needs_review" || pull?.status === "syncing";
      const source = pullProblem ? pull : task;
      const taskStatus = source?.status ?? null;
      const problem = taskStatus === "failed" || taskStatus === "needs_review";
      return [
        item.id,
        {
          syncLabel: packageSyncLabel({ connected, taskStatus, remoteId }),
          syncRemoteId: remoteId,
          syncReason: problem ? explainPackageSyncIssue(source?.errorCode, source?.errorMessage || source?.reason) : null,
          canSync: packageCanSync({ packageStatus: item.packageStatus, disposition: item.disposition, taskStatus: task?.status ?? null, remoteId }),
          canPull: Boolean(item.remotePackageId),
        },
      ] as const;
    }),
  );
}

export async function syncLabelsFor(db: Database, entityType: "package" | "shipment", ids: string[], action = entityType === "package" ? "inbound_create" : "shipment_create") {
  const labels = new Map<string, { label: string; remoteId: string | null; status: string; errorCode: string | null; errorMessage: string | null; reason: string | null }>();
  if (!ids.length) return labels;
  const rows = await db
    .select()
    .from(fulfillmentSyncTasks)
    .where(and(eq(fulfillmentSyncTasks.entityType, entityType), eq(fulfillmentSyncTasks.action, action), inArray(fulfillmentSyncTasks.entityId, ids)));
  for (const row of rows) {
    labels.set(row.entityId, {
      label: syncListLabel(row.status),
      remoteId: row.remoteId,
      status: row.status,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      reason: row.reason,
    });
  }
  return labels;
}

async function paused(db: Database) {
  const policy = await freightPolicyRow(db);
  return policy.syncPauseCode ? { code: policy.syncPauseCode, message: policy.syncPauseMessage ?? "HioBuy authorization is paused." } : null;
}

async function connectedState(db: Database) {
  const [connected, pause] = await Promise.all([fulfillmentConnected(db), paused(db)]);
  return { connected, paused: Boolean(pause) };
}

async function rememberLink(db: Database, input: { localType: string; localId: string; remoteType: string; remoteId: string; externalRef?: string | null; trackingNumber?: string | null; remoteStatus?: string | null }) {
  const now = Date.now();
  const existing = (
    await db
      .select({ id: fulfillmentRemoteLinks.id })
      .from(fulfillmentRemoteLinks)
      .where(
        and(
          eq(fulfillmentRemoteLinks.localType, input.localType),
          eq(fulfillmentRemoteLinks.localId, input.localId),
          eq(fulfillmentRemoteLinks.remoteType, input.remoteType),
          eq(fulfillmentRemoteLinks.remoteId, input.remoteId),
        ),
      )
  )[0];
  if (existing) {
    await db.update(fulfillmentRemoteLinks).set({ remoteStatus: input.remoteStatus ?? null, updatedAt: now }).where(eq(fulfillmentRemoteLinks.id, existing.id));
    return;
  }
  await db.insert(fulfillmentRemoteLinks).values({
    id: crypto.randomUUID(),
    localType: input.localType,
    localId: input.localId,
    remoteType: input.remoteType,
    remoteId: input.remoteId,
    externalRef: input.externalRef ?? null,
    trackingNumber: input.trackingNumber ?? null,
    remoteStatus: input.remoteStatus ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

async function insertTask(db: Database, input: { entityType: "package" | "shipment"; entityId: string; action: string; status: string; externalRef: string; idempotencyKey: string; reason: string | null }) {
  const existing = (
    await db
      .select()
      .from(fulfillmentSyncTasks)
      .where(and(eq(fulfillmentSyncTasks.entityType, input.entityType), eq(fulfillmentSyncTasks.entityId, input.entityId), eq(fulfillmentSyncTasks.action, input.action)))
  )[0];
  if (existing) return existing;
  const now = Date.now();
  await db.insert(fulfillmentSyncTasks).values({
    id: crypto.randomUUID(),
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    status: input.status,
    idempotencyKey: input.idempotencyKey,
    externalRef: input.externalRef,
    remoteId: null,
    remoteSecondary: null,
    remoteStatus: null,
    attemptCount: 0,
    nextAttemptAt: input.status === "pending" ? now : null,
    errorClass: null,
    errorCode: null,
    errorMessage: null,
    lockToken: null,
    lockedAt: null,
    reason: input.reason,
    createdAt: now,
    updatedAt: now,
  });
  return (
    await db
      .select()
      .from(fulfillmentSyncTasks)
      .where(and(eq(fulfillmentSyncTasks.entityType, input.entityType), eq(fulfillmentSyncTasks.entityId, input.entityId), eq(fulfillmentSyncTasks.action, input.action)))
  )[0];
}

async function autoSyncPackagesEnabled(db: Database) {
  return (await freightPolicyRow(db)).autoSyncPackages !== false;
}

/**
 * Cancels the HioBuy inbound notice before a pending package is deleted. Throws when the warehouse may still
 * expect the parcel. The inbound task is held as `cancelling` so the cron cannot submit it meanwhile.
 */
export async function withdrawInboundNotice(db: Database, env: SyncEnv, pkg: typeof packages.$inferSelect) {
  const task = (
    await db
      .select()
      .from(fulfillmentSyncTasks)
      .where(and(eq(fulfillmentSyncTasks.entityType, "package"), eq(fulfillmentSyncTasks.entityId, pkg.id), eq(fulfillmentSyncTasks.action, "inbound_create")))
  )[0];
  const busy = new AppError("PACKAGE_SYNCING", "This package is being sent to the warehouse. Try again in a minute.", 409);
  if (task?.status === "syncing") throw busy;
  if (task) {
    const held = await db
      .update(fulfillmentSyncTasks)
      .set({ status: "cancelling", updatedAt: Date.now() })
      .where(and(eq(fulfillmentSyncTasks.id, task.id), eq(fulfillmentSyncTasks.status, task.status)))
      .returning({ id: fulfillmentSyncTasks.id });
    if (!held.length) throw busy;
  }
  const linked = pkg.hiobuyPackageId ?? pkg.hiobuyInboundNoticeId;
  const remoteId = linked ?? (task && task.attemptCount > 0 ? task.externalRef : null);
  if (!remoteId) return;
  try {
    const token = await resolveHioBuyToken(db, env.HIOBUY_API_TOKEN);
    if (!token) throw new AppError("HIOBUY_NOT_CONNECTED", "This package was sent to HioBuy. Reconnect HioBuy so the inbound notice can be cancelled first.", 409);
    const response = await cancelInboundNotice(token, remoteId);
    const result = interpretInboundCancel({ timedOut: response.timedOut, httpStatus: response.status, payload: response.payload });
    if (result === "cancelled" || result === "absent") return;
    if (result === "received") throw new AppError("PACKAGE_RECEIVED", "The warehouse already received this package, so it can't be deleted. Refresh to see its latest status.", 409);
    if (result === "not_editable") {
      const detail = await readFulfillmentPackage(token, remoteId);
      const view = interpretPackageDetail({ timedOut: detail.timedOut, httpStatus: detail.status, payload: detail.payload });
      if (detail.status === 404 || (view.kind === "ok" && (view.package.status === "DISCARDED" || view.package.status === "CANCELLED"))) return;
      throw new AppError("PACKAGE_NOT_EDITABLE", "The warehouse is already handling this package, so it can't be deleted.", 409);
    }
    throw new AppError("HIOBUY_UNAVAILABLE", "HioBuy did not confirm the cancellation. Try again in a moment.", 502);
  } catch (error) {
    if (task) await db.update(fulfillmentSyncTasks).set({ status: task.status, updatedAt: Date.now() }).where(and(eq(fulfillmentSyncTasks.id, task.id), eq(fulfillmentSyncTasks.status, "cancelling")));
    throw error;
  }
}

export async function enqueueInboundNotices(db: Database, packageIds: string[]) {
  if (!packageIds.length) return;
  const state = await connectedState(db);
  const auto = await autoSyncPackagesEnabled(db);
  if (shouldAutoEnqueueInbound({ auto, connected: state.connected, paused: state.paused }) === "local_only") return;
  for (const id of packageIds) {
    await insertTask(db, {
      entityType: "package",
      entityId: id,
      action: "inbound_create",
      status: "pending",
      externalRef: externalPackageRef(id),
      idempotencyKey: inboundIdempotencyKey(id),
      reason: null,
    });
  }
}

export async function queueSelectedPackages(db: Database, env: SyncEnv, packageIds: string[]) {
  const unique = [...new Set(packageIds)];
  if (!unique.length) throw new AppError("VALIDATION_ERROR", "Select at least one package.");
  const state = await connectedState(db);
  if (!state.connected) throw new AppError("HIOBUY_NOT_CONNECTED", "Connect HioBuy before syncing packages. Local records stay saved.", 409);
  if (state.paused) throw new AppError("HIOBUY_PAUSED", "HioBuy authorization is paused. Test the connection, then sync again.", 409);
  const now = Date.now();
  const toRun: string[] = [];
  for (const id of unique) {
    const pkg = (await db.select().from(packages).where(eq(packages.id, id)))[0];
    const task = (
      await db
        .select()
        .from(fulfillmentSyncTasks)
        .where(and(eq(fulfillmentSyncTasks.entityType, "package"), eq(fulfillmentSyncTasks.entityId, id), eq(fulfillmentSyncTasks.action, "inbound_create")))
    )[0];
    const remoteId = pkg?.hiobuyPackageId ?? pkg?.hiobuyInboundNoticeId ?? task?.remoteId ?? null;
    if (!pkg || !packageCanSync({ packageStatus: pkg.packageStatus, disposition: pkg.disposition, taskStatus: task?.status ?? null, remoteId })) continue;
    if (task) {
      await db
        .update(fulfillmentSyncTasks)
        .set({
          status: "pending",
          nextAttemptAt: now,
          attemptCount: task.status === "failed" ? 0 : task.attemptCount,
          lockToken: null,
          lockedAt: null,
          updatedAt: now,
        })
        .where(eq(fulfillmentSyncTasks.id, task.id));
    } else {
      await insertTask(db, {
        entityType: "package",
        entityId: id,
        action: "inbound_create",
        status: "pending",
        externalRef: externalPackageRef(id),
        idempotencyKey: inboundIdempotencyKey(id),
        reason: null,
      });
    }
    toRun.push(id);
  }
  if (toRun.length) await processDueFulfillment(db, env, toRun.length, toRun);
  const ran = new Set(toRun);
  const items = [];
  for (const id of unique) {
    const pkg = (await db.select().from(packages).where(eq(packages.id, id)))[0];
    const task = (
      await db
        .select()
        .from(fulfillmentSyncTasks)
        .where(and(eq(fulfillmentSyncTasks.entityType, "package"), eq(fulfillmentSyncTasks.entityId, id), eq(fulfillmentSyncTasks.action, "inbound_create")))
    )[0];
    const remoteId = pkg?.hiobuyPackageId ?? pkg?.hiobuyInboundNoticeId ?? task?.remoteId ?? null;
    const status = task?.status ?? null;
    const submitted = ran.has(id);
    const outcome = !submitted ? (status === "needs_review" ? "needs_review" : "skipped") : remoteId || status === "synced" ? "synced" : status === "failed" ? "failed" : status === "needs_review" ? "needs_review" : "skipped";
    const message = outcome === "synced"
      ? "Inbound notice submitted. The package stays Pending until HioBuy reports it received."
      : explainPackageSyncIssue(task?.errorCode, task?.errorMessage || task?.reason) || (outcome === "skipped" ? "Already submitted or not eligible. It was not created again." : "HioBuy did not accept this package.");
    items.push({ id, publicId: pkg?.publicId ?? id, outcome, message });
  }
  return {
    synced: items.filter((item) => item.outcome === "synced").length,
    failed: items.filter((item) => item.outcome === "failed").length,
    skipped: items.filter((item) => item.outcome === "skipped").length,
    needsReview: items.filter((item) => item.outcome === "needs_review").length,
    items,
  };
}

const OPERATION_LABEL: Record<string, string> = {
  inbound_create: "Inbound notice submission",
  status_pull: "Package status pull",
};

export async function packageSyncLog(db: Database, packageId: string) {
  const pkg = await packageRow(db, packageId);
  const state = await connectedState(db);
  const tasks = await db
    .select()
    .from(fulfillmentSyncTasks)
    .where(and(eq(fulfillmentSyncTasks.entityType, "package"), eq(fulfillmentSyncTasks.entityId, packageId)));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const inbound = tasks.find((task) => task.action === "inbound_create") ?? null;
  const attempts = tasks.length
    ? await db.select().from(fulfillmentSyncAttempts).where(inArray(fulfillmentSyncAttempts.taskId, tasks.map((task) => task.id))).orderBy(desc(fulfillmentSyncAttempts.createdAt)).limit(20)
    : [];
  const latest = attempts[0];
  const remoteId = pkg.hiobuyPackageId ?? inbound?.remoteId ?? null;
  const pull = tasks.find((task) => task.action === "status_pull") ?? null;
  const shown = pull?.status === "failed" || pull?.status === "needs_review" ? pull : inbound;
  const taskStatus = shown?.status ?? null;
  return {
    label: packageSyncLabel({ connected: state.connected && !state.paused, taskStatus, remoteId }),
    canRetry: inbound?.status === "failed",
    canPull: Boolean(pkg.hiobuyPackageId),
    remoteId,
    inboundNoticeId: pkg.hiobuyInboundNoticeId,
    inboundNoticeStatus: pkg.hiobuyStatus,
    warehousePackageId: pkg.hiobuyPackageId,
    packageStatus: pkg.packageStatus,
    conditionStatus: pkg.conditionStatus,
    syncedAt: pkg.hiobuySyncedAt ? new Date(pkg.hiobuySyncedAt).toISOString() : null,
    externalRef: inbound?.externalRef ?? externalPackageRef(pkg.id),
    reason: explainPackageSyncIssue(shown?.errorCode, shown?.errorMessage || shown?.reason),
    errorCode: shown?.errorCode ?? null,
    errorMessage: shown?.errorMessage ?? null,
    attemptCount: (inbound?.attemptCount ?? 0) + (pull?.attemptCount ?? 0),
    requestId: latest?.upstreamRequestId ?? null,
    updatedAt: shown ? new Date(shown.updatedAt).toISOString() : null,
    history: attempts.map((attempt) => {
      const task = taskById.get(attempt.taskId);
      const operation = attempt.operation ?? task?.action ?? "inbound_create";
      return {
        id: attempt.id,
        attempt: attempt.attempt,
        operation,
        operationLabel: OPERATION_LABEL[operation] ?? operation,
        httpStatus: attempt.httpStatus,
        outcome: attempt.outcome,
        previousStatus: attempt.previousStatus,
        newStatus: attempt.newStatus,
        errorCode: attempt.errorCode,
        errorMessage: attempt.errorMessage,
        requestId: attempt.upstreamRequestId,
        remoteId: task?.remoteId ?? pkg.hiobuyPackageId,
        startedAt: attempt.startedAt ? new Date(attempt.startedAt).toISOString() : null,
        finishedAt: attempt.finishedAt ? new Date(attempt.finishedAt).toISOString() : null,
        createdAt: new Date(attempt.createdAt).toISOString(),
      };
    }),
  };
}

type PullRow = {
  id: string;
  publicId: string;
  outcome: "updated" | "unchanged" | "failed" | "needs_review";
  message: string;
  checked: boolean;
};

function pullLocal(pkg: typeof packages.$inferSelect, shipmentDispatched?: boolean) {
  return {
    packageStatus: pkg.packageStatus,
    conditionStatus: pkg.conditionStatus,
    exceptionStatus: pkg.exceptionStatus,
    lockStatus: pkg.lockStatus,
    hiobuyPackageId: pkg.hiobuyPackageId,
    weightGrams: pkg.weightGrams,
    lengthMm: pkg.lengthMm,
    widthMm: pkg.widthMm,
    heightMm: pkg.heightMm,
    receivedAt: pkg.receivedAt,
    shipmentDispatched,
  };
}

async function packageShipmentDispatched(db: Database, packageId: string) {
  const rows = await db
    .select({ status: shipments.status })
    .from(shipmentPackages)
    .innerJoin(shipments, eq(shipments.id, shipmentPackages.shipmentId))
    .where(eq(shipmentPackages.packageId, packageId));
  if (rows.some((row) => row.status === "IN_TRANSIT" || row.status === "SHIPPED" || row.status === "DELIVERED")) return true;
  if (rows.some((row) => row.status === "CONSOLIDATING" || row.status === "WAITING_FOR_WEIGHT" || row.status === "TO_PAY" || row.status === "READY_TO_SHIP")) return false;
  return undefined;
}

async function recordPull(
  db: Database,
  pkg: typeof packages.$inferSelect,
  outcome: PullRow["outcome"],
  message: string,
  requestId: string | null,
  previousStatus: string,
  nextStatus: string | null,
  code: string | null,
  httpStatus: number | null,
  startedAt: number,
): Promise<PullRow> {
  const task = await insertTask(db, {
    entityType: "package",
    entityId: pkg.id,
    action: "status_pull",
    status: "pending",
    externalRef: externalPackageRef(pkg.id),
    idempotencyKey: `pull:${pkg.id}`,
    reason: null,
  });
  const now = Date.now();
  const status = outcome === "updated" || outcome === "unchanged" ? "synced" : outcome;
  if (task) {
    const nextAttempt = task.attemptCount + 1;
    await db
      .update(fulfillmentSyncTasks)
      .set({
        status,
        remoteId: pkg.hiobuyPackageId,
        remoteStatus: nextStatus ?? previousStatus,
        attemptCount: nextAttempt,
        errorClass: status === "synced" ? null : outcome === "needs_review" ? "conflict" : "unknown",
        errorCode: status === "synced" ? null : code,
        errorMessage: status === "synced" ? null : redactSensitive(message),
        reason: outcome === "needs_review" ? message : null,
        lockToken: null,
        lockedAt: null,
        nextAttemptAt: null,
        updatedAt: now,
      })
      .where(eq(fulfillmentSyncTasks.id, task.id));
    await logAttempt(db, { ...task, attemptCount: nextAttempt }, outcome, httpStatus, status === "synced" ? null : "unknown", code, status === "synced" ? null : message, requestId, {
      startedAt,
      finishedAt: now,
      previousStatus,
      newStatus: nextStatus,
    });
  }
  return { id: pkg.id, publicId: pkg.publicId, outcome, message, checked: true };
}

async function applyRemotePackage(db: Database, pkg: typeof packages.$inferSelect, remote: { id: string; status: string; externalOrderId: string | null; condition: "NORMAL" | "EXCEPTION" | null; weightGrams: number | null; lengthMm: number | null; widthMm: number | null; heightMm: number | null; receivedAt: string | null }, requestId: string | null, httpStatus: number, startedAt: number): Promise<PullRow> {
  const fresh = (await db.select().from(packages).where(eq(packages.id, pkg.id)))[0] ?? pkg;
  const task = (
    await db
      .select()
      .from(fulfillmentSyncTasks)
      .where(and(eq(fulfillmentSyncTasks.entityType, "package"), eq(fulfillmentSyncTasks.entityId, fresh.id), eq(fulfillmentSyncTasks.action, "status_pull")))
  )[0];
  if (task?.lockToken && task.lockedAt && Date.now() - task.lockedAt < STALE_LOCK_MS) {
    return recordPull(db, fresh, "needs_review", "Another status sync is already running for this package.", requestId, fresh.packageStatus, null, "SYNC_IN_PROGRESS", httpStatus, startedAt);
  }
  const decision = decidePackagePull(pullLocal(fresh, await packageShipmentDispatched(db, fresh.id)), remote, externalPackageRef(fresh.id));
  if (decision.result === "needs_review") {
    return recordPull(db, fresh, "needs_review", decision.reason, requestId, fresh.packageStatus, null, "STATUS_CONFLICT", httpStatus, startedAt);
  }
  if (decision.result === "unchanged") {
    await db.update(packages).set({ hiobuySyncedAt: Date.now() }).where(eq(packages.id, fresh.id));
    return recordPull(db, fresh, "unchanged", "HioBuy already matches this package.", requestId, fresh.packageStatus, fresh.packageStatus, null, httpStatus, startedAt);
  }
  const now = Date.now();
  await db
    .update(packages)
    .set({
      packageStatus: decision.status,
      conditionStatus: decision.condition,
      hiobuyStatus: decision.status,
      hiobuyPackageId: fresh.hiobuyPackageId,
      hiobuySyncedAt: now,
      weightGrams: decision.weightGrams,
      lengthMm: decision.lengthMm,
      widthMm: decision.widthMm,
      heightMm: decision.heightMm,
      receivedAt: decision.receivedAt,
      updatedAt: now,
    })
    .where(and(eq(packages.id, fresh.id), eq(packages.updatedAt, fresh.updatedAt)));
  const after = (await db.select().from(packages).where(eq(packages.id, fresh.id)))[0];
  if (!after || after.updatedAt !== now) {
    return recordPull(db, fresh, "needs_review", "Another update landed while this sync was running. Local status was kept.", requestId, fresh.packageStatus, null, "CONCURRENT_SYNC", httpStatus, startedAt);
  }
  if (decision.openException) {
    const open = (await db.select({ id: packageExceptions.id }).from(packageExceptions).where(and(eq(packageExceptions.packageId, fresh.id), eq(packageExceptions.status, "OPEN"))))[0];
    if (!open) {
      await db.insert(packageExceptions).values({
        id: crypto.randomUUID(),
        packageId: fresh.id,
        type: "OTHER",
        description: "HioBuy reported a package exception.",
        message: "Please choose how the warehouse should handle this package.",
        status: "OPEN",
        resolution: null,
        createdAt: now,
      });
      await db.update(packages).set({ exceptionStatus: "ACTION_REQUIRED" }).where(eq(packages.id, fresh.id));
    }
  }
  if (fresh.packageStatus === "PENDING" && decision.status === "RECEIVED") {
    await notify(db, fresh.userId, { type: "PACKAGE_RECEIVED", title: "Package received", body: `${fresh.publicId} arrived at the warehouse.`, href: `/app/packages/${fresh.id}` });
  }
  await rememberLink(db, { localType: "package", localId: fresh.id, remoteType: "package", remoteId: remote.id, externalRef: externalPackageRef(fresh.id), trackingNumber: fresh.domesticTrackingNumber, remoteStatus: decision.status });
  return recordPull(db, fresh, "updated", `Package status is ${decision.status}.`, requestId, fresh.packageStatus, decision.status, null, httpStatus, startedAt);
}

async function pullOnePackage(db: Database, token: string, pkg: typeof packages.$inferSelect, gate: { stop: boolean; code: string; message: string }): Promise<PullRow> {
  if (!pkg.hiobuyPackageId) {
    return { id: pkg.id, publicId: pkg.publicId, outcome: "needs_review", message: "No HioBuy package is linked, so this record was not queried.", checked: false };
  }
  if (gate.stop) {
    return { id: pkg.id, publicId: pkg.publicId, outcome: "failed", message: `${gate.message || "HioBuy rate limit stopped the remaining pulls."} Local status was kept.`, checked: false };
  }
  const started = Date.now();
  const response = await readFulfillmentPackage(token, pkg.hiobuyPackageId);
  const interpreted = interpretPackageDetail({ timedOut: response.timedOut, httpStatus: response.status, payload: response.payload });
  if (interpreted.kind === "retry" && (interpreted.code === "RATE_LIMITED" || response.status === 429)) {
    gate.stop = true;
    gate.code = interpreted.code;
    gate.message = interpreted.message;
  }
  if (interpreted.kind !== "ok") {
    const message = interpreted.kind === "retry" ? `${interpreted.message} Local status was kept.` : `${interpreted.message} Local status was kept.`;
    return recordPull(db, pkg, "failed", message, upstreamRequestId(response.payload), pkg.packageStatus, null, interpreted.code, response.status || null, started);
  }
  if (interpreted.package.id !== pkg.hiobuyPackageId) {
    return recordPull(db, pkg, "needs_review", "HioBuy returned a different package id. Nothing was copied.", interpreted.requestId, pkg.packageStatus, null, "REMOTE_ID_MISMATCH", response.status, started);
  }
  await storePackageMedia(db, pkg.id, response.payload);
  return applyRemotePackage(db, pkg, interpreted.package, interpreted.requestId, response.status, started);
}

const PACKED_SHIPMENT = new Set(["WAIT_PAYMENT", "WAIT_SHIP", "SHIPPED", "SIGNED"]);

async function storePackageMedia(db: Database, packageId: string, payload: unknown) {
  const files = readPackageMedia(payload);
  if (!files.length) return;
  const existing = await db.select({ url: packagePhotos.remoteUrl }).from(packagePhotos).where(eq(packagePhotos.packageId, packageId));
  const seen = new Set(existing.map((row) => row.url).filter((url): url is string => Boolean(url)));
  const now = Date.now();
  for (const file of files) {
    if (seen.has(file.url)) continue;
    seen.add(file.url);
    await db.insert(packagePhotos).values({
      id: crypto.randomUUID(),
      packageId,
      shipmentId: null,
      type: file.type,
      label: file.label,
      objectKey: null,
      remoteUrl: file.url,
      cartonId: null,
      unclaimedId: null,
      createdAt: now,
    });
  }
}

async function storeShipmentMedia(db: Database, shipmentId: string, payload: unknown, token?: string) {
  const warehouse = readShipmentWarehouse(payload);
  if (!warehouse.cartons.length && token && shipmentIsPacked(payload)) {
    const sourceIds = readSourcePackageIds(payload);
    const measured = [];
    for (const remoteId of sourceIds) {
      const detail = await readFulfillmentPackage(token, remoteId);
      if (detail.timedOut || detail.status >= 400) continue;
      const root = detail.payload && typeof detail.payload === "object" ? (detail.payload as { data?: unknown }) : null;
      const view = readFulfillmentPackageView(root?.data ?? detail.payload);
      if (view) measured.push(view);
    }
    if (measured.length) {
      const only = measured.length === 1 ? measured[0] : null;
      warehouse.cartons.push({
        id: `packed-${shipmentId}`,
        code: "Carton 1",
        status: "PACKED",
        weightGrams: measured.reduce((sum, item) => sum + (item.weightGrams ?? 0), 0) || null,
        lengthMm: only?.lengthMm ?? null,
        widthMm: only?.widthMm ?? null,
        heightMm: only?.heightMm ?? null,
        trackingNumber: null,
        packageRemoteIds: measured.map((item) => item.id),
      });
    }
  }
  if (warehouse.files.length) {
    const existing = await db.select({ url: packagePhotos.remoteUrl }).from(packagePhotos).where(eq(packagePhotos.shipmentId, shipmentId));
    const seen = new Set(existing.map((row) => row.url).filter((url): url is string => Boolean(url)));
    const now = Date.now();
    for (const file of warehouse.files) {
      if (seen.has(file.url)) continue;
      seen.add(file.url);
      await db.insert(packagePhotos).values({
        id: crypto.randomUUID(),
        packageId: null,
        shipmentId,
        type: file.type,
        label: file.label,
        objectKey: null,
        remoteUrl: file.url,
        cartonId: null,
        unclaimedId: null,
        createdAt: now,
      });
    }
  }
  if (!warehouse.cartons.length) return;
  const current = await db.select().from(cartons).where(eq(cartons.shipmentId, shipmentId));
  const now = Date.now();
  for (const box of warehouse.cartons) {
    const found = current.find((row) => row.code === box.code);
    const cartonId = found?.id ?? crypto.randomUUID();
    if (found) {
      await db.update(cartons).set({ status: box.status, weightGrams: box.weightGrams ?? found.weightGrams, lengthMm: box.lengthMm ?? found.lengthMm, widthMm: box.widthMm ?? found.widthMm, heightMm: box.heightMm ?? found.heightMm, trackingNumber: box.trackingNumber ?? found.trackingNumber, updatedAt: now }).where(eq(cartons.id, found.id));
    } else {
      await db.insert(cartons).values({
        id: cartonId,
        shipmentId,
        code: box.code,
        status: box.status,
        weightGrams: box.weightGrams,
        lengthMm: box.lengthMm,
        widthMm: box.widthMm,
        heightMm: box.heightMm,
        trackingNumber: box.trackingNumber,
        createdAt: now,
        updatedAt: now,
      });
    }
    if (box.packageRemoteIds.length) {
      const locals = await db.select({ id: packages.id }).from(packages).where(inArray(packages.hiobuyPackageId, box.packageRemoteIds));
      const linked = await db.select().from(cartonPackages).where(eq(cartonPackages.cartonId, cartonId));
      const have = new Set(linked.map((row) => row.packageId));
      for (const pkg of locals) {
        if (!have.has(pkg.id)) await db.insert(cartonPackages).values({ cartonId, packageId: pkg.id });
      }
    }
  }
  const saved = await db.select().from(cartons).where(eq(cartons.shipmentId, shipmentId));
  if (saved.length) {
    const weight = saved.reduce((sum, row) => sum + (row.weightGrams ?? 0), 0);
    const only = saved.length === 1 ? saved[0] : null;
    await db.update(shipments).set({
      finalWeightGrams: weight || null,
      finalLengthMm: only?.lengthMm ?? null,
      finalWidthMm: only?.widthMm ?? null,
      finalHeightMm: only?.heightMm ?? null,
      updatedAt: Date.now(),
    }).where(eq(shipments.id, shipmentId));
  }
}

async function billActualFreight(db: Database, shipment: typeof shipments.$inferSelect, payload: unknown, remoteStatus: string | null) {
  if (remoteStatus !== "WAIT_PAYMENT") return;
  if (shipment.status === "READY_TO_SHIP" || shipment.status === "IN_TRANSIT" || shipment.status === "SHIPPED" || shipment.status === "DELIVERED") return;
  const cny = payableCnyFen(payload);
  if (cny == null) return;
  const usd = customerUsdFen(cny, await sellingPolicy(db));
  const open = await db.select().from(charges).where(and(eq(charges.shipmentId, shipment.id), eq(charges.type, "FREIGHT"), inArray(charges.status, ["ESTIMATED", "DUE"])));
  if (open.length === 1 && open[0]?.status === "DUE" && open[0].amountFen === usd) return;
  const now = Date.now();
  await db.delete(charges).where(and(eq(charges.shipmentId, shipment.id), eq(charges.type, "FREIGHT"), inArray(charges.status, ["ESTIMATED", "DUE"])));
  await db.insert(charges).values({ id: crypto.randomUUID(), shipmentId: shipment.id, type: "FREIGHT", name: "International freight", amountFen: usd, currency: await customerCurrency(db), status: "DUE" });
  await snapshotRemoteFreight(db, shipment.id, usd, cny);
  if (shipment.status === "CONSOLIDATING" || shipment.status === "WAITING_FOR_WEIGHT") {
    await db.update(shipments).set({ status: "TO_PAY", canCancel: true, updatedAt: now }).where(eq(shipments.id, shipment.id));
  }
}

export async function refreshPackageMedia(db: Database, packageId: string, envToken?: string) {
  const pkg = (await db.select().from(packages).where(eq(packages.id, packageId)))[0];
  if (!pkg?.hiobuyPackageId || pkg.packageStatus === "PENDING") return;
  const token = await resolveHioBuyToken(db, envToken);
  if (!token) return;
  const detail = await readFulfillmentPackage(token, pkg.hiobuyPackageId);
  if (detail.timedOut || detail.status >= 400) return;
  await storePackageMedia(db, pkg.id, detail.payload);
}

export async function refreshShipmentMedia(db: Database, shipmentId: string, envToken?: string) {
  const shipment = (await db.select().from(shipments).where(eq(shipments.id, shipmentId)))[0];
  const remote = canonicalRemoteStatus(shipment?.upstreamStatus);
  if (!shipment?.hiobuyShipmentId || !remote || !PACKED_SHIPMENT.has(remote)) return;
  const token = await resolveHioBuyToken(db, envToken);
  if (!token) return;
  const detail = await readFulfillmentShipment(token, shipment.hiobuyShipmentId);
  if (detail.timedOut || detail.status >= 400) return;
  await storeShipmentMedia(db, shipment.id, detail.payload, token);
  await billActualFreight(db, shipment, detail.payload, remote);
}

async function mapLimited<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      const item = items[current];
      if (item === undefined) return;
      await run(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

function summarizePull(items: PullRow[]) {
  return {
    checked: items.filter((item) => item.checked).length,
    updated: items.filter((item) => item.outcome === "updated").length,
    unchanged: items.filter((item) => item.outcome === "unchanged").length,
    failed: items.filter((item) => item.outcome === "failed").length,
    needsReview: items.filter((item) => item.outcome === "needs_review").length,
    items,
  };
}

export async function pullPackageStatuses(db: Database, env: SyncEnv, ids?: string[]) {
  const state = await connectedState(db);
  if (!state.connected) throw new AppError("HIOBUY_NOT_CONNECTED", "Connect HioBuy before syncing package status.", 409);
  if (state.paused) throw new AppError("HIOBUY_PAUSED", "HioBuy authorization is paused. Test the connection, then sync again.", 409);
  const token = await resolveHioBuyToken(db, env.HIOBUY_API_TOKEN);
  if (!token) throw new AppError("HIOBUY_NOT_CONNECTED", "Connect HioBuy before syncing package status.", 409);
  const requested = ids ? [...new Set(ids)] : null;
  if (requested && !requested.length) throw new AppError("VALIDATION_ERROR", "Select at least one package.");
  const rows = requested
    ? await db.select().from(packages).where(inArray(packages.id, requested))
    : await db.select().from(packages);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const results: PullRow[] = [];
  const linked: (typeof packages.$inferSelect)[] = [];
  const source = requested ?? rows.filter((row) => row.hiobuyPackageId).map((row) => row.id);
  for (const id of source) {
    const pkg = byId.get(id);
    if (!pkg) {
      results.push({ id, publicId: id, outcome: "failed", message: "Package not found.", checked: false });
      continue;
    }
    if (!pkg.hiobuyPackageId) {
      results.push({ id: pkg.id, publicId: pkg.publicId, outcome: "needs_review", message: "No HioBuy package is linked, so this record was not queried.", checked: false });
      continue;
    }
    linked.push(pkg);
  }
  if (!requested) {
    const pending = new Map(linked.map((pkg) => [pkg.hiobuyPackageId as string, pkg]));
    let page = 1;
    let totalPages = 1;
    let stopped: { code: string; message: string } | null = null;
    while (page <= totalPages && page <= 30 && pending.size) {
      const started = Date.now();
      const response = await listFulfillmentPackages(token, page, 100);
      const interpreted = interpretPackageList({ timedOut: response.timedOut, httpStatus: response.status, payload: response.payload });
      if (interpreted.kind !== "ok") {
        stopped = { code: interpreted.code, message: interpreted.message };
        break;
      }
      totalPages = Math.max(1, interpreted.totalPages);
      for (const remote of interpreted.items) {
        const pkg = pending.get(remote.id);
        if (!pkg) continue;
        pending.delete(remote.id);
        results.push(await applyRemotePackage(db, pkg, remote, interpreted.requestId, response.status, started));
      }
      page += 1;
      if (page <= totalPages && pending.size) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    for (const pkg of pending.values()) {
      results.push(
        await recordPull(
          db,
          pkg,
          "failed",
          stopped ? `${stopped.message} Local status was kept.` : "HioBuy did not return this linked package. Local status was kept.",
          null,
          pkg.packageStatus,
          null,
          stopped?.code ?? "NOT_IN_LIST",
          null,
          Date.now(),
        ),
      );
    }
    return summarizePull(results);
  }
  const gate = { stop: false, code: "", message: "" };
  await mapLimited(linked, 4, async (pkg) => {
    results.push(await pullOnePackage(db, token, pkg, gate));
    await new Promise((resolve) => setTimeout(resolve, 120));
  });
  return summarizePull(results);
}

async function recordShipmentPull(
  db: Database,
  shipment: typeof shipments.$inferSelect,
  outcome: PullRow["outcome"],
  message: string,
  requestId: string | null,
  previousStatus: string | null,
  nextStatus: string | null,
  code: string | null,
  httpStatus: number | null,
  startedAt: number,
): Promise<PullRow> {
  const task = await insertTask(db, {
    entityType: "shipment",
    entityId: shipment.id,
    action: "shipment_status_pull",
    status: "pending",
    externalRef: externalShipmentRef(shipment.id),
    idempotencyKey: `shipment-pull:${shipment.id}`,
    reason: null,
  });
  const now = Date.now();
  const status = outcome === "updated" || outcome === "unchanged" ? "synced" : outcome;
  if (task) {
    const nextAttempt = task.attemptCount + 1;
    await db
      .update(fulfillmentSyncTasks)
      .set({
        status,
        remoteId: shipment.hiobuyShipmentId,
        remoteStatus: nextStatus ?? previousStatus,
        attemptCount: nextAttempt,
        errorClass: status === "synced" ? null : "unknown",
        errorCode: status === "synced" ? null : code,
        errorMessage: status === "synced" ? null : redactSensitive(message),
        reason: outcome === "needs_review" ? message : null,
        lockToken: null,
        lockedAt: null,
        nextAttemptAt: null,
        updatedAt: now,
      })
      .where(eq(fulfillmentSyncTasks.id, task.id));
    await logAttempt(db, { ...task, attemptCount: nextAttempt }, outcome, httpStatus, status === "synced" ? null : "unknown", code, status === "synced" ? null : message, requestId, {
      startedAt,
      finishedAt: now,
      previousStatus,
      newStatus: nextStatus,
    });
  }
  return { id: shipment.id, publicId: shipment.publicId, outcome, message, checked: true };
}

async function applyShipmentRemote(db: Database, shipment: typeof shipments.$inferSelect, remote: { id: string; status: string; externalShipmentId: string | null; paymentStatus: "UNPAID" | "PARTIAL" | "PAID" | null; interceptionStatus: "REQUESTED" | "PROCESSING" | "INTERCEPTED" | "FAILED" | null; interceptionKnown: boolean; trackingNumber: string | null }, requestId: string | null, httpStatus: number, startedAt: number): Promise<PullRow> {
  const fresh = (await db.select().from(shipments).where(eq(shipments.id, shipment.id)))[0] ?? shipment;
  const decision = decideShipmentPull(
    { hiobuyShipmentId: fresh.hiobuyShipmentId, upstreamStatus: fresh.upstreamStatus, hiobuyPaymentStatus: fresh.hiobuyPaymentStatus, interceptionStatus: fresh.interceptionStatus, trackingNumber: fresh.trackingNumber },
    remote,
    externalShipmentRef(fresh.id),
  );
  if (decision.result === "needs_review") {
    return recordShipmentPull(db, fresh, "needs_review", decision.reason, requestId, fresh.upstreamStatus, null, "STATUS_CONFLICT", httpStatus, startedAt);
  }
  if (decision.result === "unchanged") {
    await db.update(shipments).set({ hiobuySyncedAt: Date.now() }).where(eq(shipments.id, fresh.id));
    return recordShipmentPull(db, fresh, "unchanged", "HioBuy already matches this shipment.", requestId, fresh.upstreamStatus, fresh.upstreamStatus, null, httpStatus, startedAt);
  }
  const now = Date.now();
  const customerPaid = fresh.status === "READY_TO_SHIP" || fresh.status === "IN_TRANSIT" || fresh.status === "SHIPPED" || fresh.status === "DELIVERED";
  const localStatus = decision.status === "SIGNED"
    ? "DELIVERED"
    : decision.status === "SHIPPED"
      ? fresh.status === "DELIVERED" ? "DELIVERED" : "IN_TRANSIT"
      : decision.status === "CANCELLED"
        ? "CANCELLED"
        : decision.status === "WAIT_SHIP"
          ? customerPaid ? "READY_TO_SHIP" : "TO_PAY"
          : decision.status === "WAIT_PAYMENT"
            ? customerPaid ? fresh.status : "TO_PAY"
            : decision.status === "PENDING" && !customerPaid && fresh.status !== "TO_PAY"
              ? "CONSOLIDATING"
              : fresh.status;
  await db
    .update(shipments)
    .set({
      upstreamStatus: decision.status,
      hiobuyPaymentStatus: decision.paymentStatus,
      interceptionStatus: decision.interceptionStatus,
      trackingNumber: decision.trackingNumber,
      hiobuySyncedAt: now,
      status: localStatus,
      canCancel: decision.status === "PENDING" || decision.status === "WAIT_PAYMENT",
      updatedAt: now,
    })
    .where(and(eq(shipments.id, fresh.id), eq(shipments.updatedAt, fresh.updatedAt)));
  const after = (await db.select().from(shipments).where(eq(shipments.id, fresh.id)))[0];
  if (!after || after.updatedAt !== now) {
    return recordShipmentPull(db, fresh, "needs_review", "Another update landed while this sync was running. Local status was kept.", requestId, fresh.upstreamStatus, null, "CONCURRENT_SYNC", httpStatus, startedAt);
  }
  if (localStatus === "TO_PAY" && fresh.status !== "TO_PAY") {
    await db.update(charges).set({ status: "DUE" }).where(and(eq(charges.shipmentId, fresh.id), eq(charges.type, "FREIGHT"), eq(charges.status, "ESTIMATED")));
    await notify(db, fresh.userId, { type: "PAYMENT", title: "Shipment ready for payment", body: `${fresh.publicId} is packed. Freight is ready to pay.`, href: `/app/shipments/${fresh.id}` });
  }
  const links = await db.select({ packageId: shipmentPackages.packageId }).from(shipmentPackages).where(eq(shipmentPackages.shipmentId, fresh.id));
  const packageIds = links.map((link) => link.packageId);
  if (packageIds.length && decision.status === "SHIPPED") {
    await db.update(packages).set({ packageStatus: "SHIPPED", hiobuyStatus: "SHIPPED", updatedAt: now }).where(and(inArray(packages.id, packageIds), inArray(packages.packageStatus, ["RECEIVED", "CONSOLIDATED"])));
  }
  if (packageIds.length && decision.status === "SIGNED") {
    await db.update(packages).set({ packageStatus: "DELIVERED", hiobuyStatus: "DELIVERED", updatedAt: now }).where(and(inArray(packages.id, packageIds), inArray(packages.packageStatus, ["RECEIVED", "CONSOLIDATED", "SHIPPED"])));
  }
  if (packageIds.length && (decision.status === "PENDING" || decision.status === "WAIT_PAYMENT" || decision.status === "WAIT_SHIP")) {
    await db.update(packages).set({ packageStatus: "CONSOLIDATED", hiobuyStatus: "CONSOLIDATED", updatedAt: now }).where(and(inArray(packages.id, packageIds), inArray(packages.packageStatus, ["RECEIVED", "PENDING", "SHIPPED"])));
  }
  if (packageIds.length && decision.status === "CANCELLED") {
    await db.update(packages).set({ lockStatus: "AVAILABLE", packageStatus: "RECEIVED", updatedAt: now }).where(and(inArray(packages.id, packageIds), eq(packages.packageStatus, "CONSOLIDATED")));
  }
  return recordShipmentPull(db, fresh, "updated", `Shipment status is ${decision.status}.`, requestId, fresh.upstreamStatus, decision.status, null, httpStatus, startedAt);
}

export async function pullShipmentStatuses(db: Database, env: SyncEnv, ids?: string[]) {
  const state = await connectedState(db);
  if (!state.connected) throw new AppError("HIOBUY_NOT_CONNECTED", "Connect HioBuy before syncing shipment status.", 409);
  if (state.paused) throw new AppError("HIOBUY_PAUSED", "HioBuy authorization is paused. Test the connection, then sync again.", 409);
  const token = await resolveHioBuyToken(db, env.HIOBUY_API_TOKEN);
  if (!token) throw new AppError("HIOBUY_NOT_CONNECTED", "Connect HioBuy before syncing shipment status.", 409);
  const requested = ids ? [...new Set(ids)] : null;
  if (requested && !requested.length) throw new AppError("VALIDATION_ERROR", "Select at least one shipment.");
  const rows = requested ? await db.select().from(shipments).where(inArray(shipments.id, requested)) : await db.select().from(shipments);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const results: PullRow[] = [];
  const linked: (typeof shipments.$inferSelect)[] = [];
  const source = requested ?? rows.filter((row) => row.hiobuyShipmentId).map((row) => row.id);
  for (const id of source) {
    const shipment = byId.get(id);
    if (!shipment) {
      results.push({ id, publicId: id, outcome: "failed", message: "Shipment not found.", checked: false });
      continue;
    }
    if (!shipment.hiobuyShipmentId) {
      results.push({ id: shipment.id, publicId: shipment.publicId, outcome: "needs_review", message: "No HioBuy shipment is linked, so this record was not queried.", checked: false });
      continue;
    }
    linked.push(shipment);
  }
  if (!requested) {
    const pending = new Map(linked.map((row) => [row.hiobuyShipmentId as string, row]));
    let page = 1;
    let totalPages = 1;
    let stopped: { code: string; message: string } | null = null;
    while (page <= totalPages && page <= 30 && pending.size) {
      const started = Date.now();
      const response = await listFulfillmentShipments(token, page, 100);
      const interpreted = interpretShipmentList({ timedOut: response.timedOut, httpStatus: response.status, payload: response.payload });
      if (interpreted.kind !== "ok") {
        stopped = { code: interpreted.code, message: interpreted.message };
        break;
      }
      totalPages = Math.max(1, interpreted.totalPages);
      for (const remote of interpreted.items) {
        const shipment = pending.get(remote.id);
        if (!shipment) continue;
        pending.delete(remote.id);
        results.push(await applyShipmentRemote(db, shipment, remote, interpreted.requestId, response.status, started));
      }
      page += 1;
      if (page <= totalPages && pending.size) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    for (const shipment of pending.values()) {
      results.push(await recordShipmentPull(db, shipment, "failed", stopped ? `${stopped.message} Local status was kept.` : "HioBuy did not return this linked shipment. Local status was kept.", null, shipment.upstreamStatus, null, stopped?.code ?? "NOT_IN_LIST", null, Date.now()));
    }
    return summarizePull(results);
  }
  const gate = { stop: false, code: "", message: "" };
  await mapLimited(linked, 4, async (shipment) => {
    if (gate.stop || !shipment.hiobuyShipmentId) {
      results.push({ id: shipment.id, publicId: shipment.publicId, outcome: "failed", message: `${gate.message || "HioBuy rate limit stopped the remaining pulls."} Local status was kept.`, checked: false });
      return;
    }
    const started = Date.now();
    const response = await readFulfillmentShipment(token, shipment.hiobuyShipmentId);
    const interpreted = interpretShipmentDetail({ timedOut: response.timedOut, httpStatus: response.status, payload: response.payload });
    if (interpreted.kind === "retry" && (interpreted.code === "RATE_LIMITED" || response.status === 429)) {
      gate.stop = true;
      gate.code = interpreted.code;
      gate.message = interpreted.message;
    }
    if (interpreted.kind !== "ok") {
      results.push(await recordShipmentPull(db, shipment, "failed", `${interpreted.message} Local status was kept.`, upstreamRequestId(response.payload), shipment.upstreamStatus, null, interpreted.code, response.status || null, started));
      return;
    }
    if (interpreted.shipment.id !== shipment.hiobuyShipmentId) {
      results.push(await recordShipmentPull(db, shipment, "needs_review", "HioBuy returned a different shipment id. Nothing was copied.", interpreted.requestId, shipment.upstreamStatus, null, "REMOTE_ID_MISMATCH", response.status, started));
      return;
    }
    await storeShipmentMedia(db, shipment.id, response.payload, token);
    await billActualFreight(db, shipment, response.payload, interpreted.shipment.status);
    results.push(await applyShipmentRemote(db, shipment, interpreted.shipment, interpreted.requestId, response.status, started));
    await new Promise((resolve) => setTimeout(resolve, 120));
  });
  return summarizePull(results);
}

export async function businessTimeline(db: Database, entityType: "package" | "shipment", entityId: string, audience: "admin" | "customer", base: TimelineEvent[]) {
  const tasks = await db.select().from(fulfillmentSyncTasks).where(and(eq(fulfillmentSyncTasks.entityType, entityType), eq(fulfillmentSyncTasks.entityId, entityId)));
  const attempts = tasks.length
    ? await db.select().from(fulfillmentSyncAttempts).where(inArray(fulfillmentSyncAttempts.taskId, tasks.map((task) => task.id))).orderBy(desc(fulfillmentSyncAttempts.createdAt)).limit(80)
    : [];
  const milestones = tasks.map((task) => {
    const success = attempts
      .filter((attempt) => attempt.taskId === task.id && (attempt.outcome === "synced" || (task.action === "shipment_pay" && attempt.outcome === "updated")))
      .sort((a, b) => (a.finishedAt ?? a.createdAt) - (b.finishedAt ?? b.createdAt));
    const first = success[0];
    return {
      action: task.action,
      status: task.status,
      at: new Date(first?.finishedAt ?? first?.createdAt ?? task.updatedAt).toISOString(),
      remoteId: task.remoteId,
    };
  });
  const changes = attempts.map((attempt) => ({
    operation: attempt.operation ?? "",
    outcome: attempt.outcome,
    at: new Date(attempt.finishedAt ?? attempt.createdAt).toISOString(),
    previousStatus: attempt.previousStatus,
    newStatus: attempt.newStatus,
  }));
  return mergeTimeline([...base, ...timelineFromSync({ entity: entityType, audience, milestones, changes })]);
}

export async function carrierTracking(db: Database, env: SyncEnv, shipmentId: string, userId: string | null) {
  const shipment = (await db.select().from(shipments).where(eq(shipments.id, shipmentId)))[0];
  if (!shipment || (userId && shipment.userId !== userId)) throw new AppError("NOT_FOUND", "Shipment not found.", 404);
  const remote = canonicalRemoteStatus(shipment.upstreamStatus);
  const left = remote === "SHIPPED" || remote === "SIGNED" || shipment.status === "IN_TRANSIT" || shipment.status === "SHIPPED" || shipment.status === "DELIVERED";
  if (!left) return { available: false as const, trackingNumber: null, carrier: null, events: [] as { at: string; title: string; location: string }[] };
  let trackingNumber = shipment.trackingNumber;
  let carrier: string | null = null;
  let events: { at: string; title: string; location: string }[] = [];
  const token = shipment.hiobuyShipmentId ? await resolveHioBuyToken(db, env.HIOBUY_API_TOKEN) : null;
  if (token && shipment.hiobuyShipmentId) {
    const response = await readFulfillmentShipmentTracking(token, shipment.hiobuyShipmentId);
    if (!response.timedOut && response.status >= 200 && response.status < 300) {
      const parsed = readCarrierTracking(response.payload);
      const labels = resolveTrackingLabels((await freightPolicyRow(db)).trackingEventLabels);
      carrier = parsed.carrier;
      events = parsed.events.map(({ at, location, code }) => ({ at, title: labelTrackingEvent(code, labels), location }));
      if (parsed.trackingNumber && parsed.trackingNumber !== trackingNumber) {
        trackingNumber = parsed.trackingNumber;
        await db.update(shipments).set({ trackingNumber, updatedAt: Date.now() }).where(eq(shipments.id, shipment.id));
      }
    }
    if (!trackingNumber) {
      const detail = await readFulfillmentShipment(token, shipment.hiobuyShipmentId);
      const interpreted = interpretShipmentDetail({ timedOut: detail.timedOut, httpStatus: detail.status, payload: detail.payload });
      if (interpreted.kind === "ok" && interpreted.shipment.trackingNumber) {
        trackingNumber = interpreted.shipment.trackingNumber;
        await db.update(shipments).set({ trackingNumber, updatedAt: Date.now() }).where(eq(shipments.id, shipment.id));
      }
    }
  }
  return { available: true as const, trackingNumber, carrier, events };
}

export async function shipmentSyncLog(db: Database, shipmentId: string) {
  const shipment = await shipmentRow(db, shipmentId);
  const tasks = await db.select().from(fulfillmentSyncTasks).where(and(eq(fulfillmentSyncTasks.entityType, "shipment"), eq(fulfillmentSyncTasks.entityId, shipmentId)));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const attempts = tasks.length
    ? await db.select().from(fulfillmentSyncAttempts).where(inArray(fulfillmentSyncAttempts.taskId, tasks.map((task) => task.id))).orderBy(desc(fulfillmentSyncAttempts.createdAt)).limit(20)
    : [];
  const labels: Record<string, string> = {
    shipment_create: "Shipment create",
    shipment_status_pull: "Shipment status pull",
    shipment_pay: "Shipment pay",
    shipment_cancel: "Shipment cancel",
    shipment_intercept: "Shipment intercept",
  };
  return {
    remoteId: shipment.hiobuyShipmentId,
    upstreamStatus: shipment.upstreamStatus,
    paymentStatus: shipment.hiobuyPaymentStatus,
    interceptionStatus: shipment.interceptionStatus,
    history: attempts.map((attempt) => {
      const task = taskById.get(attempt.taskId);
      const operation = attempt.operation ?? task?.action ?? "shipment_create";
      return {
        id: attempt.id,
        operation,
        operationLabel: labels[operation] ?? operation,
        outcome: attempt.outcome,
        previousStatus: attempt.previousStatus,
        newStatus: attempt.newStatus,
        errorCode: attempt.errorCode,
        errorMessage: attempt.errorMessage,
        requestId: attempt.upstreamRequestId,
        createdAt: new Date(attempt.createdAt).toISOString(),
      };
    }),
  };
}

export async function requestShipmentIntercept(db: Database, env: SyncEnv, shipmentId: string, reason: string, remark: string) {
  const shipment = await shipmentRow(db, shipmentId);
  if (!shipment.hiobuyShipmentId) throw new AppError("INVALID_STATE", "This shipment is not linked to HioBuy.", 409);
  const remote = canonicalRemoteStatus(shipment.upstreamStatus);
  if (remote !== "WAIT_SHIP" && remote !== "SHIPPED") throw new AppError("INVALID_STATE", "Only a shipment that is ready to ship or already shipped can be intercepted.", 409);
  if (shipment.interceptionStatus === "REQUESTED" || shipment.interceptionStatus === "PROCESSING" || shipment.interceptionStatus === "INTERCEPTED") {
    throw new AppError("INVALID_STATE", "An interception is already in progress.", 409);
  }
  const token = await resolveHioBuyToken(db, env.HIOBUY_API_TOKEN);
  if (!token) throw new AppError("HIOBUY_NOT_CONNECTED", "Connect HioBuy before requesting an interception.", 409);
  const started = Date.now();
  const response = await interceptFulfillmentShipment(token, shipment.hiobuyShipmentId, reason, remark);
  const task = await insertTask(db, {
    entityType: "shipment",
    entityId: shipment.id,
    action: "shipment_intercept",
    status: "pending",
    externalRef: externalShipmentRef(shipment.id),
    idempotencyKey: `shipment-intercept:${shipment.id}`,
    reason: null,
  });
  if (response.timedOut || response.status >= 400) {
    if (task) await logAttempt(db, { ...task, attemptCount: task.attemptCount + 1 }, "failed", response.status || null, "unknown", "INTERCEPT_FAILED", "HioBuy did not accept the interception.", upstreamRequestId(response.payload), { startedAt: started, finishedAt: Date.now(), previousStatus: shipment.upstreamStatus, newStatus: shipment.upstreamStatus });
    throw new AppError("UPSTREAM_ERROR", "HioBuy did not accept the interception. The shipment status was not changed.", response.status || 502);
  }
  const now = Date.now();
  await db.update(shipments).set({ interceptionStatus: "REQUESTED", updatedAt: now }).where(eq(shipments.id, shipment.id));
  if (task) await logAttempt(db, { ...task, attemptCount: task.attemptCount + 1 }, "updated", response.status, null, null, null, upstreamRequestId(response.payload), { startedAt: started, finishedAt: now, previousStatus: shipment.upstreamStatus, newStatus: shipment.upstreamStatus });
  return { id: shipment.id, interceptionStatus: "REQUESTED" as const };
}

export async function noteClaimedPackage(db: Database, packageId: string) {
  const state = await connectedState(db);
  if (!state.connected) return;
  await insertTask(db, {
    entityType: "package",
    entityId: packageId,
    action: "inbound_create",
    status: "needs_review",
    externalRef: externalPackageRef(packageId),
    idempotencyKey: inboundIdempotencyKey(packageId),
    reason: "This package was claimed locally. Confirm it is not already in the HioBuy warehouse before sending a notice.",
  });
}

async function shipmentContext(db: Database, shipmentId: string) {
  const shipment = (await db.select().from(shipments).where(eq(shipments.id, shipmentId)))[0];
  if (!shipment) return null;
  const [address, method, links] = await Promise.all([
    db.select().from(shipmentAddresses).where(eq(shipmentAddresses.shipmentId, shipmentId)).then((rows) => rows[0] ?? null),
    db.select().from(shipmentMethods).where(eq(shipmentMethods.shipmentId, shipmentId)).then((rows) => rows[0] ?? null),
    db.select().from(shipmentPackages).where(eq(shipmentPackages.shipmentId, shipmentId)),
  ]);
  const ids = links.map((link) => link.packageId);
  const rows = ids.length ? await db.select().from(packages).where(inArray(packages.id, ids)) : [];
  return { shipment, address, method, packages: rows };
}

export async function enqueueShipmentCreate(db: Database, shipmentId: string) {
  const state = await connectedState(db);
  const context = await shipmentContext(db, shipmentId);
  if (!context) return;
  const ready = shipmentCreateReady({
    connected: state.connected,
    paused: state.paused,
    localStatus: context.shipment.status,
    remoteShipmentId: context.shipment.hiobuyShipmentId,
    channelCode: context.method?.routeCode ?? null,
    address: context.address,
    packages: context.packages.map((pkg) => ({ remoteId: pkg.hiobuyPackageId, remoteStatus: pkg.hiobuyStatus })),
  });
  const status = enqueueShipment(state.connected && !state.paused, ready.ready);
  if (status === "local_only") return;
  await insertTask(db, {
    entityType: "shipment",
    entityId: shipmentId,
    action: "shipment_create",
    status,
    externalRef: externalShipmentRef(shipmentId),
    idempotencyKey: shipmentIdempotencyKey(shipmentId),
    reason: ready.ready ? null : ready.reason,
  });
}

export async function noteShipmentCancelled(db: Database, shipmentId: string) {
  const task = (
    await db
      .select()
      .from(fulfillmentSyncTasks)
      .where(and(eq(fulfillmentSyncTasks.entityType, "shipment"), eq(fulfillmentSyncTasks.entityId, shipmentId), eq(fulfillmentSyncTasks.action, "shipment_create")))
  )[0];
  const shipment = (await db.select().from(shipments).where(eq(shipments.id, shipmentId)))[0];
  if (!shipment) return;
  const now = Date.now();
  if (!shipment.hiobuyShipmentId) {
    if (task && task.status !== "synced") {
      await db.update(fulfillmentSyncTasks).set({ status: "skipped", reason: "The shipment was cancelled before HioBuy created it.", updatedAt: now }).where(eq(fulfillmentSyncTasks.id, task.id));
    }
    return;
  }
  const remote = canonicalRemoteStatus(shipment.upstreamStatus);
  if (remote === "PENDING" || remote === "WAIT_PAYMENT" || !remote) {
    await insertTask(db, {
      entityType: "shipment",
      entityId: shipmentId,
      action: "shipment_cancel",
      status: "pending",
      externalRef: externalShipmentRef(shipmentId),
      idempotencyKey: `shipment-cancel:${shipmentId}`,
      reason: null,
    });
    return;
  }
  await insertTask(db, {
    entityType: "shipment",
    entityId: shipmentId,
    action: "shipment_cancel",
    status: "needs_review",
    externalRef: externalShipmentRef(shipmentId),
    idempotencyKey: `shipment-cancel:${shipmentId}`,
    reason: "The local shipment was cancelled after HioBuy moved past payment.",
  });
}

async function customerHasPaid(db: Database, shipmentId: string, localStatus: string) {
  if (localStatus === "READY_TO_SHIP" || localStatus === "SHIPPED" || localStatus === "IN_TRANSIT" || localStatus === "DELIVERED") return true;
  const links = await db.select({ checkoutId: checkoutItems.checkoutId }).from(checkoutItems).where(and(eq(checkoutItems.referenceType, "SHIPMENT"), eq(checkoutItems.referenceId, shipmentId)));
  if (!links.length) return false;
  const paid = await db.select({ id: payments.id }).from(payments).where(and(inArray(payments.checkoutId, links.map((link) => link.checkoutId)), eq(payments.status, "paid")));
  return paid.length > 0;
}

async function markFulfillmentPayment(db: Database, shipmentId: string, status: string, error: string | null) {
  const links = await db.select({ checkoutId: checkoutItems.checkoutId }).from(checkoutItems).where(and(eq(checkoutItems.referenceType, "SHIPMENT"), eq(checkoutItems.referenceId, shipmentId)));
  if (!links.length) return;
  await db.update(payments).set({ hiobuyStatus: status, hiobuyError: error }).where(and(inArray(payments.checkoutId, links.map((link) => link.checkoutId)), eq(payments.status, "paid")));
}

export async function queueShipmentPayments(db: Database, shipmentIds: string[]) {
  const state = await connectedState(db);
  if (!state.connected) return;
  for (const shipmentId of shipmentIds) {
    const shipment = (await db.select().from(shipments).where(eq(shipments.id, shipmentId)))[0];
    if (!shipment) continue;
    const ready = hiobuyPayReady({
      customerPaid: true,
      remoteId: shipment.hiobuyShipmentId,
      remoteStatus: shipment.upstreamStatus,
      paymentStatus: null,
    });
    await insertTask(db, {
      entityType: "shipment",
      entityId: shipmentId,
      action: "shipment_pay",
      status: "waiting",
      externalRef: externalShipmentRef(shipmentId),
      idempotencyKey: payIdempotencyKey(shipmentId),
      reason: ready.reason || "Waiting for an admin to pay HioBuy.",
    });
  }
}

export async function hiobuyPayQuote(db: Database, env: SyncEnv, shipmentId: string) {
  const shipment = await shipmentRow(db, shipmentId);
  const paid = await customerHasPaid(db, shipment.id, shipment.status);
  const ready = hiobuyPayReady({ customerPaid: paid, remoteId: shipment.hiobuyShipmentId, remoteStatus: shipment.upstreamStatus, paymentStatus: shipment.hiobuyPaymentStatus });
  const chargeRows = await db.select().from(charges).where(and(eq(charges.shipmentId, shipment.id), eq(charges.type, "FREIGHT"), eq(charges.status, "PAID")));
  const earning = (await db.select().from(shipmentEarnings).where(eq(shipmentEarnings.shipmentId, shipment.id)))[0];
  const task = (await db.select().from(fulfillmentSyncTasks).where(and(eq(fulfillmentSyncTasks.entityType, "shipment"), eq(fulfillmentSyncTasks.entityId, shipment.id), eq(fulfillmentSyncTasks.action, "shipment_pay"))))[0];
  const inFlight = task?.status === "syncing";
  let balanceCnyFen: number | null = null;
  let costCnyFen = earning?.hiobuyCostCnyFen ?? null;
  const token = await resolveHioBuyToken(db, env.HIOBUY_API_TOKEN);
  if (token && shipment.hiobuyShipmentId && (costCnyFen == null || costCnyFen <= 0)) {
    try {
      const detail = await readFulfillmentShipment(token, shipment.hiobuyShipmentId);
      const remoteCost = payableCnyFen(detail.payload);
      if (remoteCost != null && remoteCost > 0) {
        const { confirmHiobuyCost } = await import("./earnings");
        await confirmHiobuyCost(db, shipment.id, remoteCost);
        costCnyFen = remoteCost;
      }
    } catch {
      costCnyFen = earning?.hiobuyCostCnyFen ?? null;
    }
  }
  if (token) {
    try {
      const { fetchFulfillmentBalance } = await import("./services/hiobuy/wallet");
      const { readHioBuyBalance } = await import("../src/domain/hiobuy-wallet");
      balanceCnyFen = readHioBuyBalance(await fetchFulfillmentBalance(token))?.availableFen ?? null;
    } catch {
      balanceCnyFen = null;
    }
  }
  const short = balanceCnyFen != null && costCnyFen != null && balanceCnyFen < costCnyFen;
  const amountKnown = costCnyFen != null && costCnyFen > 0;
  return {
    ready: ready.ready && !inFlight && !short && amountKnown,
    already: ready.already,
    reason: inFlight ? "A HioBuy payment is already running for this shipment." : short ? "The HioBuy wallet does not cover this shipment." : !amountKnown && ready.ready ? "Sync this shipment so the HioBuy payable amount is on record." : ready.reason,
    publicId: shipment.publicId,
    hiobuyShipmentId: shipment.hiobuyShipmentId,
    customerPaidUsdFen: chargeRows.reduce((sum, row) => sum + row.amountFen, 0),
    costCnyFen,
    balanceCnyFen,
  };
}

export async function payHiobuyShipments(db: Database, env: SyncEnv, shipmentIds: string[]) {
  const ids = [...new Set(shipmentIds)].slice(0, 25);
  const items: { id: string; ok: boolean; skipped: boolean; message: string }[] = [];
  let stop = false;
  for (const id of ids) {
    if (stop) {
      items.push({ id, ok: false, skipped: true, message: "Not attempted. An earlier payment did not confirm, so this one was left unpaid." });
      continue;
    }
    try {
      const outcome = await payHiobuyShipment(db, env, id);
      const message = "already" in outcome && outcome.already ? "HioBuy had already recorded payment." : "recovered" in outcome && outcome.recovered ? "Confirmed from the HioBuy shipment. It was not charged again." : "HioBuy payment confirmed.";
      items.push({ id, ok: true, skipped: false, message });
    } catch (error) {
      const unclear = error instanceof AppError && error.code === "UPSTREAM_TIMEOUT";
      items.push({ id, ok: false, skipped: false, message: error instanceof AppError ? error.message : "HioBuy payment failed." });
      if (unclear) stop = true;
    }
  }
  return {
    paid: items.filter((item) => item.ok).length,
    failed: items.filter((item) => !item.ok && !item.skipped).length,
    skipped: items.filter((item) => item.skipped).length,
    items,
  };
}

export async function payHiobuyShipment(db: Database, env: SyncEnv, shipmentId: string) {
  if (env.DEMO_MODE === "true") throw new AppError("INVALID_STATE", "Demo mode does not pay HioBuy.", 409);
  const { hasFreshPayGrant } = await import("./pay-factor");
  if (!(await hasFreshPayGrant(db, shipmentId))) throw new AppError("FORBIDDEN", "Enter the authenticator code for this payment.", 403);
  const shipment = (await db.select().from(shipments).where(eq(shipments.id, shipmentId)))[0];
  if (!shipment?.hiobuyShipmentId) throw new AppError("INVALID_STATE", "This shipment is not linked to HioBuy.", 409);
  const task = await insertTask(db, {
    entityType: "shipment",
    entityId: shipment.id,
    action: "shipment_pay",
    status: "waiting",
    externalRef: externalShipmentRef(shipment.id),
    idempotencyKey: payIdempotencyKey(shipment.id),
    reason: "Waiting for an admin to pay HioBuy.",
  });
  if (task?.status === "syncing" && task.lockedAt && Date.now() - task.lockedAt < STALE_LOCK_MS) {
    throw new AppError("INVALID_STATE", "A HioBuy payment is already running for this shipment.", 409);
  }
  if (task?.errorCode === "TIMEOUT" || task?.reason === "confirm_remote") {
    const token = await resolveHioBuyToken(db, env.HIOBUY_API_TOKEN);
    if (token) {
      const detail = await readFulfillmentShipment(token, shipment.hiobuyShipmentId);
      const interpreted = interpretShipmentDetail({ timedOut: detail.timedOut, httpStatus: detail.status, payload: detail.payload });
      if (interpreted.kind === "ok" && (interpreted.shipment.paymentStatus === "PAID" || interpreted.shipment.status === "WAIT_SHIP" || interpreted.shipment.status === "SHIPPED" || interpreted.shipment.status === "SIGNED")) {
        await db.update(shipments).set({ upstreamStatus: interpreted.shipment.status, hiobuyPaymentStatus: interpreted.shipment.paymentStatus ?? "PAID", hiobuySyncedAt: Date.now(), updatedAt: Date.now() }).where(eq(shipments.id, shipment.id));
        return { ok: true as const, recovered: true as const, status: interpreted.shipment.status };
      }
      if (interpreted.kind === "retry") throw new AppError("UPSTREAM_TIMEOUT", "HioBuy did not confirm the earlier payment. It was not charged again.", 504);
    }
  }
  const quote = await hiobuyPayQuote(db, env, shipmentId);
  if (quote.already) return { ok: true as const, already: true as const, status: shipment.upstreamStatus };
  if (!quote.ready) throw new AppError("INVALID_STATE", quote.reason || "This shipment cannot be paid at HioBuy.", 409);
  const now = Date.now();
  if (task) {
    await db.update(fulfillmentSyncTasks).set({ status: "pending", reason: "admin_confirmed", nextAttemptAt: now, lockToken: null, lockedAt: null, errorCode: null, errorMessage: null, updatedAt: now }).where(eq(fulfillmentSyncTasks.id, task.id));
  }
  await processDueFulfillment(db, env, 1, [shipment.id]);
  const after = (await db.select().from(shipments).where(eq(shipments.id, shipment.id)))[0];
  const paid = after?.hiobuyPaymentStatus === "PAID" || after?.upstreamStatus === "WAIT_SHIP" || after?.upstreamStatus === "SHIPPED" || after?.upstreamStatus === "SIGNED";
  if (!paid) {
    const failed = task ? (await db.select().from(fulfillmentSyncTasks).where(eq(fulfillmentSyncTasks.id, task.id)))[0] : null;
    throw new AppError("UPSTREAM_ERROR", failed?.errorMessage || "HioBuy did not confirm payment. The customer wallet was not charged again.", 502);
  }
  return { ok: true as const, status: after?.upstreamStatus ?? "WAIT_SHIP" };
}

export async function requeueHiobuyPayment(db: Database, paymentId: string) {
  const payment = (await db.select().from(payments).where(eq(payments.id, paymentId)))[0];
  if (!payment || payment.status !== "paid") throw new AppError("INVALID_STATE", "Only a paid customer payment can be retried with HioBuy.", 409);
  const links = payment.checkoutId
    ? await db.select({ referenceId: checkoutItems.referenceId }).from(checkoutItems).where(and(eq(checkoutItems.checkoutId, payment.checkoutId), eq(checkoutItems.referenceType, "SHIPMENT")))
    : [];
  const ids = payment.shipmentId ? [payment.shipmentId] : links.map((link) => link.referenceId);
  if (!ids.length) throw new AppError("NOT_FOUND", "This payment is not tied to a shipment.", 404);
  await queueShipmentPayments(db, ids);
  for (const id of ids) {
    await db
      .update(fulfillmentSyncTasks)
      .set({ status: "waiting", reason: "Waiting for an admin to pay HioBuy.", nextAttemptAt: null, errorMessage: null, updatedAt: Date.now() })
      .where(and(eq(fulfillmentSyncTasks.entityType, "shipment"), eq(fulfillmentSyncTasks.entityId, id), eq(fulfillmentSyncTasks.action, "shipment_pay"), inArray(fulfillmentSyncTasks.status, ["waiting", "failed", "needs_review", "pending"])));
  }
  await db.update(payments).set({ hiobuyStatus: "pending", hiobuyError: null }).where(eq(payments.id, payment.id));
  return { ok: true as const };
}

function historyStatus(kind: string) {
  if (kind === "candidate") return "candidate";
  if (kind === "skipped") return "skipped";
  if (kind === "needs_review") return "needs_review";
  return null;
}

export async function scanHistoricalSync(db: Database) {
  const state = await connectedState(db);
  if (!state.connected) return { packages: 0, shipments: 0 };
  const packageRows = await db.select().from(packages);
  const shipmentRows = await db.select().from(shipments);
  let packageCount = 0;
  let shipmentCount = 0;
  for (const pkg of packageRows) {
    const kind = classifyPackageHistory({ remoteId: pkg.hiobuyInboundNoticeId ?? pkg.hiobuyPackageId, packageStatus: pkg.packageStatus, disposition: pkg.disposition });
    const status = historyStatus(kind);
    if (!status) continue;
    const existing = (
      await db
        .select()
        .from(fulfillmentSyncTasks)
        .where(and(eq(fulfillmentSyncTasks.entityType, "package"), eq(fulfillmentSyncTasks.entityId, pkg.id), eq(fulfillmentSyncTasks.action, "inbound_create")))
    )[0];
    if (existing && !["candidate", "skipped", "needs_review"].includes(existing.status)) continue;
    const reason = status === "candidate" ? "Created before HioBuy was connected." : status === "skipped" ? "Completed, returned, or disposal records stay local." : "Received locally before a HioBuy package was linked. Review before sending a notice.";
    if (!existing) {
      await insertTask(db, { entityType: "package", entityId: pkg.id, action: "inbound_create", status, externalRef: externalPackageRef(pkg.id), idempotencyKey: inboundIdempotencyKey(pkg.id), reason });
      packageCount += 1;
    } else if (existing.status !== status) {
      await db.update(fulfillmentSyncTasks).set({ status, reason, updatedAt: Date.now() }).where(eq(fulfillmentSyncTasks.id, existing.id));
    }
  }
  for (const shipment of shipmentRows) {
    const links = await db.select({ packageId: shipmentPackages.packageId }).from(shipmentPackages).where(eq(shipmentPackages.shipmentId, shipment.id));
    const rows = links.length ? await db.select({ remoteId: packages.hiobuyPackageId, remoteStatus: packages.hiobuyStatus }).from(packages).where(inArray(packages.id, links.map((link) => link.packageId))) : [];
    const ready = rows.length > 0 && rows.every((row) => row.remoteId && canonicalRemoteStatus(row.remoteStatus) === "RECEIVED");
    const kind = classifyShipmentHistory({ remoteId: shipment.hiobuyShipmentId, status: shipment.status, packagesReady: ready });
    const status = historyStatus(kind);
    if (!status) continue;
    const existing = (
      await db
        .select()
        .from(fulfillmentSyncTasks)
        .where(and(eq(fulfillmentSyncTasks.entityType, "shipment"), eq(fulfillmentSyncTasks.entityId, shipment.id), eq(fulfillmentSyncTasks.action, "shipment_create")))
    )[0];
    if (existing && !["candidate", "skipped", "needs_review"].includes(existing.status)) continue;
    const reason = status === "candidate" ? "Ready to submit to HioBuy after review." : status === "skipped" ? "Cancelled or finished shipments are not sent to HioBuy." : "The shipment is missing a received HioBuy package, or local payment already moved ahead.";
    if (!existing) {
      await insertTask(db, { entityType: "shipment", entityId: shipment.id, action: "shipment_create", status, externalRef: externalShipmentRef(shipment.id), idempotencyKey: shipmentIdempotencyKey(shipment.id), reason });
      shipmentCount += 1;
    } else if (existing.status !== status) {
      await db.update(fulfillmentSyncTasks).set({ status, reason, updatedAt: Date.now() }).where(eq(fulfillmentSyncTasks.id, existing.id));
    }
  }
  return { packages: packageCount, shipments: shipmentCount };
}

export async function onAccessRestored(db: Database) {
  const effect = afterCredentialChange({ accessOk: true, warehouseIdChanged: false });
  if (effect.clearPause) {
    await db.update(freightPolicy).set({ syncPauseCode: null, syncPauseMessage: null, updatedAt: Date.now() }).where(eq(freightPolicy.id, SINGLETON_ID));
  }
  if (effect.requeueAuthFailures) {
    await db
      .update(fulfillmentSyncTasks)
      .set({ status: "pending", nextAttemptAt: Date.now(), errorClass: null, errorCode: null, errorMessage: null, updatedAt: Date.now() })
      .where(and(eq(fulfillmentSyncTasks.status, "failed"), eq(fulfillmentSyncTasks.errorClass, "auth")));
  }
}

export async function onWarehouseChanged(db: Database) {
  const effect = afterCredentialChange({ accessOk: true, warehouseIdChanged: true });
  if (!effect.reviewOpenTasks) return;
  await db
    .update(fulfillmentSyncTasks)
    .set({ status: "needs_review", reason: "The HioBuy warehouse authorization changed. Review this task before retrying.", updatedAt: Date.now() })
    .where(inArray(fulfillmentSyncTasks.status, ["pending", "waiting", "failed"]));
}

async function logAttempt(
  db: Database,
  task: TaskRow,
  outcome: string,
  httpStatus: number | null,
  errorClass: string | null,
  code: string | null,
  message: string | null,
  requestId: string | null,
  extra?: { startedAt?: number; finishedAt?: number; previousStatus?: string | null; newStatus?: string | null },
) {
  const now = Date.now();
  await db.insert(fulfillmentSyncAttempts).values({
    id: crypto.randomUUID(),
    taskId: task.id,
    attempt: task.attemptCount,
    httpStatus,
    outcome,
    errorClass,
    errorCode: code,
    errorMessage: message ? redactSensitive(message) : null,
    upstreamRequestId: requestId,
    operation: task.action,
    startedAt: extra?.startedAt ?? null,
    finishedAt: extra?.finishedAt ?? now,
    previousStatus: extra?.previousStatus ?? null,
    newStatus: extra?.newStatus ?? null,
    createdAt: now,
  });
}

async function finishTask(db: Database, task: TaskRow, outcome: SyncOutcome, httpStatus: number | null, requestId: string | null) {
  const now = Date.now();
  if (outcome.kind === "synced") {
    await db
      .update(fulfillmentSyncTasks)
      .set({
        status: "synced",
        remoteId: outcome.remoteId,
        remoteSecondary: outcome.orderSn,
        remoteStatus: outcome.remoteStatus,
        errorClass: null,
        errorCode: null,
        errorMessage: null,
        lockToken: null,
        lockedAt: null,
        reason: null,
        updatedAt: now,
      })
      .where(eq(fulfillmentSyncTasks.id, task.id));
    await logAttempt(db, task, "synced", httpStatus, null, null, null, requestId);
    return outcome;
  }
  if (outcome.kind === "retry") {
    const at = nextRetryAt(task.attemptCount, now, outcome.retryAfterMs);
    await db
      .update(fulfillmentSyncTasks)
      .set({
        status: at == null ? "failed" : "pending",
        nextAttemptAt: at,
        errorClass: outcome.errorClass,
        errorCode: outcome.code,
        errorMessage: redactSensitive(outcome.message),
        lockToken: null,
        lockedAt: null,
        updatedAt: now,
      })
      .where(eq(fulfillmentSyncTasks.id, task.id));
    await logAttempt(db, task, at == null ? "failed" : "retry", httpStatus, outcome.errorClass, outcome.code, outcome.message, requestId);
    return outcome;
  }
  if (outcome.kind === "pause") {
    await db.update(freightPolicy).set({ syncPauseCode: outcome.code, syncPauseMessage: redactSensitive(outcome.message), updatedAt: now }).where(eq(freightPolicy.id, SINGLETON_ID));
    await db
      .update(fulfillmentSyncTasks)
      .set({ status: "failed", errorClass: "auth", errorCode: outcome.code, errorMessage: redactSensitive(outcome.message), lockToken: null, lockedAt: null, updatedAt: now })
      .where(eq(fulfillmentSyncTasks.id, task.id));
    await logAttempt(db, task, "pause", httpStatus, "auth", outcome.code, outcome.message, requestId);
    return outcome;
  }
  const errorClass = outcome.kind === "failed" ? outcome.errorClass : "conflict";
  const message = redactSensitive(outcome.message);
  await db
    .update(fulfillmentSyncTasks)
    .set({
      status: outcome.kind === "review" ? "needs_review" : "failed",
      errorClass,
      errorCode: outcome.code,
      errorMessage: message,
      reason: outcome.kind === "review" ? message : task.reason,
      lockToken: null,
      lockedAt: null,
      updatedAt: now,
    })
    .where(eq(fulfillmentSyncTasks.id, task.id));
  await logAttempt(db, task, outcome.kind, httpStatus, errorClass, outcome.code, outcome.message, requestId);
  return outcome;
}

async function runInbound(db: Database, env: SyncEnv, task: TaskRow) {
  const pkg = (await db.select().from(packages).where(eq(packages.id, task.entityId)))[0];
  if (!pkg) return finishTask(db, task, { kind: "review", code: "NOT_FOUND", message: "The local package no longer exists." }, null, null);
  const linkedId = pkg.hiobuyPackageId ?? pkg.hiobuyInboundNoticeId;
  if (!allowRemoteCreate(linkedId, task.status === "syncing" ? "pending" : task.status)) {
    if (linkedId) {
      return finishTask(db, task, { kind: "synced", remoteId: linkedId, remoteStatus: pkg.hiobuyStatus ?? pkg.packageStatus ?? "PENDING", orderSn: null }, null, null);
    }
  }
  const token = (await resolveHioBuyToken(db, env.HIOBUY_API_TOKEN)) ?? "";
  const body = inboundNoticeBody({
    tracking: pkg.domesticTrackingNumber,
    courier: pkg.courier,
    externalRef: task.externalRef,
    declaredValueFen: pkg.declaredValueFen,
    productName: pkg.productName,
    quantity: pkg.quantity,
  });
  const response = await createInboundNotice(token, body, task.idempotencyKey);
  const outcome = interpretInboundResponse({ timedOut: response.timedOut, httpStatus: response.status, payload: response.payload, ourExternal: task.externalRef, ourTracking: pkg.domesticTrackingNumber });
  if (outcome.kind === "synced") {
    const now = Date.now();
    const packageId = outcome.warehousePackageId || outcome.remoteId;
    await db
      .update(packages)
      .set({
        hiobuyInboundNoticeId: outcome.noticeId ?? outcome.remoteId,
        hiobuyPackageId: packageId,
        hiobuyStatus: outcome.remoteStatus || "PENDING",
        hiobuySyncedAt: now,
        updatedAt: now,
      })
      .where(eq(packages.id, pkg.id));
    await rememberLink(db, { localType: "package", localId: pkg.id, remoteType: "package", remoteId: outcome.remoteId, externalRef: task.externalRef, trackingNumber: pkg.domesticTrackingNumber, remoteStatus: outcome.remoteStatus });
  }
  return finishTask(db, task, outcome, response.status, upstreamRequestId(response.payload));
}

async function runShipmentCreate(db: Database, env: SyncEnv, task: TaskRow) {
  const context = await shipmentContext(db, task.entityId);
  if (!context) return finishTask(db, task, { kind: "review", code: "NOT_FOUND", message: "The local shipment no longer exists." }, null, null);
  const state = await connectedState(db);
  const ready = shipmentCreateReady({
    connected: state.connected,
    paused: false,
    localStatus: context.shipment.status,
    remoteShipmentId: context.shipment.hiobuyShipmentId,
    channelCode: context.method?.routeCode ?? null,
    address: context.address,
    packages: context.packages.map((pkg) => ({ remoteId: pkg.hiobuyPackageId, remoteStatus: pkg.hiobuyStatus })),
  });
  if (context.shipment.hiobuyShipmentId) {
    return finishTask(db, task, { kind: "synced", remoteId: context.shipment.hiobuyShipmentId, remoteStatus: context.shipment.upstreamStatus ?? "PENDING", orderSn: task.remoteSecondary }, null, null);
  }
  if (!ready.ready || !context.address || !context.method) {
    await db.update(fulfillmentSyncTasks).set({ status: "waiting", reason: ready.reason, lockToken: null, lockedAt: null, updatedAt: Date.now() }).where(eq(fulfillmentSyncTasks.id, task.id));
    return { kind: "retry" as const };
  }
  const token = (await resolveHioBuyToken(db, env.HIOBUY_API_TOKEN)) ?? "";
  const response = await createFulfillmentShipment(
    token,
    {
      tracking_numbers: context.packages.map((pkg) => pkg.domesticTrackingNumber),
      shipping_channel_code: context.method.routeCode,
      receiver: hiobuyReceiver(context.address),
      external_shipment_id: task.externalRef,
      remark: context.shipment.packingNote ?? context.shipment.packingInstruction ?? undefined,
    },
    task.idempotencyKey,
  );
  const outcome = interpretShipmentCreate({ timedOut: response.timedOut, httpStatus: response.status, payload: response.payload, ourExternal: task.externalRef });
  if (outcome.kind === "synced") {
    const now = Date.now();
    await db
      .update(shipments)
      .set({ hiobuyShipmentId: outcome.remoteId, upstreamStatus: outcome.remoteStatus, hiobuySyncedAt: now, updatedAt: now })
      .where(eq(shipments.id, context.shipment.id));
    await rememberLink(db, { localType: "shipment", localId: context.shipment.id, remoteType: "shipment", remoteId: outcome.remoteId, externalRef: task.externalRef, remoteStatus: outcome.remoteStatus });
    const packageIds = context.packages.map((pkg) => pkg.id);
    if (packageIds.length) {
      await db
        .update(packages)
        .set({ packageStatus: "CONSOLIDATED", hiobuyStatus: "CONSOLIDATED", updatedAt: now })
        .where(and(inArray(packages.id, packageIds), inArray(packages.packageStatus, ["PENDING", "RECEIVED", "SHIPPED"])));
    }
  }
  return finishTask(db, task, outcome, response.status, upstreamRequestId(response.payload));
}

async function runShipmentPay(db: Database, env: SyncEnv, task: TaskRow) {
  const shipment = (await db.select().from(shipments).where(eq(shipments.id, task.entityId)))[0];
  if (!shipment) return finishTask(db, task, { kind: "review", code: "NOT_FOUND", message: "The local shipment no longer exists." }, null, null);
  const paid = await customerHasPaid(db, shipment.id, shipment.status);
  const ready = hiobuyPayReady({ customerPaid: paid, remoteId: shipment.hiobuyShipmentId, remoteStatus: shipment.upstreamStatus, paymentStatus: shipment.hiobuyPaymentStatus });
  if (ready.already && shipment.hiobuyShipmentId) {
    await db.update(shipments).set({ hiobuyPaymentStatus: "PAID", upstreamStatus: shipment.upstreamStatus === "WAIT_PAYMENT" || !shipment.upstreamStatus ? "WAIT_SHIP" : shipment.upstreamStatus, hiobuySyncedAt: Date.now(), updatedAt: Date.now() }).where(eq(shipments.id, shipment.id));
    await markFulfillmentPayment(db, shipment.id, "paid", null);
    return finishTask(db, task, { kind: "synced", remoteId: shipment.hiobuyShipmentId, remoteStatus: "WAIT_SHIP", orderSn: task.remoteSecondary }, null, null);
  }
  if (!ready.ready || !shipment.hiobuyShipmentId) {
    await db.update(fulfillmentSyncTasks).set({ status: "waiting", reason: ready.reason, lockToken: null, lockedAt: null, updatedAt: Date.now() }).where(eq(fulfillmentSyncTasks.id, task.id));
    return { kind: "retry" as const };
  }
  if (env.DEMO_MODE === "true") {
    await db.update(fulfillmentSyncTasks).set({ status: "waiting", reason: "Demo mode does not pay HioBuy.", lockToken: null, lockedAt: null, updatedAt: Date.now() }).where(eq(fulfillmentSyncTasks.id, task.id));
    return { kind: "retry" as const };
  }
  const { consumePayGrant } = await import("./pay-factor");
  if (!(await consumePayGrant(db, shipment.id))) {
    await db.update(fulfillmentSyncTasks).set({ status: "waiting", reason: "Waiting for an authenticator code.", lockToken: null, lockedAt: null, updatedAt: Date.now() }).where(eq(fulfillmentSyncTasks.id, task.id));
    return { kind: "retry" as const };
  }
  const token = (await resolveHioBuyToken(db, env.HIOBUY_API_TOKEN)) ?? "";
  const response = await payFulfillmentShipment(token, shipment.hiobuyShipmentId, task.idempotencyKey);
  const outcome = interpretPayResponse({ timedOut: response.timedOut, httpStatus: response.status, payload: response.payload });
  if (outcome.kind === "synced") {
    const now = Date.now();
    await db.update(shipments).set({ upstreamStatus: outcome.remoteStatus || "WAIT_SHIP", hiobuyPaymentStatus: "PAID", status: shipment.status === "TO_PAY" ? "READY_TO_SHIP" : shipment.status, hiobuySyncedAt: now, updatedAt: now }).where(eq(shipments.id, shipment.id));
    await markFulfillmentPayment(db, shipment.id, "paid", null);
    try {
      const detail = await readFulfillmentShipment(token, shipment.hiobuyShipmentId);
      const cost = payableCnyFen(detail.payload);
      if (cost != null) {
        const { confirmHiobuyCost } = await import("./earnings");
        await confirmHiobuyCost(db, shipment.id, cost);
      }
    } catch (error) {
      logEvent({ level: "error", message: "HioBuy pay succeeded but the cost snapshot failed", detail: error instanceof Error ? error.message : "unknown" });
    }
  } else if (outcome.kind === "retry") {
    const now = Date.now();
    await db.update(fulfillmentSyncTasks).set({ status: "waiting", reason: "confirm_remote", nextAttemptAt: null, errorClass: outcome.errorClass, errorCode: outcome.code, errorMessage: redactSensitive(outcome.message), lockToken: null, lockedAt: null, updatedAt: now }).where(eq(fulfillmentSyncTasks.id, task.id));
    await logAttempt(db, task, "retry", response.status, outcome.errorClass, outcome.code, outcome.message, upstreamRequestId(response.payload));
    return outcome;
  } else if (outcome.kind === "failed" || outcome.kind === "review" || outcome.kind === "pause") {
    await markFulfillmentPayment(db, shipment.id, "failed", redactSensitive(outcome.message));
  }
  return finishTask(db, task, outcome.kind === "synced" ? { ...outcome, remoteId: shipment.hiobuyShipmentId } : outcome, response.status, upstreamRequestId(response.payload));
}

async function runShipmentCancel(db: Database, env: SyncEnv, task: TaskRow) {
  const shipment = (await db.select().from(shipments).where(eq(shipments.id, task.entityId)))[0];
  if (!shipment?.hiobuyShipmentId) return finishTask(db, task, { kind: "synced", remoteId: "none", remoteStatus: "CANCELLED", orderSn: null }, null, null);
  const token = (await resolveHioBuyToken(db, env.HIOBUY_API_TOKEN)) ?? "";
  const response = await cancelFulfillmentShipment(token, shipment.hiobuyShipmentId, "buyer_request");
  const outcome = interpretShipmentCreate({ timedOut: response.timedOut, httpStatus: response.status, payload: response.payload, ourExternal: task.externalRef });
  if (response.status >= 200 && response.status < 300) {
    await db.update(shipments).set({ upstreamStatus: "CANCELLED", hiobuySyncedAt: Date.now(), updatedAt: Date.now() }).where(eq(shipments.id, shipment.id));
    return finishTask(db, task, { kind: "synced", remoteId: shipment.hiobuyShipmentId, remoteStatus: "CANCELLED", orderSn: null }, response.status, upstreamRequestId(response.payload));
  }
  return finishTask(db, task, outcome.kind === "synced" ? { kind: "review", code: "CANCEL_UNCONFIRMED", message: "HioBuy did not confirm cancellation." } : outcome, response.status, upstreamRequestId(response.payload));
}

async function executeTask(db: Database, env: SyncEnv, task: TaskRow) {
  if (task.action === "inbound_create") return runInbound(db, env, task);
  if (task.action === "shipment_create") return runShipmentCreate(db, env, task);
  if (task.action === "shipment_pay") {
    if (task.reason !== "admin_confirmed") {
      await db.update(fulfillmentSyncTasks).set({ status: "waiting", reason: task.reason ?? "Waiting for an admin to pay HioBuy.", lockToken: null, lockedAt: null, updatedAt: Date.now() }).where(eq(fulfillmentSyncTasks.id, task.id));
      return { kind: "retry" as const };
    }
    return runShipmentPay(db, env, task);
  }
  if (task.action === "shipment_cancel") return runShipmentCancel(db, env, task);
  return finishTask(db, task, { kind: "review", code: "UNKNOWN_ACTION", message: "This sync action is not supported." }, null, null);
}

async function promoteWaiting(db: Database) {
  const waiting = await db.select().from(fulfillmentSyncTasks).where(eq(fulfillmentSyncTasks.status, "waiting")).limit(20);
  for (const task of waiting) {
    if (task.action === "shipment_create") {
      const context = await shipmentContext(db, task.entityId);
      if (!context) continue;
      const ready = shipmentCreateReady({
        connected: true,
        paused: false,
        localStatus: context.shipment.status,
        remoteShipmentId: context.shipment.hiobuyShipmentId,
        channelCode: context.method?.routeCode ?? null,
        address: context.address,
        packages: context.packages.map((pkg) => ({ remoteId: pkg.hiobuyPackageId, remoteStatus: pkg.hiobuyStatus })),
      });
      if (ready.ready) await db.update(fulfillmentSyncTasks).set({ status: "pending", nextAttemptAt: Date.now(), reason: null, updatedAt: Date.now() }).where(eq(fulfillmentSyncTasks.id, task.id));
    }
    if (task.action === "shipment_pay") continue;
  }
}

export async function processDueFulfillment(db: Database, env: SyncEnv, limit = 5, onlyEntityIds?: string[]) {
  const now = Date.now();
  await db
    .update(fulfillmentSyncTasks)
    .set({ status: "pending", lockToken: null, lockedAt: null, updatedAt: now })
    .where(and(eq(fulfillmentSyncTasks.status, "syncing"), lt(fulfillmentSyncTasks.lockedAt, now - STALE_LOCK_MS)));
  if (await paused(db)) return { processed: 0, paused: true as const };
  await promoteWaiting(db);
  const due = await db
    .select()
    .from(fulfillmentSyncTasks)
    .where(
      and(
        eq(fulfillmentSyncTasks.status, "pending"),
        or(sql`${fulfillmentSyncTasks.nextAttemptAt} is null`, lt(fulfillmentSyncTasks.nextAttemptAt, now + 1)),
        onlyEntityIds?.length ? inArray(fulfillmentSyncTasks.entityId, onlyEntityIds) : undefined,
      ),
    )
    .limit(limit);
  let processed = 0;
  for (const task of due) {
    const lock = crypto.randomUUID();
    const claimed = await db
      .update(fulfillmentSyncTasks)
      .set({ status: "syncing", lockToken: lock, lockedAt: now, attemptCount: task.attemptCount + 1, updatedAt: now })
      .where(and(eq(fulfillmentSyncTasks.id, task.id), eq(fulfillmentSyncTasks.status, "pending")))
      .returning({ id: fulfillmentSyncTasks.id });
    if (!claimed.length) continue;
    const current = { ...task, status: "syncing", attemptCount: task.attemptCount + 1, lockToken: lock };
    try {
      const outcome = await executeTask(db, env, current);
      processed += 1;
      if (outcome && "kind" in outcome && outcome.kind === "pause") break;
    } catch (error) {
      logEvent({ level: "error", message: "Fulfillment sync task failed", detail: redactSensitive(error instanceof Error ? error.message : "unknown") });
      await finishTask(db, current, { kind: "retry", errorClass: "transient", code: "INTERNAL", message: "The sync task stopped before HioBuy answered.", retryAfterMs: null }, null, null);
    }
  }
  return { processed, paused: false as const };
}

export async function fulfillmentSyncList(db: Database, query: { entity?: string; bucket?: string }) {
  const pause = await paused(db);
  const rows = await db.select().from(fulfillmentSyncTasks).orderBy(desc(fulfillmentSyncTasks.updatedAt)).limit(300);
  const counts = { pending: 0, syncing: 0, synced: 0, failed: 0, needs_review: 0 };
  for (const row of rows) {
    const bucket = syncBucket(row.status);
    if (bucket) counts[bucket] += 1;
  }
  const entity = query.entity === "package" || query.entity === "shipment" ? query.entity : "";
  const statuses = query.bucket ? bucketStatuses(query.bucket) : [];
  const filtered = rows.filter((row) => (!entity || row.entityType === entity) && (!statuses.length || statuses.includes(row.status)));
  const packageIds = filtered.filter((row) => row.entityType === "package").map((row) => row.entityId);
  const shipmentIds = filtered.filter((row) => row.entityType === "shipment").map((row) => row.entityId);
  const [packageRows, shipmentRows] = await Promise.all([
    packageIds.length ? db.select({ id: packages.id, publicId: packages.publicId, tracking: packages.domesticTrackingNumber }).from(packages).where(inArray(packages.id, packageIds)) : Promise.resolve([]),
    shipmentIds.length ? db.select({ id: shipments.id, publicId: shipments.publicId, tracking: shipments.trackingNumber }).from(shipments).where(inArray(shipments.id, shipmentIds)) : Promise.resolve([]),
  ]);
  const names = new Map<string, { publicId: string; tracking: string | null }>();
  for (const row of packageRows) names.set(`package:${row.id}`, { publicId: row.publicId, tracking: row.tracking });
  for (const row of shipmentRows) names.set(`shipment:${row.id}`, { publicId: row.publicId, tracking: row.tracking });
  return {
    paused: pause,
    counts,
    webhookConfigured: Boolean((await freightPolicyRow(db)).webhookCiphertext),
    items: filtered.slice(0, 80).map((row) => {
      const name = names.get(`${row.entityType}:${row.entityId}`);
      return {
        id: row.id,
        entityType: row.entityType,
        entityId: row.entityId,
        publicId: name?.publicId ?? row.entityId,
        tracking: name?.tracking ?? null,
        action: row.action,
        status: row.status,
        label: syncListLabel(row.status),
        remoteId: row.remoteId,
        remoteSecondary: row.remoteSecondary,
        remoteStatus: row.remoteStatus,
        externalRef: row.externalRef,
        attemptCount: row.attemptCount,
        errorCode: row.errorCode,
        errorMessage: row.errorMessage,
        reason: row.reason,
        canRetry: canManualRetry(row.status, row.errorClass),
        selectable: row.status === "candidate",
        updatedAt: new Date(row.updatedAt).toISOString(),
      };
    }),
  };
}

export async function fulfillmentSyncDetail(db: Database, id: string) {
  const task = (await db.select().from(fulfillmentSyncTasks).where(eq(fulfillmentSyncTasks.id, id)))[0];
  if (!task) throw new AppError("NOT_FOUND", "Sync task not found.", 404);
  const attempts = await db.select().from(fulfillmentSyncAttempts).where(eq(fulfillmentSyncAttempts.taskId, id)).orderBy(desc(fulfillmentSyncAttempts.createdAt)).limit(30);
  const links = await db
    .select()
    .from(fulfillmentRemoteLinks)
    .where(and(eq(fulfillmentRemoteLinks.localType, task.entityType), eq(fulfillmentRemoteLinks.localId, task.entityId)));
  return {
    id: task.id,
    status: task.status,
    label: syncListLabel(task.status),
    remoteId: task.remoteId,
    remoteSecondary: task.remoteSecondary,
    externalRef: task.externalRef,
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
    reason: task.reason,
    canRetry: canManualRetry(task.status, task.errorClass),
    links: links.map((link) => ({ remoteType: link.remoteType, remoteId: link.remoteId, externalRef: link.externalRef, trackingNumber: link.trackingNumber, remoteStatus: link.remoteStatus })),
    attempts: attempts.map((attempt) => ({
      id: attempt.id,
      attempt: attempt.attempt,
      httpStatus: attempt.httpStatus,
      outcome: attempt.outcome,
      errorCode: attempt.errorCode,
      errorMessage: attempt.errorMessage,
      upstreamRequestId: attempt.upstreamRequestId,
      createdAt: new Date(attempt.createdAt).toISOString(),
    })),
  };
}

export async function retrySyncTask(db: Database, id: string) {
  const task = (await db.select().from(fulfillmentSyncTasks).where(eq(fulfillmentSyncTasks.id, id)))[0];
  if (!task) throw new AppError("NOT_FOUND", "Sync task not found.", 404);
  if (!canManualRetry(task.status, task.errorClass)) throw new AppError("INVALID_STATE", "This task cannot be retried safely.", 409);
  if (await paused(db)) throw new AppError("HIOBUY_PAUSED", "HioBuy authorization is paused. Test the connection, then retry.", 409);
  await db
    .update(fulfillmentSyncTasks)
    .set({ status: "pending", nextAttemptAt: Date.now(), attemptCount: 0, errorClass: null, errorCode: null, errorMessage: null, lockToken: null, lockedAt: null, updatedAt: Date.now() })
    .where(eq(fulfillmentSyncTasks.id, id));
  return { ok: true as const };
}

export async function enqueueSyncCandidates(db: Database, ids: string[]) {
  if (!ids.length) throw new AppError("VALIDATION_ERROR", "Select at least one record.");
  const rows = await db.select().from(fulfillmentSyncTasks).where(inArray(fulfillmentSyncTasks.id, ids));
  const allowed = rows.filter((row) => row.status === "candidate");
  if (!allowed.length) throw new AppError("INVALID_STATE", "Only records waiting for review can be submitted.", 409);
  const now = Date.now();
  await db.update(fulfillmentSyncTasks).set({ status: "pending", nextAttemptAt: now, reason: null, updatedAt: now }).where(inArray(fulfillmentSyncTasks.id, allowed.map((row) => row.id)));
  return { queued: allowed.length };
}

export async function saveHiobuyWebhookSecret(db: Database, env: SyncEnv, secret: string) {
  if (!env.BETTER_AUTH_SECRET) throw new AppError("CONFIG", "Authentication is not configured.", 500);
  const trimmed = secret.trim();
  const ciphertext = trimmed ? await encryptSecret(env.BETTER_AUTH_SECRET, trimmed) : null;
  await freightPolicyRow(db);
  await db.update(freightPolicy).set({ webhookCiphertext: ciphertext, updatedAt: Date.now() }).where(eq(freightPolicy.id, SINGLETON_ID));
  return { configured: Boolean(ciphertext) };
}

export async function hiobuyWebhookActivity(db: Database) {
  const policy = await freightPolicyRow(db);
  const events = await db.select().from(fulfillmentWebhookEvents).orderBy(desc(fulfillmentWebhookEvents.receivedAt)).limit(25);
  let balanceAlert: { available: number; currency: string; threshold: number | null; at: string } | null = null;
  try {
    balanceAlert = policy.balanceAlert ? JSON.parse(policy.balanceAlert) : null;
  } catch {
    balanceAlert = null;
  }
  return {
    configured: Boolean(policy.webhookCiphertext),
    rejectedAt: policy.webhookRejectedAt ? new Date(policy.webhookRejectedAt).toISOString() : null,
    balanceAlert,
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      livemode: event.livemode,
      status: event.status,
      outcome: event.outcome,
      error: event.error,
      receivedAt: new Date(event.receivedAt).toISOString(),
    })),
  };
}

export async function clearBalanceAlert(db: Database) {
  await freightPolicyRow(db);
  await db.update(freightPolicy).set({ balanceAlert: null, updatedAt: Date.now() }).where(eq(freightPolicy.id, SINGLETON_ID));
  return { ok: true as const };
}

async function findPackageByRemote(db: Database, remoteId: string | null, external: string | null) {
  if (remoteId) {
    const linked = (await db.select().from(packages).where(eq(packages.hiobuyPackageId, remoteId)))[0]
      ?? (await db.select().from(packages).where(eq(packages.hiobuyInboundNoticeId, remoteId)))[0];
    if (linked) return linked;
  }
  if (external?.startsWith("pkg_")) {
    const localId = external.slice(4);
    return (await db.select().from(packages).where(eq(packages.id, localId)))[0] ?? null;
  }
  return null;
}

async function findShipmentByRemote(db: Database, remoteId: string | null, external: string | null) {
  if (external?.startsWith("shp_")) {
    const localId = external.slice(4);
    const row = (await db.select().from(shipments).where(eq(shipments.id, localId)))[0];
    if (row) return row;
  }
  if (remoteId) return (await db.select().from(shipments).where(eq(shipments.hiobuyShipmentId, remoteId)))[0] ?? null;
  return null;
}

async function applyReceivedPackage(db: Database, env: SyncEnv, remoteId: string | null, external: string | null): Promise<string> {
  const pkg = await findPackageByRemote(db, remoteId, external);
  if (!pkg) return "No matching local package.";
  const stored = remoteRank(pkg.hiobuyStatus);
  const incoming = remoteRank("RECEIVED");
  if (webhookDisposition({ signatureOk: true, duplicate: false, incomingRank: incoming, storedRank: stored }) === "stale") return `${pkg.publicId} is already further along. Ignored.`;
  let remoteView: { id: string; status: string; externalOrderId: string | null; condition: "NORMAL" | "EXCEPTION" | null; weightGrams: number | null; lengthMm: number | null; widthMm: number | null; heightMm: number | null; receivedAt: string | null } = {
    id: remoteId || pkg.hiobuyPackageId || "",
    status: "RECEIVED",
    externalOrderId: external,
    condition: null,
    weightGrams: null,
    lengthMm: null,
    widthMm: null,
    heightMm: null,
    receivedAt: null,
  };
  const token = await resolveHioBuyToken(db, env.HIOBUY_API_TOKEN);
  if (token && remoteId) {
    const detail = await readFulfillmentPackage(token, remoteId);
    const interpreted = interpretPackageDetail({ timedOut: detail.timedOut, httpStatus: detail.status, payload: detail.payload });
    if (interpreted.kind === "ok" && interpreted.package.id === remoteId) remoteView = interpreted.package;
    else return `Could not read ${remoteId} from HioBuy. Nothing changed.`;
  }
  if (!remoteView.id) return "No HioBuy package id in the event.";
  const linked = { ...pkg, hiobuyPackageId: pkg.hiobuyPackageId ?? remoteId };
  const decision = decidePackagePull(pullLocal(linked), remoteView, externalPackageRef(pkg.id));
  if (decision.result !== "updated") return `${pkg.publicId} is already up to date.`;
  const now = Date.now();
  await db
    .update(packages)
    .set({
      hiobuyPackageId: remoteId || pkg.hiobuyPackageId,
      hiobuyStatus: decision.status,
      hiobuySyncedAt: now,
      packageStatus: decision.status,
      conditionStatus: decision.condition,
      receivedAt: decision.receivedAt ?? (pkg.packageStatus === "PENDING" ? now : pkg.receivedAt),
      weightGrams: decision.weightGrams,
      lengthMm: decision.lengthMm,
      widthMm: decision.widthMm,
      heightMm: decision.heightMm,
      updatedAt: now,
    })
    .where(and(eq(packages.id, pkg.id), eq(packages.updatedAt, pkg.updatedAt)));
  if (remoteId) await rememberLink(db, { localType: "package", localId: pkg.id, remoteType: "package", remoteId, externalRef: external, trackingNumber: pkg.domesticTrackingNumber, remoteStatus: decision.status });
  if (pkg.packageStatus === "PENDING" && decision.status === "RECEIVED") {
    await notify(db, pkg.userId, { type: "PACKAGE_RECEIVED", title: "Package received", body: `${pkg.publicId} arrived at the warehouse.`, href: `/app/packages/${pkg.id}` });
  }
  return `${pkg.publicId} marked ${decision.status}.`;
}

async function applyPackageException(db: Database, remoteId: string | null, external: string | null, exceptionType: string): Promise<string> {
  const pkg = await findPackageByRemote(db, remoteId, external);
  if (!pkg) return "No matching local package.";
  if (pkg.exceptionStatus !== "NONE") return `${pkg.publicId} already has an open exception.`;
  const now = Date.now();
  await db.insert(packageExceptions).values({
    id: crypto.randomUUID(),
    packageId: pkg.id,
    type: exceptionType || "OTHER",
    description: "HioBuy reported a package exception.",
    message: "Please choose how the warehouse should handle this package.",
    status: "OPEN",
    resolution: null,
    createdAt: now,
  });
  await db.update(packages).set({ exceptionStatus: "ACTION_REQUIRED", conditionStatus: "EXCEPTION", hiobuyStatus: pkg.hiobuyStatus ?? pkg.packageStatus, hiobuySyncedAt: now, updatedAt: now }).where(eq(packages.id, pkg.id));
  await notify(db, pkg.userId, { type: "EXCEPTION", title: "Package needs your decision", body: `${pkg.publicId} needs a decision.`, href: `/app/packages/${pkg.id}` });
  return `${pkg.publicId} flagged ${exceptionType || "OTHER"}. Customer asked to decide.`;
}

async function applyReadyForPayment(db: Database, shipmentId: string | null, external: string | null, payload: unknown): Promise<string> {
  const shipment = await findShipmentByRemote(db, shipmentId, external);
  if (!shipment) return "No matching local shipment.";
  const cny = payableCnyFen(payload);
  if (cny == null) return `${shipment.publicId}: no amount_due in the event.`;
  const policy = await sellingPolicy(db);
  const usd = customerUsdFen(cny, policy);
  const dueRows = await db.select().from(charges).where(and(eq(charges.shipmentId, shipment.id), eq(charges.status, "DUE"), eq(charges.type, "FREIGHT")));
  const decision = readyForPaymentDecision({ localStatus: shipment.status, currentDueFen: dueRows[0]?.amountFen ?? null, nextUsdFen: usd });
  const now = Date.now();
  if (decision.kind === "bill") {
    await db.delete(charges).where(and(eq(charges.shipmentId, shipment.id), eq(charges.type, "FREIGHT")));
    const currency = await customerCurrency(db);
    await db.insert(charges).values({ id: crypto.randomUUID(), shipmentId: shipment.id, type: "FREIGHT", name: "International freight", amountFen: decision.usdFen, currency, status: "DUE" });
    await db.update(shipments).set({ status: "TO_PAY", upstreamStatus: "WAIT_PAYMENT", canCancel: false, hiobuyShipmentId: shipmentId || shipment.hiobuyShipmentId, hiobuySyncedAt: now, updatedAt: now }).where(eq(shipments.id, shipment.id));
    await snapshotRemoteFreight(db, shipment.id, decision.usdFen, cny);
    await notify(db, shipment.userId, { type: "PAYMENT", title: "Shipment ready for payment", body: `${shipment.publicId} is packed. Final freight is ready to pay.`, href: `/app/shipments/${shipment.id}` });
    return `${shipment.publicId} billed ${(decision.usdFen / 100).toFixed(2)} ${currency}.`;
  }
  if (decision.kind === "review") {
    await insertTask(db, {
      entityType: "shipment",
      entityId: shipment.id,
      action: "shipment_refresh",
      status: "needs_review",
      externalRef: externalShipmentRef(shipment.id),
      idempotencyKey: `shipment-refresh:${shipment.id}`,
      reason: decision.message,
    });
  }
  await db.update(shipments).set({ upstreamStatus: "WAIT_PAYMENT", hiobuySyncedAt: now, hiobuyShipmentId: shipmentId || shipment.hiobuyShipmentId, updatedAt: now }).where(eq(shipments.id, shipment.id));
  return decision.kind === "review" ? `${shipment.publicId} sent to Needs review: ${decision.message}` : `${shipment.publicId} is already billed.`;
}

async function applyDispatched(db: Database, shipmentId: string | null, external: string | null, tracking: string | null): Promise<string> {
  const shipment = await findShipmentByRemote(db, shipmentId, external);
  if (!shipment) return "No matching local shipment.";
  const decision = dispatchDecision(shipment.status);
  const now = Date.now();
  if (decision === "review") {
    await insertTask(db, {
      entityType: "shipment",
      entityId: shipment.id,
      action: "shipment_refresh",
      status: "needs_review",
      externalRef: externalShipmentRef(shipment.id),
      idempotencyKey: `shipment-refresh:${shipment.id}`,
      reason: "HioBuy dispatched this shipment before the local payment state allowed it.",
    });
    await db.update(shipments).set({ upstreamStatus: "SHIPPED", hiobuySyncedAt: now, updatedAt: now }).where(eq(shipments.id, shipment.id));
    return `${shipment.publicId} dispatched before payment. Sent to Needs review.`;
  }
  if (decision === "ship") {
    const number = tracking?.trim().toUpperCase() || shipment.trackingNumber;
    await db.update(shipments).set({ status: "IN_TRANSIT", upstreamStatus: "SHIPPED", trackingNumber: number, hiobuySyncedAt: now, updatedAt: now }).where(eq(shipments.id, shipment.id));
    const links = await db.select({ packageId: shipmentPackages.packageId }).from(shipmentPackages).where(eq(shipmentPackages.shipmentId, shipment.id));
    if (links.length) await db.update(packages).set({ packageStatus: "SHIPPED", hiobuyStatus: "SHIPPED", updatedAt: now }).where(inArray(packages.id, links.map((link) => link.packageId)));
    await notify(db, shipment.userId, { type: "SHIPPED", title: "Shipment on its way", body: `${shipment.publicId} left the warehouse.`, href: `/app/shipments/${shipment.id}` });
    return `${shipment.publicId} in transit${number ? ` (${number})` : ""}.`;
  }
  return `${shipment.publicId} is already ${shipment.status}.`;
}

async function applyDelivered(db: Database, shipmentId: string | null, external: string | null): Promise<string> {
  const shipment = await findShipmentByRemote(db, shipmentId, external);
  if (!shipment) return "No matching local shipment.";
  if (shipment.status === "CANCELLED") return `${shipment.publicId} is cancelled. Ignored.`;
  const now = Date.now();
  if (shipment.status === "IN_TRANSIT" || shipment.status === "SHIPPED") {
    await db.update(shipments).set({ status: "DELIVERED", upstreamStatus: "SIGNED", hiobuySyncedAt: now, updatedAt: now }).where(eq(shipments.id, shipment.id));
    const links = await db.select({ packageId: shipmentPackages.packageId }).from(shipmentPackages).where(eq(shipmentPackages.shipmentId, shipment.id));
    if (links.length) {
      await db
        .update(packages)
        .set({ packageStatus: "DELIVERED", hiobuyStatus: "DELIVERED", updatedAt: now })
        .where(and(inArray(packages.id, links.map((link) => link.packageId)), inArray(packages.packageStatus, ["RECEIVED", "CONSOLIDATED", "SHIPPED"])));
    }
    await notify(db, shipment.userId, { type: "DELIVERED", title: "Shipment delivered", body: `${shipment.publicId} was delivered.`, href: `/app/shipments/${shipment.id}` });
    return `${shipment.publicId} delivered.`;
  }
  await db.update(shipments).set({ upstreamStatus: "SIGNED", hiobuySyncedAt: now, updatedAt: now }).where(eq(shipments.id, shipment.id));
  return `${shipment.publicId} recorded as signed. Local status stays ${shipment.status}.`;
}

async function applyShipmentException(db: Database, shipmentId: string | null, external: string | null, exceptionType: string): Promise<string> {
  const shipment = await findShipmentByRemote(db, shipmentId, external);
  if (!shipment) return "No matching local shipment.";
  const reason = `HioBuy reported a shipment exception: ${exceptionType}.`;
  const existing = (
    await db
      .select({ id: fulfillmentSyncTasks.id })
      .from(fulfillmentSyncTasks)
      .where(and(eq(fulfillmentSyncTasks.entityType, "shipment"), eq(fulfillmentSyncTasks.entityId, shipment.id), eq(fulfillmentSyncTasks.action, "shipment_exception")))
  )[0];
  if (existing) await db.update(fulfillmentSyncTasks).set({ status: "needs_review", reason, updatedAt: Date.now() }).where(eq(fulfillmentSyncTasks.id, existing.id));
  else await insertTask(db, { entityType: "shipment", entityId: shipment.id, action: "shipment_exception", status: "needs_review", externalRef: externalShipmentRef(shipment.id), idempotencyKey: `shipment-exception:${shipment.id}`, reason });
  await notify(db, shipment.userId, { type: "SHIPMENT_EXCEPTION", title: "Shipment delayed", body: `The warehouse reported an issue with ${shipment.publicId}. Our team is checking it.`, href: `/app/shipments/${shipment.id}` });
  return `${shipment.publicId} flagged ${exceptionType}. Sent to Needs review.`;
}

async function applyBalanceLow(db: Database, eventId: string, data: Record<string, unknown>): Promise<string> {
  const available = typeof data.available_amount === "number" ? data.available_amount : Number(data.available_amount);
  if (!Number.isFinite(available)) return "No available_amount in the event.";
  const currency = typeof data.currency === "string" ? data.currency : "USD";
  const threshold = typeof data.threshold === "number" ? data.threshold : null;
  const alert = { available, currency, threshold, at: new Date().toISOString() };
  await freightPolicyRow(db);
  await db.update(freightPolicy).set({ balanceAlert: JSON.stringify(alert), updatedAt: Date.now() }).where(eq(freightPolicy.id, SINGLETON_ID));
  const summary = `HioBuy warehouse wallet is low: ${available} ${currency}${threshold != null ? ` (threshold ${threshold})` : ""}.`;
  const operator = (await storedBusiness(db)).email;
  if (operator) {
    const origin = (await emailBrand(db)).appUrl;
    const adminUrl = origin ? `${origin.replace(/\/$/, "")}/admin/settings` : "";
    await enqueueDirect(db, {
      idempotencyKey: `hiobuy.balance_low:${eventId}`,
      to: operator,
      event: "hiobuy.balance_low",
      templateId: "welcome",
      subject: "HioBuy warehouse wallet is low",
      html: `<p>${summary}</p><p>Top up the warehouse wallet so shipments can be paid without delay.</p>${adminUrl ? `<p><a href="${adminUrl}">Open admin settings</a></p>` : ""}`,
      required: true,
    }).catch(() => undefined);
  }
  return operator ? `${summary} Emailed ${operator}.` : `${summary} No business email set, so no email was sent.`;
}

function dataRecord(payload: unknown) {
  if (!payload || typeof payload !== "object") return {};
  const root = payload as { data?: unknown };
  const data = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : (payload as Record<string, unknown>);
  return data;
}

export async function handleHiobuyWebhook(db: Database, env: SyncEnv, raw: string, signature: string | null) {
  const ciphertext = (await freightPolicyRow(db)).webhookCiphertext;
  const secret = ciphertext && env.BETTER_AUTH_SECRET ? await decryptSecret(env.BETTER_AUTH_SECRET, ciphertext).catch(() => "") : "";
  if (!secret || !(await verifyHioBuySignature(raw, signature, secret))) {
    await db.update(freightPolicy).set({ webhookRejectedAt: Date.now() }).where(eq(freightPolicy.id, SINGLETON_ID));
    return { status: 401 as const };
  }
  let payload: unknown = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { status: 400 as const };
  }
  const root = payload && typeof payload === "object" ? (payload as { id?: unknown; type?: unknown; livemode?: unknown }) : {};
  const eventId = typeof root.id === "string" ? root.id : "";
  const type = typeof root.type === "string" ? root.type : "";
  if (!eventId || !type) return { status: 400 as const };
  const existing = (await db.select().from(fulfillmentWebhookEvents).where(eq(fulfillmentWebhookEvents.id, eventId)))[0];
  const stuck = existing?.status === "processing" && Date.now() - existing.receivedAt > 60_000;
  if (existing && existing.status !== "failed" && !stuck) return { status: 200 as const, duplicate: true };
  if (existing) {
    await db.update(fulfillmentWebhookEvents).set({ status: "processing", error: null, receivedAt: Date.now() }).where(eq(fulfillmentWebhookEvents.id, eventId));
  } else {
    await db.insert(fulfillmentWebhookEvents).values({ id: eventId, type, livemode: root.livemode !== false, status: "processing", error: null, outcome: null, receivedAt: Date.now() });
    await db.delete(fulfillmentWebhookEvents).where(lt(fulfillmentWebhookEvents.receivedAt, Date.now() - WEBHOOK_RETENTION_MS));
  }
  const data = dataRecord(payload);
  const remotePackage = typeof data.package_id === "string" ? data.package_id : null;
  const remoteShipment = typeof data.shipment_id === "string" ? data.shipment_id : null;
  const external = typeof data.external_shipment_id === "string" ? data.external_shipment_id : typeof data.external_order_id === "string" ? data.external_order_id : null;
  const exceptionType = typeof data.exception_type === "string" ? data.exception_type : "OTHER";
  try {
    let outcome: string;
    if (type === "package.received") outcome = await applyReceivedPackage(db, env, remotePackage, external);
    else if (type === "package.exception") outcome = await applyPackageException(db, remotePackage, external, exceptionType);
    else if (type === "shipment.ready_for_payment") outcome = await applyReadyForPayment(db, remoteShipment, external, data);
    else if (type === "shipment.dispatched") outcome = await applyDispatched(db, remoteShipment, external, typeof data.tracking_number === "string" ? data.tracking_number : null);
    else if (type === "shipment.delivered") outcome = await applyDelivered(db, remoteShipment, external);
    else if (type === "shipment.exception") outcome = await applyShipmentException(db, remoteShipment, external, exceptionType);
    else if (type === "balance.low") outcome = await applyBalanceLow(db, eventId, data);
    else outcome = "Not used by this app. Acknowledged.";
    await db.update(fulfillmentWebhookEvents).set({ status: "processed", error: null, outcome }).where(eq(fulfillmentWebhookEvents.id, eventId));
    return { status: 200 as const };
  } catch (error) {
    const message = redactSensitive(error instanceof Error ? error.message : "unknown");
    await db.update(fulfillmentWebhookEvents).set({ status: "failed", error: message }).where(eq(fulfillmentWebhookEvents.id, eventId));
    logEvent({ level: "error", message: "HioBuy webhook failed", detail: message });
    return { status: 500 as const };
  }
}
