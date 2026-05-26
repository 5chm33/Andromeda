CREATE TABLE `search_history` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`userId` int,
	`sessionId` varchar(64),
	`query` text NOT NULL,
	`aiAnswer` text,
	`sources` json,
	`filter` varchar(32) DEFAULT 'all',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `search_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `search_suggestions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`query` varchar(256) NOT NULL,
	`count` int NOT NULL DEFAULT 1,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `search_suggestions_id` PRIMARY KEY(`id`),
	CONSTRAINT `search_suggestions_query_unique` UNIQUE(`query`)
);
--> statement-breakpoint
ALTER TABLE `search_history` ADD CONSTRAINT `search_history_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;