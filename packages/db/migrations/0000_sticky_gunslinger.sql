CREATE TABLE `alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`camera_id` integer,
	`message` text NOT NULL,
	`severity` text DEFAULT 'info' NOT NULL,
	`acknowledged` integer DEFAULT false NOT NULL,
	`timestamp` integer NOT NULL,
	FOREIGN KEY (`camera_id`) REFERENCES `cameras`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `cameras` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`brand` text DEFAULT 'Desconocida' NOT NULL,
	`ip_address` text NOT NULL,
	`rtsp_port` integer DEFAULT 554 NOT NULL,
	`channel` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'OFFLINE' NOT NULL,
	`latency_ms` real DEFAULT -1 NOT NULL,
	`rtsp_open` integer DEFAULT false NOT NULL,
	`http_open` integer DEFAULT false NOT NULL,
	`last_seen` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `health_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`camera_id` integer NOT NULL,
	`status` text DEFAULT 'OFFLINE' NOT NULL,
	`latency_ms` real DEFAULT -1 NOT NULL,
	`rtsp_open` integer DEFAULT false NOT NULL,
	`http_open` integer DEFAULT false NOT NULL,
	`timestamp` integer NOT NULL,
	FOREIGN KEY (`camera_id`) REFERENCES `cameras`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cameras_ip_address_unique` ON `cameras` (`ip_address`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);