CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`content` text,
	`streamId` text,
	`isPartial` integer DEFAULT 0,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_created_index` ON `activity` (`createdAt`);--> statement-breakpoint
CREATE INDEX `activity_stream_index` ON `activity` (`streamId`);--> statement-breakpoint
CREATE TABLE `findings` (
	`id` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`cellType` text DEFAULT 'markdown',
	`createdAt` integer NOT NULL,
	`syncedToNotebook` integer DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX `findings_created_index` ON `findings` (`createdAt`);--> statement-breakpoint
CREATE TABLE `state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text
);
