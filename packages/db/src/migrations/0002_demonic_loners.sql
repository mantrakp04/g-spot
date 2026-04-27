CREATE TABLE `gmail_analysis_state` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`total_threads` integer DEFAULT 0 NOT NULL,
	`analyzed_threads` integer DEFAULT 0 NOT NULL,
	`failed_threads` integer DEFAULT 0 NOT NULL,
	`started_at` text,
	`completed_at` text,
	`last_error` text,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `gmail_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_analysis_state_account_idx` ON `gmail_analysis_state` (`account_id`);--> statement-breakpoint
CREATE TABLE `gmail_fetch_state` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`mode` text NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`total_threads` integer DEFAULT 0 NOT NULL,
	`fetched_threads` integer DEFAULT 0 NOT NULL,
	`failed_threads` integer DEFAULT 0 NOT NULL,
	`started_at` text,
	`completed_at` text,
	`last_error` text,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `gmail_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_fetch_state_account_mode_idx` ON `gmail_fetch_state` (`account_id`,`mode`);--> statement-breakpoint
INSERT INTO `gmail_fetch_state` (
	`id`,
	`account_id`,
	`mode`,
	`status`,
	`total_threads`,
	`fetched_threads`,
	`failed_threads`,
	`started_at`,
	`completed_at`,
	`last_error`,
	`updated_at`
)
SELECT
	lower(hex(randomblob(16))),
	`account_id`,
	`mode`,
	`status`,
	`total_threads`,
	`fetched_threads`,
	`failed_threads`,
	`started_at`,
	`completed_at`,
	`last_error`,
	`updated_at`
FROM `gmail_sync_state`
WHERE `mode` IN ('full', 'incremental');--> statement-breakpoint
INSERT INTO `gmail_analysis_state` (
	`id`,
	`account_id`,
	`status`,
	`total_threads`,
	`analyzed_threads`,
	`failed_threads`,
	`started_at`,
	`completed_at`,
	`last_error`,
	`updated_at`
)
SELECT
	lower(hex(randomblob(16))),
	`account_id`,
	`status`,
	`processable_threads`,
	`processed_threads`,
	`failed_threads`,
	`started_at`,
	`completed_at`,
	`last_error`,
	`updated_at`
FROM `gmail_sync_state`
WHERE `mode` IS NULL OR (`total_threads` = 0 AND `processable_threads` > 0);
