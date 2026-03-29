CREATE TABLE `sections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`source` text NOT NULL,
	`filters` text DEFAULT '[]' NOT NULL,
	`repos` text DEFAULT '[]' NOT NULL,
	`account_id` text,
	`position` integer NOT NULL,
	`show_badge` integer DEFAULT true NOT NULL,
	`collapsed` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sections_user_position_idx` ON `sections` (`user_id`,`position`);