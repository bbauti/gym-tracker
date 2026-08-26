ALTER TABLE `session_exercise` ADD `suggested_reason` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `volume_landmarks` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `deload_until` integer;--> statement-breakpoint
ALTER TABLE `settings` ADD `deload_dismissed_at` integer;--> statement-breakpoint
ALTER TABLE `settings` ADD `deload_ended_at` integer;