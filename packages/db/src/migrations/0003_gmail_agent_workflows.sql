CREATE TABLE `gmail_agent_workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`trigger` text DEFAULT 'incremental_sync' NOT NULL,
	`prompt` text DEFAULT '' NOT NULL,
	`agent_config` text DEFAULT '{}' NOT NULL,
	`disabled_tool_names` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `gmail_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `gmail_agent_workflows_account_idx` ON `gmail_agent_workflows` (`account_id`,`enabled`);
