CREATE TABLE `relay_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`pubsub_message_id` text,
	`email_address` text NOT NULL,
	`history_id` text NOT NULL,
	`publish_time` text,
	`received_at` text NOT NULL,
	`drained_at` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_sent_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `relay_events_message_user_idx` ON `relay_events` (`pubsub_message_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `relay_events_user_pending_idx` ON `relay_events` (`user_id`,`drained_at`,`created_at`);