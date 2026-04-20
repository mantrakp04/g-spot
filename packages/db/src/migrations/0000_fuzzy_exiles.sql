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
	`project_id` text NOT NULL,
	`title` text DEFAULT 'New Chat' NOT NULL,
	`model` text DEFAULT 'gpt-5.4-mini' NOT NULL,
	`agent_config` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chats_project_updated_idx` ON `chats` (`project_id`,`updated_at`);--> statement-breakpoint
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
	`hash` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`hash`) REFERENCES `file_hashes`(`hash`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `file_metadata_hash_idx` ON `file_metadata` (`hash`);--> statement-breakpoint
CREATE TABLE `gmail_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`history_id` text,
	`watch_expiration` integer,
	`last_watch_history_id` text,
	`last_watch_renewed_at` text,
	`last_notification_history_id` text,
	`last_notification_at` text,
	`needs_full_resync` integer DEFAULT false NOT NULL,
	`last_full_sync_at` text,
	`last_incremental_sync_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_accounts_provider_idx` ON `gmail_accounts` (`provider_account_id`);--> statement-breakpoint
CREATE TABLE `gmail_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`gmail_attachment_id` text,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `gmail_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `gmail_attachments_message_idx` ON `gmail_attachments` (`message_id`);--> statement-breakpoint
CREATE TABLE `gmail_labels` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`gmail_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`color` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `gmail_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_labels_account_gmail_idx` ON `gmail_labels` (`account_id`,`gmail_id`);--> statement-breakpoint
CREATE TABLE `gmail_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`account_id` text NOT NULL,
	`gmail_message_id` text NOT NULL,
	`gmail_thread_id` text NOT NULL,
	`from_name` text DEFAULT '' NOT NULL,
	`from_email` text DEFAULT '' NOT NULL,
	`to_header` text DEFAULT '' NOT NULL,
	`cc_header` text DEFAULT '' NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`date` text NOT NULL,
	`body_html` text,
	`body_text` text,
	`snippet` text DEFAULT '' NOT NULL,
	`labels` text DEFAULT '[]' NOT NULL,
	`message_id_header` text,
	`in_reply_to` text,
	`references_header` text,
	`is_draft` integer DEFAULT false NOT NULL,
	`history_id` text,
	`raw_size_estimate` integer,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `gmail_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `gmail_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_messages_account_msg_idx` ON `gmail_messages` (`account_id`,`gmail_message_id`);--> statement-breakpoint
CREATE INDEX `gmail_messages_thread_idx` ON `gmail_messages` (`thread_id`);--> statement-breakpoint
CREATE INDEX `gmail_messages_account_date_idx` ON `gmail_messages` (`account_id`,`date`);--> statement-breakpoint
CREATE TABLE `gmail_sync_failures` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`gmail_thread_id` text NOT NULL,
	`stage` text NOT NULL,
	`error_message` text NOT NULL,
	`error_code` text,
	`attempts` integer DEFAULT 1 NOT NULL,
	`last_attempt_at` text NOT NULL,
	`resolved_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `gmail_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `gmail_sync_failures_account_idx` ON `gmail_sync_failures` (`account_id`,`resolved_at`);--> statement-breakpoint
CREATE TABLE `gmail_sync_state` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`mode` text,
	`total_threads` integer DEFAULT 0 NOT NULL,
	`fetched_threads` integer DEFAULT 0 NOT NULL,
	`processable_threads` integer DEFAULT 0 NOT NULL,
	`processed_threads` integer DEFAULT 0 NOT NULL,
	`failed_threads` integer DEFAULT 0 NOT NULL,
	`started_at` text,
	`completed_at` text,
	`last_error` text,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `gmail_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_sync_state_account_idx` ON `gmail_sync_state` (`account_id`);--> statement-breakpoint
CREATE TABLE `gmail_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`gmail_thread_id` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`snippet` text DEFAULT '' NOT NULL,
	`last_message_at` text,
	`message_count` integer DEFAULT 0 NOT NULL,
	`labels` text DEFAULT '[]' NOT NULL,
	`history_id` text,
	`is_processed` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `gmail_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_threads_account_thread_idx` ON `gmail_threads` (`account_id`,`gmail_thread_id`);--> statement-breakpoint
CREATE INDEX `gmail_threads_account_date_idx` ON `gmail_threads` (`account_id`,`last_message_at`);--> statement-breakpoint
CREATE INDEX `gmail_threads_account_processed_idx` ON `gmail_threads` (`account_id`,`is_processed`);--> statement-breakpoint
CREATE TABLE `memory_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`target_id` text NOT NULL,
	`target_type` text NOT NULL,
	`event` text NOT NULL,
	`old_value` text,
	`new_value` text,
	`reason` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mem_audit_target_idx` ON `memory_audit_log` (`target_id`);--> statement-breakpoint
