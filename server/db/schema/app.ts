import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth";

export const addresses = sqliteTable("addresses", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  firstName: text("first_name").notNull().default(""),
  lastName: text("last_name").notNull().default(""),
  email: text("email"),
  company: text("company"),
  phoneCode: text("phone_code").notNull().default(""),
  phone: text("phone").notNull(),
  countryCode: text("country_code").notNull(),
  /** Enabled freight area for this destination. Empty on addresses saved before regions were required. */
  regionCode: text("region_code"),
  state: text("state").notNull(),
  city: text("city").notNull(),
  district: text("district"),
  postalCode: text("postal_code").notNull(),
  addressLine1: text("address_line1").notNull(),
  addressLine2: text("address_line2"),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const wallets = sqliteTable("wallets", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  balanceFen: integer("balance_fen").notNull(),
});

export const walletTransactions = sqliteTable("wallet_transactions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  amountFen: integer("amount_fen").notNull(),
  currency: text("currency").notNull(),
  balanceBefore: integer("balance_before").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  referenceType: text("reference_type"),
  referenceId: text("reference_id"),
  description: text("description").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  href: text("href"),
  readAt: integer("read_at"),
  createdAt: integer("created_at").notNull(),
});

export const notificationPreferences = sqliteTable("notification_preferences", {
  userId: text("user_id").primaryKey(),
  emailEnabled: integer("email_enabled", { mode: "boolean" }).notNull().default(true),
  packageReceived: integer("package_received", { mode: "boolean" }).notNull().default(true),
  actionRequired: integer("action_required", { mode: "boolean" }).notNull().default(true),
  vasCompleted: integer("vas_completed", { mode: "boolean" }).notNull().default(true),
  paymentDue: integer("payment_due", { mode: "boolean" }).notNull().default(true),
  shipmentShipped: integer("shipment_shipped", { mode: "boolean" }).notNull().default(true),
  shipmentDelivered: integer("shipment_delivered", { mode: "boolean" }).notNull().default(true),
});

export const claims = sqliteTable("claims", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  trackingNumber: text("tracking_number").notNull(),
  courier: text("courier").notNull(),
  weightGrams: integer("weight_grams").notNull(),
  lengthMm: integer("length_mm").notNull(),
  widthMm: integer("width_mm").notNull(),
  heightMm: integer("height_mm").notNull(),
  receivedAt: integer("received_at").notNull(),
  status: text("status").notNull(),
  /** Set when the warehouse assigned an unclaimed parcel to this customer to confirm. */
  unclaimedId: text("unclaimed_id"),
  createdAt: integer("created_at").notNull(),
});

export const packages = sqliteTable(
  "packages",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    publicId: text("public_id").notNull(),
    domesticTrackingNumber: text("domestic_tracking_number").notNull(),
    courier: text("courier").notNull(),
    packageStatus: text("package_status").notNull(),
    /** HioBuy condition.status. NORMAL or EXCEPTION. Separate from lifecycle. */
    conditionStatus: text("condition_status").notNull().default("NORMAL"),
    exceptionStatus: text("exception_status").notNull(),
    vasStatus: text("vas_status").notNull(),
    lockStatus: text("lock_status").notNull(),
    disposition: text("disposition").notNull(),
    weightGrams: integer("weight_grams"),
    lengthMm: integer("length_mm"),
    widthMm: integer("width_mm"),
    heightMm: integer("height_mm"),
    receivedAt: integer("received_at"),
    productName: text("product_name"),
    quantity: integer("quantity"),
    declaredValueFen: integer("declared_value_fen"),
    sellerPlatform: text("seller_platform"),
    notes: text("notes"),
    /** Shelf location in the warehouse, e.g. A-01-03. Set when the package is received. */
    binLocation: text("bin_location"),
    /** HioBuy inbound notice id when the create response distinguishes it from package_id. */
    hiobuyInboundNoticeId: text("hiobuy_inbound_notice_id"),
    /** HioBuy package id returned by inbound create or package detail. Required before a status pull. */
    hiobuyPackageId: text("hiobuy_package_id"),
    /** Last package lifecycle applied from HioBuy. */
    hiobuyStatus: text("hiobuy_status"),
    hiobuySyncedAt: integer("hiobuy_synced_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("package_user_public").on(table.userId, table.publicId),
    uniqueIndex("package_tracking").on(table.domesticTrackingNumber),
  ],
);

