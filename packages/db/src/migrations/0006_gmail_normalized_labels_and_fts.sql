CREATE TABLE `gmail_thread_labels` (
	`account_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`label` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `gmail_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `gmail_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_thread_labels_pk` ON `gmail_thread_labels` (`thread_id`,`label`);--> statement-breakpoint
CREATE INDEX `gmail_thread_labels_account_label_idx` ON `gmail_thread_labels` (`account_id`,`label`);--> statement-breakpoint
CREATE TABLE `gmail_message_labels` (
	`account_id` text NOT NULL,
	`message_id` text NOT NULL,
	`label` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `gmail_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `gmail_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_message_labels_pk` ON `gmail_message_labels` (`message_id`,`label`);--> statement-breakpoint
CREATE INDEX `gmail_message_labels_account_label_idx` ON `gmail_message_labels` (`account_id`,`label`);--> statement-breakpoint
INSERT INTO `gmail_thread_labels` (`account_id`, `thread_id`, `label`)
SELECT t.account_id, t.id, je.value
FROM gmail_threads t, json_each(t.labels) je;
--> statement-breakpoint
INSERT INTO `gmail_message_labels` (`account_id`, `message_id`, `label`)
SELECT m.account_id, m.id, je.value
FROM gmail_messages m, json_each(m.labels) je;
--> statement-breakpoint
ALTER TABLE `gmail_threads` DROP COLUMN `labels`;--> statement-breakpoint
ALTER TABLE `gmail_messages` DROP COLUMN `labels`;--> statement-breakpoint
DROP TABLE `gmail_sync_state`;--> statement-breakpoint
CREATE VIRTUAL TABLE `gmail_messages_fts` USING fts5(
	subject,
	body_text,
	from_email,
	from_name,
	to_header,
	cc_header,
	content='gmail_messages',
	content_rowid='rowid'
);
--> statement-breakpoint
INSERT INTO `gmail_messages_fts` (rowid, subject, body_text, from_email, from_name, to_header, cc_header)
SELECT rowid, subject, COALESCE(body_text, ''), from_email, from_name, to_header, cc_header
FROM gmail_messages;
--> statement-breakpoint
CREATE TRIGGER `gmail_messages_fts_insert` AFTER INSERT ON `gmail_messages` BEGIN
	INSERT INTO gmail_messages_fts (rowid, subject, body_text, from_email, from_name, to_header, cc_header)
	VALUES (new.rowid, new.subject, COALESCE(new.body_text, ''), new.from_email, new.from_name, new.to_header, new.cc_header);
END;
--> statement-breakpoint
CREATE TRIGGER `gmail_messages_fts_delete` AFTER DELETE ON `gmail_messages` BEGIN
	INSERT INTO gmail_messages_fts (gmail_messages_fts, rowid, subject, body_text, from_email, from_name, to_header, cc_header)
	VALUES ('delete', old.rowid, old.subject, COALESCE(old.body_text, ''), old.from_email, old.from_name, old.to_header, old.cc_header);
END;
--> statement-breakpoint
CREATE TRIGGER `gmail_messages_fts_update` AFTER UPDATE ON `gmail_messages` BEGIN
	INSERT INTO gmail_messages_fts (gmail_messages_fts, rowid, subject, body_text, from_email, from_name, to_header, cc_header)
	VALUES ('delete', old.rowid, old.subject, COALESCE(old.body_text, ''), old.from_email, old.from_name, old.to_header, old.cc_header);
	INSERT INTO gmail_messages_fts (rowid, subject, body_text, from_email, from_name, to_header, cc_header)
	VALUES (new.rowid, new.subject, COALESCE(new.body_text, ''), new.from_email, new.from_name, new.to_header, new.cc_header);
END;
