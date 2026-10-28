CREATE TABLE `bank_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text,
	`bank_name` text NOT NULL,
	`account_holder` text NOT NULL,
	`account_number` text NOT NULL,
	`swift` text,
	`country` text,
	`currency` text DEFAULT 'USD' NOT NULL,
	`instructions` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `bank_accounts` (`id`, `label`, `bank_name`, `account_holder`, `account_number`, `swift`, `country`, `currency`, `instructions`, `sort_order`, `created_at`, `updated_at`)
SELECT
	'legacy-bank',
	NULL,
	trim(`bank_name`),
	trim(`account_holder`),
	trim(`account_number`),
	nullif(trim(`swift`), ''),
	nullif(trim(`bank_country`), ''),
	coalesce(nullif(trim(`bank_currency`), ''), 'USD'),
	nullif(trim(`bank_instructions`), ''),
	0,
	`updated_at`,
	`updated_at`
FROM `payment_settings`
WHERE `bank_name` IS NOT NULL AND trim(`bank_name`) != ''
	AND `account_holder` IS NOT NULL AND trim(`account_holder`) != ''
	AND `account_number` IS NOT NULL AND trim(`account_number`) != '';
--> statement-breakpoint
ALTER TABLE `bank_transfers` ADD `bank_account_id` text;
--> statement-breakpoint
ALTER TABLE `bank_transfers` ADD `bank_account_label` text;