export const packageAttributes = sqliteTable("package_attributes", {
  id: text("id").primaryKey(),
  packageId: text("package_id").notNull(),
  attribute: text("attribute").notNull(),
});

export const packagePhotos = sqliteTable("package_photos", {
  id: text("id").primaryKey(),
  packageId: text("package_id"),
  shipmentId: text("shipment_id"),
  type: text("type").notNull(),
  label: text("label").notNull(),
    /** R2 key of an uploaded image. Empty when the file is served from HioBuy. */
    objectKey: text("object_key"),
    /** HioBuy CDN url for an inbound or packing photo or video. */
    remoteUrl: text("remote_url"),
  cartonId: text("carton_id"),
  unclaimedId: text("unclaimed_id"),
  createdAt: integer("created_at").notNull(),
});

export const packageExceptions = sqliteTable("package_exceptions", {
  id: text("id").primaryKey(),
  packageId: text("package_id").notNull(),
  type: text("type").notNull(),
  description: text("description").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull(),
  resolution: text("resolution"),
  createdAt: integer("created_at").notNull(),
});

export const vasRequests = sqliteTable("vas_requests", {
  id: text("id").primaryKey(),
  packageId: text("package_id").notNull(),
  serviceCode: text("service_code").notNull(),
  serviceName: text("service_name").notNull(),
  status: text("status").notNull(),
  estimatedFen: integer("estimated_fen").notNull(),
  finalFen: integer("final_fen"),
  paymentState: text("payment_state").notNull(),
  note: text("note"),
  completedAt: integer("completed_at"),
  createdAt: integer("created_at").notNull(),
});

