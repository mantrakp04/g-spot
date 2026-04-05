CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`message` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_messages_chat_idx` ON `chat_messages` (`chat_id`);--> statement-breakpoint
CREATE TABLE `chats` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text DEFAULT 'New Chat' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chats_user_idx` ON `chats` (`user_id`);--> statement-breakpoint
CREATE TABLE `file_hashes` (
	`hash` text PRIMARY KEY NOT NULL,
	`s3_key` text NOT NULL,
	`size` integer NOT NULL,
	`ref_count` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `file_metadata` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`hash` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`hash`) REFERENCES `file_hashes`(`hash`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `file_metadata_user_idx` ON `file_metadata` (`user_id`);--> statement-breakpoint
CREATE INDEX `file_metadata_hash_idx` ON `file_metadata` (`hash`);--> statement-breakpoint
ALTER TABLE `sections` ADD `columns` text DEFAULT '[]' NOT NULL;