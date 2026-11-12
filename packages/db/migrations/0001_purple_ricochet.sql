ALTER TABLE `cameras` ADD `username` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `cameras` ADD `password_enc` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `cameras` ADD `stream_path` text DEFAULT '' NOT NULL;