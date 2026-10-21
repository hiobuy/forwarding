ALTER TABLE `platform_settings` ADD `enabled_locales` text DEFAULT 'en,zh-Hant,ru' NOT NULL;--> statement-breakpoint
ALTER TABLE `platform_settings` ADD `default_locale` text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE `platform_settings` ADD `customer_currency` text DEFAULT 'USD' NOT NULL;