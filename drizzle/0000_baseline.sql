CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rate_limit` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`last_request` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_limit_key_unique` ON `rate_limit` (`key`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `two_factor` (
	`id` text PRIMARY KEY NOT NULL,
	`secret` text NOT NULL,
	`backup_codes` text NOT NULL,
	`user_id` text NOT NULL,
	`verified` integer DEFAULT false,
	`failed_verification_count` integer DEFAULT 0,
	`locked_until` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `two_factor_secret_idx` ON `two_factor` (`secret`);--> statement-breakpoint
CREATE INDEX `two_factor_user_idx` ON `two_factor` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`member_code` text NOT NULL,
	`phone` text,
	`country` text,
	`status` text DEFAULT 'active' NOT NULL,
	`two_factor_enabled` integer DEFAULT false
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_member_code_unique` ON `user` (`member_code`);--> statement-breakpoint
CREATE INDEX `user_email_idx` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`first_name` text DEFAULT '' NOT NULL,
	`last_name` text DEFAULT '' NOT NULL,
	`email` text,
	`company` text,
	`phone_code` text DEFAULT '' NOT NULL,
	`phone` text NOT NULL,
	`country_code` text NOT NULL,
	`region_code` text,
	`state` text NOT NULL,
	`city` text NOT NULL,
	`district` text,
	`postal_code` text NOT NULL,
	`address_line1` text NOT NULL,
	`address_line2` text,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `assistant_knowledge` (
	`id` text PRIMARY KEY NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`keywords` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assistant_knowledge_status` ON `assistant_knowledge` (`status`);--> statement-breakpoint
CREATE TABLE `assistant_unanswered` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`question` text NOT NULL,
	`normalized` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`knowledge_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`knowledge_id`) REFERENCES `assistant_knowledge`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_unanswered_open_user_question` ON `assistant_unanswered` (`user_id`,`normalized`) WHERE "assistant_unanswered"."status" = 'open';--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`target` text,
	`detail` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_logs_created` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `bank_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`user_id` text NOT NULL,
	`amount_fen` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`reference` text,
	`transfer_date` text,
	`proof_note` text,
	`proof_object_key` text,
	`status` text NOT NULL,
	`reviewed_by` text,
	`reviewed_at` integer,
	`review_note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_transfers_public` ON `bank_transfers` (`public_id`);--> statement-breakpoint
CREATE TABLE `billing_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`user_id` text NOT NULL,
	`shipment_id` text,
	`payment_id` text,
	`wallet_transaction_id` text,
	`refund_id` text,
	`related_document_id` text,
	`currency` text NOT NULL,
	`subtotal_fen` integer NOT NULL,
	`tax_fen` integer NOT NULL,
	`total_fen` integer NOT NULL,
	`payment_status` text NOT NULL,
	`relation_status` text DEFAULT 'none' NOT NULL,
	`snapshot` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`issued_at` integer NOT NULL,
	`voided_at` integer,
	`void_reason` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_documents_number` ON `billing_documents` (`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_documents_idempotency` ON `billing_documents` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `billing_documents_user` ON `billing_documents` (`user_id`);--> statement-breakpoint
CREATE INDEX `billing_documents_shipment` ON `billing_documents` (`shipment_id`);--> statement-breakpoint
CREATE TABLE `business_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`legal_name` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`support_email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`country` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`primary_logo_key` text,
	`primary_logo_type` text,
	`square_logo_key` text,
	`square_logo_type` text,
	`favicon_key` text,
	`favicon_type` text,
	`primary_color` text DEFAULT '#4F46E5' NOT NULL,
	`accent_color` text DEFAULT '' NOT NULL,
	`public_url` text DEFAULT '' NOT NULL,
	`app_url` text DEFAULT '' NOT NULL,
	`app_url_trusted` integer DEFAULT false NOT NULL,
	`support_url` text DEFAULT '' NOT NULL,
	`privacy_url` text DEFAULT '' NOT NULL,
	`terms_url` text DEFAULT '' NOT NULL,
	`browser_title` text DEFAULT '' NOT NULL,
	`meta_description` text DEFAULT '' NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text
);
--> statement-breakpoint
CREATE TABLE `carton_packages` (
	`carton_id` text NOT NULL,
	`package_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cartons` (
	`id` text PRIMARY KEY NOT NULL,
	`shipment_id` text NOT NULL,
	`code` text NOT NULL,
	`status` text NOT NULL,
	`weight_grams` integer,
	`length_mm` integer,
	`width_mm` integer,
	`height_mm` integer,
	`tracking_number` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `carton_code` ON `cartons` (`code`);--> statement-breakpoint
CREATE TABLE `charges` (
	`id` text PRIMARY KEY NOT NULL,
	`shipment_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`amount_fen` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `checkout_items` (
	`id` text PRIMARY KEY NOT NULL,
	`checkout_id` text NOT NULL,
	`reference_type` text NOT NULL,
	`reference_id` text NOT NULL,
	`amount_fen` integer NOT NULL,
	`label` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `checkouts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`currency` text NOT NULL,
	`total_fen` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`paid_at` integer
);
--> statement-breakpoint
CREATE TABLE `claims` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tracking_number` text NOT NULL,
	`courier` text NOT NULL,
	`weight_grams` integer NOT NULL,
	`length_mm` integer NOT NULL,
	`width_mm` integer NOT NULL,
	`height_mm` integer NOT NULL,
	`received_at` integer NOT NULL,
	`status` text NOT NULL,
	`unclaimed_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `document_counters` (
	`series` text PRIMARY KEY NOT NULL,
	`next_number` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `email_change_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE TABLE `email_change_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`new_email` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_change_token` ON `email_change_requests` (`token_hash`);--> statement-breakpoint
CREATE INDEX `email_change_user` ON `email_change_requests` (`user_id`);--> statement-breakpoint
CREATE TABLE `email_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`to_address` text NOT NULL,
	`event` text NOT NULL,
	`template_id` text NOT NULL,
	`subject` text NOT NULL,
	`payload` text,
	`related_type` text,
	`related_id` text,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`sent_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_messages_idempotency` ON `email_messages` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `email_messages_status_created` ON `email_messages` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `email_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`to_address` text NOT NULL,
	`kind` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`url` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `email_rules` (
	`event` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `email_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`host` text,
	`port` integer,
	`encryption` text,
	`username` text,
	`password_ciphertext` text,
	`sender_name` text,
	`sender_email` text,
	`reply_to` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `email_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `freight_areas` (
	`id` text PRIMARY KEY NOT NULL,
	`country_code` text NOT NULL,
	`region_code` text NOT NULL,
	`region_name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `freight_area_key` ON `freight_areas` (`country_code`,`region_code`);--> statement-breakpoint
CREATE TABLE `freight_policy` (
	`id` text PRIMARY KEY NOT NULL,
	`markup_bps` integer NOT NULL,
	`markup_cny_fen` integer NOT NULL,
	`cny_per_usd_e4` integer NOT NULL,
	`api_key` text,
	`sync_source` text NOT NULL,
	`synced_at` integer,
	`webhook_ciphertext` text,
	`sync_pause_code` text,
	`sync_pause_message` text,
	`auto_sync_packages` integer DEFAULT true NOT NULL,
	`tracking_event_labels` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fulfillment_remote_links` (
	`id` text PRIMARY KEY NOT NULL,
	`local_type` text NOT NULL,
	`local_id` text NOT NULL,
	`remote_type` text NOT NULL,
	`remote_id` text NOT NULL,
	`external_ref` text,
	`tracking_number` text,
	`remote_status` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fulfillment_remote_link_key` ON `fulfillment_remote_links` (`local_type`,`local_id`,`remote_type`,`remote_id`);--> statement-breakpoint
CREATE TABLE `fulfillment_sync_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`http_status` integer,
	`outcome` text NOT NULL,
	`error_class` text,
	`error_code` text,
	`error_message` text,
	`upstream_request_id` text,
	`operation` text,
	`started_at` integer,
	`finished_at` integer,
	`previous_status` text,
	`new_status` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `fulfillment_sync_attempt_task` ON `fulfillment_sync_attempts` (`task_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `fulfillment_sync_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`status` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`external_ref` text NOT NULL,
	`remote_id` text,
	`remote_secondary` text,
	`remote_status` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`error_class` text,
	`error_code` text,
	`error_message` text,
	`lock_token` text,
	`locked_at` integer,
	`reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fulfillment_sync_task_entity` ON `fulfillment_sync_tasks` (`entity_type`,`entity_id`,`action`);--> statement-breakpoint
CREATE INDEX `fulfillment_sync_task_due` ON `fulfillment_sync_tasks` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `fulfillment_webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`livemode` integer DEFAULT true NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`operation` text NOT NULL,
	`key` text NOT NULL,
	`response_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idempotency_user_op_key` ON `idempotency_keys` (`user_id`,`operation`,`key`);--> statement-breakpoint
CREATE TABLE `invoice_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`label` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`tax_id` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`country_region` text DEFAULT '' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `invoice_profiles_user` ON `invoice_profiles` (`user_id`);--> statement-breakpoint
CREATE TABLE `invoicing_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`business_name` text DEFAULT '' NOT NULL,
	`business_address` text DEFAULT '' NOT NULL,
	`country_region` text DEFAULT '' NOT NULL,
	`tax_id` text DEFAULT '' NOT NULL,
	`contact_email` text DEFAULT '' NOT NULL,
	`logo_object_key` text,
	`invoice_prefix` text DEFAULT 'INV' NOT NULL,
	`invoice_footer` text DEFAULT '' NOT NULL,
	`payment_instructions` text DEFAULT '' NOT NULL,
	`default_currency` text DEFAULT 'USD' NOT NULL,
	`tax_rate_bps` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email_enabled` integer DEFAULT true NOT NULL,
	`package_received` integer DEFAULT true NOT NULL,
	`action_required` integer DEFAULT true NOT NULL,
	`vas_completed` integer DEFAULT true NOT NULL,
	`payment_due` integer DEFAULT true NOT NULL,
	`shipment_shipped` integer DEFAULT true NOT NULL,
	`shipment_delivered` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`href` text,
	`read_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `number_sequences` (
	`kind` text PRIMARY KEY NOT NULL,
	`prefix` text NOT NULL,
	`pad_length` integer NOT NULL,
	`next_value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `package_attributes` (
	`id` text PRIMARY KEY NOT NULL,
	`package_id` text NOT NULL,
	`attribute` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `package_exceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`package_id` text NOT NULL,
	`type` text NOT NULL,
	`description` text NOT NULL,
	`message` text NOT NULL,
	`status` text NOT NULL,
	`resolution` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `package_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`package_id` text,
	`shipment_id` text,
	`type` text NOT NULL,
	`label` text NOT NULL,
	`object_key` text,
	`remote_url` text,
	`carton_id` text,
	`unclaimed_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `packages` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`public_id` text NOT NULL,
	`domestic_tracking_number` text NOT NULL,
	`courier` text NOT NULL,
	`package_status` text NOT NULL,
	`condition_status` text DEFAULT 'NORMAL' NOT NULL,
	`exception_status` text NOT NULL,
	`vas_status` text NOT NULL,
	`lock_status` text NOT NULL,
	`disposition` text NOT NULL,
	`weight_grams` integer,
	`length_mm` integer,
	`width_mm` integer,
	`height_mm` integer,
	`received_at` integer,
	`product_name` text,
	`quantity` integer,
	`declared_value_fen` integer,
	`seller_platform` text,
	`notes` text,
	`bin_location` text,
	`hiobuy_inbound_notice_id` text,
	`hiobuy_package_id` text,
	`hiobuy_status` text,
	`hiobuy_synced_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `package_user_public` ON `packages` (`user_id`,`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `package_tracking` ON `packages` (`domestic_tracking_number`);--> statement-breakpoint
CREATE TABLE `pay_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`shipment_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`accepted` integer DEFAULT false NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pay_grants_code` ON `pay_grants` (`code_hash`);--> statement-breakpoint
CREATE INDEX `pay_grants_shipment` ON `pay_grants` (`shipment_id`);--> statement-breakpoint
CREATE TABLE `payment_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payment_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`stripe_enabled` integer DEFAULT false NOT NULL,
	`stripe_mode` text DEFAULT 'test' NOT NULL,
	`stripe_publishable_key` text,
	`stripe_secret_ciphertext` text,
	`stripe_webhook_ciphertext` text,
	`card_topup_enabled` integer DEFAULT false NOT NULL,
	`min_topup_fen` integer DEFAULT 1000 NOT NULL,
	`max_topup_fen` integer DEFAULT 50000 NOT NULL,
	`daily_topup_fen` integer DEFAULT 200000 NOT NULL,
	`bank_enabled` integer DEFAULT false NOT NULL,
	`bank_name` text,
	`account_holder` text,
	`account_number` text,
	`swift` text,
	`bank_country` text,
	`bank_currency` text DEFAULT 'USD' NOT NULL,
	`bank_instructions` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`purpose` text NOT NULL,
	`method` text NOT NULL,
	`amount_fen` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`status` text NOT NULL,
	`checkout_id` text,
	`shipment_id` text,
	`stripe_session_id` text,
	`stripe_payment_intent_id` text,
	`hiobuy_status` text,
	`hiobuy_error` text,
	`risk_status` text,
	`idempotency_key` text,
	`created_at` integer NOT NULL,
	`paid_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_checkout_paid` ON `payments` (`checkout_id`) WHERE "payments"."status" = 'paid' AND "payments"."checkout_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `payments_stripe_session` ON `payments` (`stripe_session_id`) WHERE "payments"."stripe_session_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `payments_idempotency` ON `payments` (`idempotency_key`) WHERE "payments"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `platform_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`google_enabled` integer DEFAULT false NOT NULL,
	`google_client_id` text DEFAULT '' NOT NULL,
	`google_secret_ciphertext` text,
	`turnstile_enabled` integer DEFAULT false NOT NULL,
	`turnstile_site_key` text DEFAULT '' NOT NULL,
	`turnstile_secret_ciphertext` text,
	`turnstile_login` integer DEFAULT true NOT NULL,
	`turnstile_register` integer DEFAULT true NOT NULL,
	`turnstile_reset` integer DEFAULT false NOT NULL,
	`customer_ai_enabled` integer DEFAULT true NOT NULL,
	`hiobuy_pay_2fa` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text
);
--> statement-breakpoint
CREATE TABLE `refund_records` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`amount_fen` integer NOT NULL,
	`method` text NOT NULL,
	`status` text NOT NULL,
	`stripe_refund_id` text,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shipment_addresses` (
	`shipment_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`country_code` text NOT NULL,
	`state` text NOT NULL,
	`city` text NOT NULL,
	`district` text,
	`postal_code` text NOT NULL,
	`address_line1` text NOT NULL,
	`address_line2` text
);
--> statement-breakpoint
CREATE TABLE `shipment_earning_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`shipment_id` text NOT NULL,
	`kind` text NOT NULL,
	`usd_fen` integer DEFAULT 0 NOT NULL,
	`cny_fen` integer,
	`idempotency_key` text NOT NULL,
	`note` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shipment_earning_adjustment_key` ON `shipment_earning_adjustments` (`shipment_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `shipment_earnings` (
	`shipment_id` text PRIMARY KEY NOT NULL,
	`hiobuy_cost_cny_fen` integer,
	`markup_bps` integer,
	`markup_cny_fen` integer,
	`cny_per_usd_e4` integer,
	`billed_usd_fen` integer,
	`collected_usd_fen` integer,
	`cost_confirmed` integer DEFAULT false NOT NULL,
	`paid_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `shipment_earnings_paid_at` ON `shipment_earnings` (`paid_at`);--> statement-breakpoint
CREATE TABLE `shipment_methods` (
	`shipment_id` text PRIMARY KEY NOT NULL,
	`route_code` text NOT NULL,
	`route_name` text NOT NULL,
	`estimated_days_min` integer NOT NULL,
	`estimated_days_max` integer NOT NULL,
	`estimated_min_fen` integer NOT NULL,
	`estimated_max_fen` integer NOT NULL,
	`currency` text NOT NULL,
	`description` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shipment_packages` (
	`shipment_id` text NOT NULL,
	`package_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shipments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`public_id` text NOT NULL,
	`status` text NOT NULL,
	`upstream_status` text,
	`tracking_number` text,
	`can_cancel` integer DEFAULT false NOT NULL,
	`packing_instruction` text,
	`packing_note` text,
	`final_weight_grams` integer,
	`final_length_mm` integer,
	`final_width_mm` integer,
	`final_height_mm` integer,
	`hiobuy_shipment_id` text,
	`hiobuy_payment_status` text,
	`interception_status` text,
	`hiobuy_synced_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shipment_user_public` ON `shipments` (`user_id`,`public_id`);--> statement-breakpoint
CREATE TABLE `shipping_quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`package_key` text NOT NULL,
	`address_id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `staff_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`invited_by` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_invites_token_hash_unique` ON `staff_invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `staff_invites_email` ON `staff_invites` (`email`);--> statement-breakpoint
CREATE TABLE `staff_members` (
	`user_id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`invited_by` text,
	`last_login_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `staff_members_role` ON `staff_members` (`role`);--> statement-breakpoint
CREATE TABLE `turnstile_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `unclaimed_parcels` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`tracking_number` text NOT NULL,
	`courier` text NOT NULL,
	`weight_grams` integer NOT NULL,
	`length_mm` integer,
	`width_mm` integer,
	`height_mm` integer,
	`bin_location` text,
	`note` text,
	`status` text NOT NULL,
	`assigned_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vas_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`package_id` text NOT NULL,
	`service_code` text NOT NULL,
	`service_name` text NOT NULL,
	`status` text NOT NULL,
	`estimated_fen` integer NOT NULL,
	`final_fen` integer,
	`payment_state` text NOT NULL,
	`note` text,
	`completed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wallet_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`amount_fen` integer NOT NULL,
	`currency` text NOT NULL,
	`balance_before` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`reference_type` text,
	`reference_id` text,
	`description` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `wallets` (
	`user_id` text PRIMARY KEY NOT NULL,
	`balance_fen` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `warehouse_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`country` text NOT NULL,
	`province` text NOT NULL,
	`city` text NOT NULL,
	`district` text NOT NULL,
	`street` text NOT NULL,
	`postal_code` text NOT NULL,
	`phone` text NOT NULL,
	`recipient` text DEFAULT '' NOT NULL,
	`hours` text NOT NULL,
	`supported_destinations` text DEFAULT '[]' NOT NULL,
	`notice` text,
	`remote_id` text,
	`synced_at` integer NOT NULL
);