CREATE INDEX `mem_audit_time_idx` ON `memory_audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `memory_block_history` (
	`id` text PRIMARY KEY NOT NULL,
	`block_id` text NOT NULL,
	`old_value` text NOT NULL,
	`new_value` text NOT NULL,
	`changed_by` text NOT NULL,
	`changed_at` integer NOT NULL,
	`seq` integer NOT NULL,
	FOREIGN KEY (`block_id`) REFERENCES `memory_blocks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mem_block_hist_block_idx` ON `memory_block_history` (`block_id`);--> statement-breakpoint
CREATE INDEX `mem_block_hist_seq_idx` ON `memory_block_history` (`block_id`,`seq`);--> statement-breakpoint
CREATE TABLE `memory_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`value` text DEFAULT '' NOT NULL,
	`limit` integer DEFAULT 2000 NOT NULL,
	`read_only` integer DEFAULT false NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_blocks_label_unique` ON `memory_blocks` (`label`);--> statement-breakpoint
CREATE TABLE `memory_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`target_id` text NOT NULL,
	`source_type` text NOT NULL,
	`target_type` text NOT NULL,
	`relationship_type` text NOT NULL,
	`description` text NOT NULL,
	`weight` real DEFAULT 1 NOT NULL,
	`confidence` real DEFAULT 0.8 NOT NULL,
	`triplet_text` text NOT NULL,
	`valid_from` integer NOT NULL,
	`valid_to` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mem_edges_source_idx` ON `memory_edges` (`source_id`);--> statement-breakpoint
CREATE INDEX `mem_edges_target_idx` ON `memory_edges` (`target_id`);--> statement-breakpoint
CREATE INDEX `mem_edges_valid_idx` ON `memory_edges` (`valid_to`);--> statement-breakpoint
CREATE INDEX `mem_edges_rel_idx` ON `memory_edges` (`relationship_type`);--> statement-breakpoint
CREATE TABLE `memory_entities` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`name` text NOT NULL,
	`entity_type` text NOT NULL,
	`description` text NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`hash` text NOT NULL,
	`valid_from` integer NOT NULL,
	`valid_to` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`salience` real DEFAULT 1 NOT NULL,
	`decay_rate` real DEFAULT 0.005 NOT NULL,
	`last_accessed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mem_entities_name_idx` ON `memory_entities` (`name`);--> statement-breakpoint
CREATE INDEX `mem_entities_hash_idx` ON `memory_entities` (`hash`);--> statement-breakpoint
CREATE INDEX `mem_entities_valid_idx` ON `memory_entities` (`valid_to`);--> statement-breakpoint
CREATE INDEX `mem_entities_type_idx` ON `memory_entities` (`entity_type`);--> statement-breakpoint
CREATE TABLE `memory_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`observation_type` text NOT NULL,
	`confidence` real DEFAULT 0.8 NOT NULL,
	`source_message_id` text,
	`entity_ids` text DEFAULT '[]' NOT NULL,
	`hash` text NOT NULL,
	`valid_from` integer NOT NULL,
	`valid_to` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`salience` real DEFAULT 1 NOT NULL,
	`decay_rate` real DEFAULT 0.005 NOT NULL,
	`last_accessed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mem_obs_type_idx` ON `memory_observations` (`observation_type`);--> statement-breakpoint
CREATE INDEX `mem_obs_hash_idx` ON `memory_observations` (`hash`);--> statement-breakpoint
CREATE INDEX `mem_obs_valid_idx` ON `memory_observations` (`valid_to`);--> statement-breakpoint
CREATE INDEX `mem_obs_entity_idx` ON `memory_observations` (`entity_ids`);--> statement-breakpoint
CREATE TABLE `pi_state` (
	`id` text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	`chat_defaults` text DEFAULT '{}' NOT NULL,
	`worker_defaults` text DEFAULT '{}' NOT NULL,
	`credentials` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`custom_instructions` text,
	`append_prompt` text,
	`agent_config` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_path_idx` ON `projects` (`path`);--> statement-breakpoint
CREATE TABLE `sections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`source` text NOT NULL,
	`filters` text DEFAULT '[]' NOT NULL,
	`repos` text DEFAULT '[]' NOT NULL,
	`columns` text DEFAULT '[]' NOT NULL,
	`account_id` text,
	`position` integer NOT NULL,
	`show_badge` integer DEFAULT true NOT NULL,
	`collapsed` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sections_position_idx` ON `sections` (`position`);--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
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
CREATE INDEX `skills_project_idx` ON `skills` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `skills_global_name_unique` ON `skills` (`name`) WHERE "skills"."project_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `skills_project_name_unique` ON `skills` (`project_id`,`name`) WHERE "skills"."project_id" IS NOT NULL;