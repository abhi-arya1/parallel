PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_state` (
	`agentId` text NOT NULL,
	`key` text NOT NULL,
	`value` text,
	PRIMARY KEY(`agentId`, `key`)
);
--> statement-breakpoint
INSERT INTO `__new_state`("agentId", "key", "value") SELECT "agentId", "key", "value" FROM `state`;--> statement-breakpoint
DROP TABLE `state`;--> statement-breakpoint
ALTER TABLE `__new_state` RENAME TO `state`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `activity` ADD `agentId` text NOT NULL;--> statement-breakpoint
CREATE INDEX `activity_agent_index` ON `activity` (`agentId`);--> statement-breakpoint
ALTER TABLE `conversations` ADD `agentId` text NOT NULL;--> statement-breakpoint
CREATE INDEX `conversations_agent_index` ON `conversations` (`agentId`);--> statement-breakpoint
ALTER TABLE `findings` ADD `agentId` text NOT NULL;--> statement-breakpoint
CREATE INDEX `findings_agent_index` ON `findings` (`agentId`);--> statement-breakpoint
ALTER TABLE `messages` ADD `agentId` text NOT NULL;--> statement-breakpoint
CREATE INDEX `messages_agent_index` ON `messages` (`agentId`);