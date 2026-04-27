CREATE TABLE `note_links` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`target_id` text,
	`target_title` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `note_links_source_idx` ON `note_links` (`source_id`);--> statement-breakpoint
CREATE INDEX `note_links_target_idx` ON `note_links` (`target_id`);--> statement-breakpoint
CREATE INDEX `note_links_target_title_idx` ON `note_links` (`target_title`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`kind` text DEFAULT 'note' NOT NULL,
	`title` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notes_parent_idx` ON `notes` (`parent_id`);--> statement-breakpoint
CREATE INDEX `notes_title_idx` ON `notes` (`title`);
--> statement-breakpoint
CREATE UNIQUE INDEX `notes_note_title_unique_idx` ON `notes` (`title`) WHERE `kind` = 'note';