export const shipments = sqliteTable(
  "shipments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    publicId: text("public_id").notNull(),
    status: text("status").notNull(),
    upstreamStatus: text("upstream_status"),
    trackingNumber: text("tracking_number"),
    canCancel: integer("can_cancel", { mode: "boolean" }).notNull().default(false),
    packingInstruction: text("packing_instruction"),
    packingNote: text("packing_note"),
    finalWeightGrams: integer("final_weight_grams"),
    finalLengthMm: integer("final_length_mm"),
    finalWidthMm: integer("final_width_mm"),
    finalHeightMm: integer("final_height_mm"),
    hiobuyShipmentId: text("hiobuy_shipment_id"),
    /** HioBuy payment_status: UNPAID, PARTIAL, or PAID. Independent of the customer wallet. */
    hiobuyPaymentStatus: text("hiobuy_payment_status"),
    /** HioBuy interception.status. Null when no intercept has been requested. */
    interceptionStatus: text("interception_status"),
    /** Set only when upstreamStatus was copied from a HioBuy response, not from a local action. */
    hiobuySyncedAt: integer("hiobuy_synced_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("shipment_user_public").on(table.userId, table.publicId)],
);

export const shipmentPackages = sqliteTable("shipment_packages", {
  shipmentId: text("shipment_id").notNull(),
  packageId: text("package_id").notNull(),
});

export const shipmentAddresses = sqliteTable("shipment_addresses", {
  shipmentId: text("shipment_id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  countryCode: text("country_code").notNull(),
  state: text("state").notNull(),
  city: text("city").notNull(),
  district: text("district"),
  postalCode: text("postal_code").notNull(),
  addressLine1: text("address_line1").notNull(),
  addressLine2: text("address_line2"),
});

export const shipmentMethods = sqliteTable("shipment_methods", {
  shipmentId: text("shipment_id").primaryKey(),
  routeCode: text("route_code").notNull(),
  routeName: text("route_name").notNull(),
  estimatedDaysMin: integer("estimated_days_min").notNull(),
  estimatedDaysMax: integer("estimated_days_max").notNull(),
  estimatedMinFen: integer("estimated_min_fen").notNull(),
  estimatedMaxFen: integer("estimated_max_fen").notNull(),
  currency: text("currency").notNull(),
  description: text("description").notNull(),
});

export const charges = sqliteTable("charges", {
  id: text("id").primaryKey(),
  shipmentId: text("shipment_id").notNull(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  amountFen: integer("amount_fen").notNull(),
  currency: text("currency").notNull(),
  status: text("status").notNull(),
});

export const checkouts = sqliteTable("checkouts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  status: text("status").notNull(),
  currency: text("currency").notNull(),
  totalFen: integer("total_fen").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  paidAt: integer("paid_at"),
});

export const checkoutItems = sqliteTable("checkout_items", {
  id: text("id").primaryKey(),
  checkoutId: text("checkout_id").notNull(),
  referenceType: text("reference_type").notNull(),
  referenceId: text("reference_id").notNull(),
  amountFen: integer("amount_fen").notNull(),
  label: text("label").notNull(),
});

export const shippingQuotes = sqliteTable("shipping_quotes", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  packageKey: text("package_key").notNull(),
  addressId: text("address_id").notNull(),
  payload: text("payload").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const assistantKnowledge = sqliteTable(
  "assistant_knowledge",
  {
    id: text("id").primaryKey(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    keywords: text("keywords").notNull().default(""),
    status: text("status").notNull().default("draft"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("assistant_knowledge_status").on(table.status)],
);

export const assistantUnanswered = sqliteTable(
  "assistant_unanswered",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    normalized: text("normalized").notNull(),
    status: text("status").notNull().default("open"),
    knowledgeId: text("knowledge_id").references(() => assistantKnowledge.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("assistant_unanswered_open_user_question").on(table.userId, table.normalized).where(sql`${table.status} = 'open'`)],
);

export const paymentSettings = sqliteTable("payment_settings", {
  id: text("id").primaryKey(),
  stripeEnabled: integer("stripe_enabled", { mode: "boolean" }).notNull().default(false),
  stripeMode: text("stripe_mode").notNull().default("test"),
  stripePublishableKey: text("stripe_publishable_key"),
  stripeSecretCiphertext: text("stripe_secret_ciphertext"),
  stripeWebhookCiphertext: text("stripe_webhook_ciphertext"),
  cardTopupEnabled: integer("card_topup_enabled", { mode: "boolean" }).notNull().default(false),
  minTopupFen: integer("min_topup_fen").notNull().default(1000),
  maxTopupFen: integer("max_topup_fen").notNull().default(50000),
  dailyTopupFen: integer("daily_topup_fen").notNull().default(200000),
  bankEnabled: integer("bank_enabled", { mode: "boolean" }).notNull().default(false),
  bankName: text("bank_name"),
  accountHolder: text("account_holder"),
  accountNumber: text("account_number"),
  swift: text("swift"),
  bankCountry: text("bank_country"),
  bankCurrency: text("bank_currency").notNull().default("USD"),
  bankInstructions: text("bank_instructions"),
  updatedAt: integer("updated_at").notNull(),
});

/** Receiving accounts shown when a customer pays by bank transfer. */
export const bankAccounts = sqliteTable("bank_accounts", {
  id: text("id").primaryKey(),
  label: text("label"),
  bankName: text("bank_name").notNull(),
  accountHolder: text("account_holder").notNull(),
  accountNumber: text("account_number").notNull(),
  swift: text("swift"),
  country: text("country"),
  currency: text("currency").notNull().default("USD"),
  instructions: text("instructions"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    purpose: text("purpose").notNull(),
    method: text("method").notNull(),
    amountFen: integer("amount_fen").notNull(),
    currency: text("currency").notNull().default("USD"),
    status: text("status").notNull(),
    checkoutId: text("checkout_id"),
    shipmentId: text("shipment_id"),
    stripeSessionId: text("stripe_session_id"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    hiobuyStatus: text("hiobuy_status"),
    hiobuyError: text("hiobuy_error"),
    riskStatus: text("risk_status"),
    idempotencyKey: text("idempotency_key"),
    createdAt: integer("created_at").notNull(),
    paidAt: integer("paid_at"),
  },
  (table) => [
    uniqueIndex("payments_checkout_paid").on(table.checkoutId).where(sql`${table.status} = 'paid' AND ${table.checkoutId} IS NOT NULL`),
    uniqueIndex("payments_stripe_session").on(table.stripeSessionId).where(sql`${table.stripeSessionId} IS NOT NULL`),
    uniqueIndex("payments_idempotency").on(table.idempotencyKey).where(sql`${table.idempotencyKey} IS NOT NULL`),
  ],
);

export const bankTransfers = sqliteTable(
  "bank_transfers",
  {
    id: text("id").primaryKey(),
    publicId: text("public_id").notNull(),
    userId: text("user_id").notNull(),
    amountFen: integer("amount_fen").notNull(),
    currency: text("currency").notNull().default("USD"),
    reference: text("reference"),
    transferDate: text("transfer_date"),
    proofNote: text("proof_note"),
    /** R2 object key for the customer's transfer screenshot. */
    proofObjectKey: text("proof_object_key"),
    status: text("status").notNull(),
    reviewedBy: text("reviewed_by"),
    reviewedAt: integer("reviewed_at"),
    reviewNote: text("review_note"),
    /** Receiving account the customer was shown. Null on transfers created before multiple accounts. */
    bankAccountId: text("bank_account_id"),
    bankAccountLabel: text("bank_account_label"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("bank_transfers_public").on(table.publicId)],
);

export const paymentEvents = sqliteTable("payment_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  status: text("status").notNull(),
  error: text("error"),
  createdAt: integer("created_at").notNull(),
});

export const refundRecords = sqliteTable("refund_records", {
  id: text("id").primaryKey(),
  paymentId: text("payment_id").notNull(),
  amountFen: integer("amount_fen").notNull(),
  method: text("method").notNull(),
  status: text("status").notNull(),
  stripeRefundId: text("stripe_refund_id"),
  note: text("note"),
  createdAt: integer("created_at").notNull(),
});

export const emailSettings = sqliteTable("email_settings", {
  id: text("id").primaryKey(),
  host: text("host"),
  port: integer("port"),
  encryption: text("encryption"),
  username: text("username"),
  passwordCiphertext: text("password_ciphertext"),
  senderName: text("sender_name"),
  senderEmail: text("sender_email"),
  replyTo: text("reply_to"),
  updatedAt: integer("updated_at").notNull(),
});

export const emailTemplates = sqliteTable("email_templates", {
  id: text("id").primaryKey(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const emailRules = sqliteTable("email_rules", {
  event: text("event").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
});

export const emailMessages = sqliteTable(
  "email_messages",
  {
    id: text("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    toAddress: text("to_address").notNull(),
    event: text("event").notNull(),
    templateId: text("template_id").notNull(),
    subject: text("subject").notNull(),
    payload: text("payload"),
    relatedType: text("related_type"),
    relatedId: text("related_id"),
    status: text("status").notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: integer("created_at").notNull(),
    sentAt: integer("sent_at"),
  },
  (table) => [uniqueIndex("email_messages_idempotency").on(table.idempotencyKey), index("email_messages_status_created").on(table.status, table.createdAt)],
);

export const emailOutbox = sqliteTable("email_outbox", {
  id: text("id").primaryKey(),
  toAddress: text("to_address").notNull(),
  kind: text("kind").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  url: text("url").notNull(),
  createdAt: integer("created_at").notNull(),
});

/** Frozen HioBuy cost, markup, and exchange rate for one shipment. Null cost means unknown, not zero. */
export const shipmentEarnings = sqliteTable(
  "shipment_earnings",
  {
    shipmentId: text("shipment_id").primaryKey(),
    hiobuyCostCnyFen: integer("hiobuy_cost_cny_fen"),
    markupBps: integer("markup_bps"),
    markupCnyFen: integer("markup_cny_fen"),
    cnyPerUsdE4: integer("cny_per_usd_e4"),
    billedUsdFen: integer("billed_usd_fen"),
    collectedUsdFen: integer("collected_usd_fen"),
    costConfirmed: integer("cost_confirmed", { mode: "boolean" }).notNull().default(false),
    paidAt: integer("paid_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("shipment_earnings_paid_at").on(table.paidAt)],
);

/** Refunds, extra collections, and replacement HioBuy costs. The same key cannot apply twice. */
export const shipmentEarningAdjustments = sqliteTable(
  "shipment_earning_adjustments",
  {
    id: text("id").primaryKey(),
    shipmentId: text("shipment_id").notNull(),
    kind: text("kind").notNull(),
    usdFen: integer("usd_fen").notNull().default(0),
    cnyFen: integer("cny_fen"),
    idempotencyKey: text("idempotency_key").notNull(),
    note: text("note").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("shipment_earning_adjustment_key").on(table.shipmentId, table.idempotencyKey)],
);

export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    operation: text("operation").notNull(),
    key: text("key").notNull(),
    responseJson: text("response_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("idempotency_user_op_key").on(table.userId, table.operation, table.key)],
);

/** Exchange rate and the HioBuy API key for this merchant. */
export const freightPolicy = sqliteTable("freight_policy", {
  id: text("id").primaryKey(),
  markupBps: integer("markup_bps").notNull(),
  markupCnyFen: integer("markup_cny_fen").notNull(),
  cnyPerUsdE4: integer("cny_per_usd_e4").notNull(),
  /** Stored for admin sync. Never returned in full to the browser. */
  apiKey: text("api_key"),
  syncSource: text("sync_source").notNull(),
  syncedAt: integer("synced_at"),
  /** Encrypted HioBuy webhook signing secret. Never returned to the browser. */
  webhookCiphertext: text("webhook_ciphertext"),
  /** Last delivery refused for a missing or bad signature. Those requests are not stored as events. */
  webhookRejectedAt: integer("webhook_rejected_at"),
  /** JSON from the latest balance.low event: { available, currency, threshold, at }. Cleared by staff. */
  balanceAlert: text("balance_alert"),
  /** Set when HioBuy rejects the key or warehouse authorization. Retries stay paused. */
  syncPauseCode: text("sync_pause_code"),
  syncPauseMessage: text("sync_pause_message"),
  /** New package pre-alerts queue a HioBuy notice when the warehouse connection is valid. */
  autoSyncPackages: integer("auto_sync_packages", { mode: "boolean" }).notNull().default(true),
  /** JSON map of HioBuy tracking event code to the label shown in admin and the customer app. */
  trackingEventLabels: text("tracking_event_labels"),
  updatedAt: integer("updated_at").notNull(),
});

/** Countries and regions this merchant serves. Rows come from a HioBuy channel sync; enabled is our choice. */
export const freightAreas = sqliteTable(
  "freight_areas",
  {
    id: text("id").primaryKey(),
    countryCode: text("country_code").notNull(),
    regionCode: text("region_code").notNull(),
    regionName: text("region_name").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("freight_area_key").on(table.countryCode, table.regionCode)],
);

/** China warehouse address last synced from HioBuy. */
export const warehouseLocations = sqliteTable("warehouse_locations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  country: text("country").notNull(),
  province: text("province").notNull(),
  city: text("city").notNull(),
  district: text("district").notNull(),
  street: text("street").notNull(),
  postalCode: text("postal_code").notNull(),
  phone: text("phone").notNull(),
  /** Warehouse receiving name from HioBuy `address.recipient`. */
  recipient: text("recipient").notNull().default(""),
  hours: text("hours").notNull(),
  /** JSON array of ISO country codes from `supported_destinations`. */
  supportedDestinations: text("supported_destinations").notNull().default("[]"),
  notice: text("notice"),
  /** HioBuy location id. The local row id stays `current`. */
  remoteId: text("remote_id"),
  syncedAt: integer("synced_at").notNull(),
});

/** A physical box a shipment goes out in. A shipment can need several. */
export const cartons = sqliteTable(
  "cartons",
  {
    id: text("id").primaryKey(),
    shipmentId: text("shipment_id").notNull(),
    /** Printed on the carton label, e.g. CT0000123. */
    code: text("code").notNull(),
    /** OPEN while being filled, SEALED once weighed and labelled. */
    status: text("status").notNull(),
    weightGrams: integer("weight_grams"),
    lengthMm: integer("length_mm"),
    widthMm: integer("width_mm"),
    heightMm: integer("height_mm"),
    /** International carrier tracking number, scanned at dispatch. */
    trackingNumber: text("tracking_number"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("carton_code").on(table.code)],
);

export const cartonPackages = sqliteTable("carton_packages", {
  cartonId: text("carton_id").notNull(),
  packageId: text("package_id").notNull(),
});

/** Parcels that arrived with no pre-alert and no readable member code. */
export const unclaimedParcels = sqliteTable("unclaimed_parcels", {
  id: text("id").primaryKey(),
  publicId: text("public_id").notNull(),
  trackingNumber: text("tracking_number").notNull(),
  courier: text("courier").notNull(),
  weightGrams: integer("weight_grams").notNull(),
  lengthMm: integer("length_mm"),
  widthMm: integer("width_mm"),
  heightMm: integer("height_mm"),
  binLocation: text("bin_location"),
  note: text("note"),
  /** OPEN → ASSIGNED (a customer was asked to confirm) → CLAIMED, or back to OPEN if they decline. */
  status: text("status").notNull(),
  assignedUserId: text("assigned_user_id"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** One fulfillment sync job. Its status is not the package or shipment business status. */
export const fulfillmentSyncTasks = sqliteTable(
  "fulfillment_sync_tasks",
  {
    id: text("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    status: text("status").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    externalRef: text("external_ref").notNull(),
    remoteId: text("remote_id"),
    remoteSecondary: text("remote_secondary"),
    remoteStatus: text("remote_status"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at"),
    errorClass: text("error_class"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    lockToken: text("lock_token"),
    lockedAt: integer("locked_at"),
    reason: text("reason"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("fulfillment_sync_task_entity").on(table.entityType, table.entityId, table.action),
    index("fulfillment_sync_task_due").on(table.status, table.nextAttemptAt),
  ],
);

/** One attempt. Messages are redacted before they are stored. */
export const fulfillmentSyncAttempts = sqliteTable(
  "fulfillment_sync_attempts",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    attempt: integer("attempt").notNull(),
    httpStatus: integer("http_status"),
    outcome: text("outcome").notNull(),
    errorClass: text("error_class"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    upstreamRequestId: text("upstream_request_id"),
    operation: text("operation"),
    startedAt: integer("started_at"),
    finishedAt: integer("finished_at"),
    previousStatus: text("previous_status"),
    newStatus: text("new_status"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("fulfillment_sync_attempt_task").on(table.taskId, table.createdAt)],
);

/** Local rows and HioBuy resources. A shipment can link to several warehouse packages and cartons. */
export const fulfillmentRemoteLinks = sqliteTable(
  "fulfillment_remote_links",
  {
    id: text("id").primaryKey(),
    localType: text("local_type").notNull(),
    localId: text("local_id").notNull(),
    remoteType: text("remote_type").notNull(),
    remoteId: text("remote_id").notNull(),
    externalRef: text("external_ref"),
    trackingNumber: text("tracking_number"),
    remoteStatus: text("remote_status"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("fulfillment_remote_link_key").on(table.localType, table.localId, table.remoteType, table.remoteId)],
);

/** Seller details printed on forwarding documents. Historical documents keep their own snapshot. */
export const invoicingSettings = sqliteTable("invoicing_settings", {
  id: text("id").primaryKey(),
  businessName: text("business_name").notNull().default(""),
  businessAddress: text("business_address").notNull().default(""),
  countryRegion: text("country_region").notNull().default(""),
  taxId: text("tax_id").notNull().default(""),
  contactEmail: text("contact_email").notNull().default(""),
  logoObjectKey: text("logo_object_key"),
  invoicePrefix: text("invoice_prefix").notNull().default("INV"),
  invoiceFooter: text("invoice_footer").notNull().default(""),
  paymentInstructions: text("payment_instructions").notNull().default(""),
  defaultCurrency: text("default_currency").notNull().default("USD"),
  /** Basis points. 1000 is 10%. Zero means tax is not applied. */
  taxRateBps: integer("tax_rate_bps").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});

/** Bill-to details a customer can pick when a document is issued. */
export const invoiceProfiles = sqliteTable(
  "invoice_profiles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    label: text("label").notNull(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    taxId: text("tax_id").notNull().default(""),
    email: text("email").notNull().default(""),
    address: text("address").notNull().default(""),
    countryRegion: text("country_region").notNull().default(""),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("invoice_profiles_user").on(table.userId)],
);

/** Per-series sequence. The number already used is never reused. */
export const documentCounters = sqliteTable("document_counters", {
  series: text("series").primaryKey(),
  nextNumber: integer("next_number").notNull(),
});

/**
 * Issued forwarding documents. `snapshot` is the document as issued.
 * Amount columns are copies of that snapshot. Refunds update `relation_status` only.
 */
export const billingDocuments = sqliteTable(
  "billing_documents",
  {
    id: text("id").primaryKey(),
    number: text("number").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    userId: text("user_id").notNull(),
    shipmentId: text("shipment_id"),
    paymentId: text("payment_id"),
    walletTransactionId: text("wallet_transaction_id"),
    refundId: text("refund_id"),
    relatedDocumentId: text("related_document_id"),
    currency: text("currency").notNull(),
    subtotalFen: integer("subtotal_fen").notNull(),
    taxFen: integer("tax_fen").notNull(),
    totalFen: integer("total_fen").notNull(),
    paymentStatus: text("payment_status").notNull(),
    relationStatus: text("relation_status").notNull().default("none"),
    snapshot: text("snapshot").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    issuedAt: integer("issued_at").notNull(),
    voidedAt: integer("voided_at"),
    voidReason: text("void_reason"),
  },
  (table) => [
    uniqueIndex("billing_documents_number").on(table.number),
    uniqueIndex("billing_documents_idempotency").on(table.idempotencyKey),
    index("billing_documents_user").on(table.userId),
    index("billing_documents_shipment").on(table.shipmentId),
  ],
);

/** Staff who may open /admin. Customers are never inserted here on signup. */
export const staffMembers = sqliteTable(
  "staff_members",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    status: text("status").notNull().default("active"),
    invitedBy: text("invited_by"),
    lastLoginAt: integer("last_login_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("staff_members_role").on(table.role)],
);

/** One-time invite. The raw token is not stored. */
export const staffInvites = sqliteTable(
  "staff_invites",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    role: text("role").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    invitedBy: text("invited_by").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("staff_invites_email").on(table.email)],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id"),
    actorEmail: text("actor_email").notNull(),
    action: text("action").notNull(),
    target: text("target"),
    detail: text("detail"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("audit_logs_created").on(table.createdAt)],
);

/** One operator brand for this deployment. Customer rows do not carry a theme. */
export const businessSettings = sqliteTable("business_settings", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default(""),
  legalName: text("legal_name").notNull().default(""),
  email: text("email").notNull().default(""),
  supportEmail: text("support_email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  whatsapp: text("whatsapp").notNull().default(""),
  country: text("country").notNull().default(""),
  address: text("address").notNull().default(""),
  description: text("description").notNull().default(""),
  primaryLogoKey: text("primary_logo_key"),
  primaryLogoType: text("primary_logo_type"),
  squareLogoKey: text("square_logo_key"),
  squareLogoType: text("square_logo_type"),
  faviconKey: text("favicon_key"),
  faviconType: text("favicon_type"),
  primaryColor: text("primary_color").notNull().default("#4F46E5"),
  accentColor: text("accent_color").notNull().default(""),
  publicUrl: text("public_url").notNull().default(""),
  appUrl: text("app_url").notNull().default(""),
  /** 1 only after the app URL matched the deployment allowlist. */
  appUrlTrusted: integer("app_url_trusted", { mode: "boolean" }).notNull().default(false),
  supportUrl: text("support_url").notNull().default(""),
  privacyUrl: text("privacy_url").notNull().default(""),
  termsUrl: text("terms_url").notNull().default(""),
  browserTitle: text("browser_title").notNull().default(""),
  metaDescription: text("meta_description").notNull().default(""),
  updatedAt: integer("updated_at").notNull(),
  updatedBy: text("updated_by"),
});

/** Owner-controlled sign-in, numbering, and payment security. Secrets are ciphertext. */
export const platformSettings = sqliteTable("platform_settings", {
  id: text("id").primaryKey(),
  googleEnabled: integer("google_enabled", { mode: "boolean" }).notNull().default(false),
  googleClientId: text("google_client_id").notNull().default(""),
  googleSecretCiphertext: text("google_secret_ciphertext"),
  turnstileEnabled: integer("turnstile_enabled", { mode: "boolean" }).notNull().default(false),
  turnstileSiteKey: text("turnstile_site_key").notNull().default(""),
  turnstileSecretCiphertext: text("turnstile_secret_ciphertext"),
  turnstileLogin: integer("turnstile_login", { mode: "boolean" }).notNull().default(true),
  turnstileRegister: integer("turnstile_register", { mode: "boolean" }).notNull().default(true),
  turnstileReset: integer("turnstile_reset", { mode: "boolean" }).notNull().default(false),
  customerAiEnabled: integer("customer_ai_enabled", { mode: "boolean" }).notNull().default(true),
  hiobuyPay2fa: integer("hiobuy_pay_2fa", { mode: "boolean" }).notNull().default(false),
  /** Comma-separated locale codes from the code catalog. */
  enabledLocales: text("enabled_locales").notNull().default("en,zh-Hant,ru"),
  defaultLocale: text("default_locale").notNull().default("en"),
  /** Customer-facing prices, wallet, and new card charges. Two decimal places. */
  customerCurrency: text("customer_currency").notNull().default("USD"),
  updatedAt: integer("updated_at").notNull(),
  updatedBy: text("updated_by"),
});

/** Next public number for members, packages, and shipments. Issued values are never reused. */
export const numberSequences = sqliteTable("number_sequences", {
  kind: text("kind").primaryKey(),
  prefix: text("prefix").notNull(),
  padLength: integer("pad_length").notNull(),
  nextValue: integer("next_value").notNull(),
});

/** New email stays pending until the one-time link is used. The current email keeps working. */
export const emailChangeRequests = sqliteTable(
  "email_change_requests",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    newEmail: text("new_email").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
    usedAt: integer("used_at"),
  },
  (table) => [uniqueIndex("email_change_token").on(table.tokenHash), index("email_change_user").on(table.userId)],
);

/** Short code sent to the current inbox when a Google-only account has no password. */
export const emailChangeCodes = sqliteTable("email_change_codes", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
  usedAt: integer("used_at"),
});

/** One authenticator code can authorize one HioBuy payment. */
export const payGrants = sqliteTable(
  "pay_grants",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    shipmentId: text("shipment_id").notNull(),
    codeHash: text("code_hash").notNull(),
    accepted: integer("accepted", { mode: "boolean" }).notNull().default(false),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("pay_grants_code").on(table.codeHash), index("pay_grants_shipment").on(table.shipmentId)],
);

/** Turnstile tokens already submitted. A second use is rejected. */
export const turnstileTokens = sqliteTable("turnstile_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  createdAt: integer("created_at").notNull(),
});

/** Webhook deliveries already accepted. A repeated event id is ignored. */
export const fulfillmentWebhookEvents = sqliteTable("fulfillment_webhook_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  livemode: integer("livemode", { mode: "boolean" }).notNull().default(true),
  status: text("status").notNull(),
  error: text("error"),
  /** What the delivery changed locally, shown in the admin delivery log. */
  outcome: text("outcome"),
  receivedAt: integer("received_at").notNull(),
});
