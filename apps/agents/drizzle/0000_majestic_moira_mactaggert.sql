CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`active` integer DEFAULT 0 NOT NULL,
	`context` text,
	`compactionCount` integer DEFAULT 0 NOT NULL,
	`summary` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`closedAt` text
);
--> statement-breakpoint
CREATE INDEX `conversations_active_index` ON `conversations` (`active`);--> statement-breakpoint
CREATE TABLE `messages` (
	`conversationId` text NOT NULL,
	`sequence` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`metadata` text,
	`inputTokens` integer,
	`outputTokens` integer,
	`sentAt` text NOT NULL,
	PRIMARY KEY(`conversationId`, `sequence`),
	FOREIGN KEY (`conversationId`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_conversation_index` ON `messages` (`conversationId`);--> statement-breakpoint
CREATE INDEX `messages_role_index` ON `messages` (`role`);--> statement-breakpoint
CREATE INDEX `messages_conversation_sequence_index` ON `messages` (`conversationId`,`sequence`);--> statement-breakpoint
CREATE TABLE `stream_states` (
	`conversationId` text PRIMARY KEY NOT NULL,
	`chunkIndex` integer DEFAULT 0 NOT NULL,
	`contentParts` text DEFAULT '[]' NOT NULL,
	`pendingToolCall` text,
	`userMessageContent` text,
	`isActive` integer DEFAULT 1 NOT NULL,
	`startedAt` text NOT NULL,
	`lastChunkAt` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `stream_states_active_index` ON `stream_states` (`isActive`);