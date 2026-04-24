CREATE TABLE `file_extractions` (
	`hash` text PRIMARY KEY NOT NULL,
	`extractor_version` integer NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`text_s3_key` text NOT NULL,
	`char_count` integer NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`hash`) REFERENCES `file_hashes`(`hash`) ON UPDATE no action ON DELETE no action
);
