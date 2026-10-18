ALTER TABLE `freight_policy` ADD `webhook_rejected_at` integer;--> statement-breakpoint
ALTER TABLE `freight_policy` ADD `balance_alert` text;--> statement-breakpoint
ALTER TABLE `fulfillment_webhook_events` ADD `outcome` text;