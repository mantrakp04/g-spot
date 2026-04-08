CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`custom_instructions` text,
	`append_prompt` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `projects_user_idx` ON `projects` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_user_path_idx` ON `projects` (`user_id`,`path`);
--> statement-breakpoint
INSERT INTO `projects` (`id`, `user_id`, `name`, `path`, `created_at`, `updated_at`)
SELECT
	'default_' || `user_id`,
	`user_id`,
	'Default',
	'/',
	current_timestamp,
	current_timestamp
FROM (SELECT DISTINCT `user_id` FROM `chats`);
--> statement-breakpoint
CREATE TABLE `__new_chats` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`title` text DEFAULT 'New Chat' NOT NULL,
	`model` text DEFAULT 'gpt-5.4-mini' NOT NULL,
	`agent_config` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_chats` (`id`, `user_id`, `project_id`, `title`, `model`, `agent_config`, `created_at`, `updated_at`)
SELECT
	`id`,
	`user_id`,
	'default_' || `user_id`,
	`title`,
	`model`,
	`agent_config`,
	`created_at`,
	`updated_at`
FROM `chats`;
--> statement-breakpoint
DROP TABLE `chats`;
--> statement-breakpoint
ALTER TABLE `__new_chats` RENAME TO `chats`;
--> statement-breakpoint
CREATE INDEX `chats_user_idx` ON `chats` (`user_id`);
--> statement-breakpoint
CREATE INDEX `chats_user_project_updated_idx` ON `chats` (`user_id`,`project_id`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`trigger_keywords` text DEFAULT '[]' NOT NULL,
	`disable_model_invocation` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `skills_user_idx` ON `skills` (`user_id`);
--> statement-breakpoint
CREATE INDEX `skills_project_idx` ON `skills` (`project_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `skills_global_name_unique` ON `skills` (`user_id`,`name`) WHERE `project_id` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `skills_project_name_unique` ON `skills` (`project_id`,`name`) WHERE `project_id` IS NOT NULL;
