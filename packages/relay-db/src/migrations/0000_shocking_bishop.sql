CREATE TABLE `chat_state_cache` (
	`key_prefix` text NOT NULL,
	`cache_key` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`key_prefix`, `cache_key`)
);
--> statement-breakpoint
CREATE INDEX `chat_state_cache_expires_idx` ON `chat_state_cache` (`expires_at`);--> statement-breakpoint
CREATE TABLE `chat_state_lists` (
	`key_prefix` text NOT NULL,
	`list_key` text NOT NULL,
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer
);
--> statement-breakpoint
CREATE INDEX `chat_state_lists_key_idx` ON `chat_state_lists` (`key_prefix`,`list_key`,`seq`);--> statement-breakpoint
CREATE INDEX `chat_state_lists_expires_idx` ON `chat_state_lists` (`expires_at`);--> statement-breakpoint
CREATE TABLE `chat_state_locks` (
	`key_prefix` text NOT NULL,
	`thread_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`key_prefix`, `thread_id`)
);
--> statement-breakpoint
CREATE INDEX `chat_state_locks_expires_idx` ON `chat_state_locks` (`expires_at`);--> statement-breakpoint
CREATE TABLE `chat_state_queues` (
	`key_prefix` text NOT NULL,
	`thread_id` text NOT NULL,
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chat_state_queues_key_idx` ON `chat_state_queues` (`key_prefix`,`thread_id`,`seq`);--> statement-breakpoint
CREATE INDEX `chat_state_queues_expires_idx` ON `chat_state_queues` (`expires_at`);--> statement-breakpoint
CREATE TABLE `chat_state_subscriptions` (
	`key_prefix` text NOT NULL,
	`thread_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`key_prefix`, `thread_id`)
);
