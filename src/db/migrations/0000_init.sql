CREATE TABLE `body_metric` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`value` integer NOT NULL,
	`measured_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_body_metric_kind_at` ON `body_metric` (`kind`,`measured_at`);--> statement-breakpoint
CREATE TABLE `exercise` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`seed_id` text,
	`name_es` text NOT NULL,
	`name_en` text NOT NULL,
	`aliases` text,
	`primary_muscle` text NOT NULL,
	`secondary_muscles` text,
	`equipment` text NOT NULL,
	`pattern` text,
	`metric` text DEFAULT 'weight_reps' NOT NULL,
	`demo_url` text,
	`instructions_es` text,
	`instructions_en` text,
	`notes` text,
	`gym_id` integer,
	`is_custom` integer DEFAULT false NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`is_favorite` integer DEFAULT false NOT NULL,
	`default_increment_g` integer,
	`default_rest_sec` integer,
	FOREIGN KEY (`gym_id`) REFERENCES `gym`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercise_seed_id_unique` ON `exercise` (`seed_id`);--> statement-breakpoint
CREATE INDEX `idx_exercise_name_es` ON `exercise` (`name_es`);--> statement-breakpoint
CREATE INDEX `idx_exercise_muscle` ON `exercise` (`primary_muscle`);--> statement-breakpoint
CREATE TABLE `folder` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`order_index` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gym` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`plates_g` text,
	`bars_g` text
);
--> statement-breakpoint
CREATE TABLE `personal_record` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exercise_id` integer NOT NULL,
	`kind` text NOT NULL,
	`value_g` integer,
	`reps` integer,
	`set_entry_id` integer NOT NULL,
	`achieved_at` integer NOT NULL,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercise`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`set_entry_id`) REFERENCES `set_entry`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_personal_record_exercise_kind` ON `personal_record` (`exercise_id`,`kind`);--> statement-breakpoint
CREATE TABLE `routine` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`folder_id` integer,
	`weeks` integer,
	`current_day_index` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`folder_id`) REFERENCES `folder`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `routine_day` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`routine_id` integer NOT NULL,
	`name` text NOT NULL,
	`order_index` integer NOT NULL,
	`week_index` integer,
	`is_deload` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`routine_id`) REFERENCES `routine`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_routine_day_routine` ON `routine_day` (`routine_id`);--> statement-breakpoint
CREATE TABLE `routine_exercise` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`day_id` integer NOT NULL,
	`exercise_id` integer NOT NULL,
	`order_index` integer NOT NULL,
	`superset_group` integer,
	`rest_sec` integer,
	`warmup_rest_sec` integer,
	FOREIGN KEY (`day_id`) REFERENCES `routine_day`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercise`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_routine_exercise_day` ON `routine_exercise` (`day_id`);--> statement-breakpoint
CREATE INDEX `idx_routine_exercise_exercise` ON `routine_exercise` (`exercise_id`);--> statement-breakpoint
CREATE TABLE `routine_set` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`routine_exercise_id` integer NOT NULL,
	`order_index` integer NOT NULL,
	`kind` text DEFAULT 'normal' NOT NULL,
	`reps_min` integer,
	`reps_max` integer,
	`target_rpe` real,
	FOREIGN KEY (`routine_exercise_id`) REFERENCES `routine_exercise`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_routine_set_exercise` ON `routine_set` (`routine_exercise_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`routine_day_id` integer,
	`name` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`paused_ms` integer DEFAULT 0 NOT NULL,
	`note` text,
	`rest_ends_at` integer,
	FOREIGN KEY (`routine_day_id`) REFERENCES `routine_day`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_session_started` ON `session` (`started_at`);--> statement-breakpoint
CREATE TABLE `session_exercise` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`exercise_id` integer NOT NULL,
	`order_index` integer NOT NULL,
	`superset_group` integer,
	`note` text,
	`feedback` text,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercise`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_session_exercise_session` ON `session_exercise` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_session_exercise_exercise` ON `session_exercise` (`exercise_id`);--> statement-breakpoint
CREATE TABLE `set_entry` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_exercise_id` integer NOT NULL,
	`order_index` integer NOT NULL,
	`kind` text DEFAULT 'normal' NOT NULL,
	`weight_g` integer,
	`reps` integer,
	`duration_ms` integer,
	`distance_mm` integer,
	`rpe` real,
	`rir` integer,
	`side` text,
	`parent_set_id` integer,
	`suggested_weight_g` integer,
	`is_pr` integer DEFAULT false NOT NULL,
	`completed_at` integer,
	`note` text,
	FOREIGN KEY (`session_exercise_id`) REFERENCES `session_exercise`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_set_id`) REFERENCES `set_entry`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_set_entry_session_exercise` ON `set_entry` (`session_exercise_id`);--> statement-breakpoint
CREATE INDEX `idx_set_entry_completed` ON `set_entry` (`completed_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`unit` text DEFAULT 'kg' NOT NULL,
	`rpe_mode` text DEFAULT 'rpe' NOT NULL,
	`e1rm_formula` text DEFAULT 'epley' NOT NULL,
	`haptics` integer DEFAULT true NOT NULL,
	`default_increment_g` integer DEFAULT 2500 NOT NULL,
	`default_rest_sec` integer DEFAULT 90 NOT NULL,
	`locale` text,
	`seed_version` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "settings_single_row" CHECK("settings"."id" = 1)
);
--> statement-breakpoint
CREATE VIEW `v_work_set` AS select "id", "session_exercise_id", "order_index", "kind", "weight_g", "reps", "duration_ms", "distance_mm", "rpe", "rir", "side", "parent_set_id", "suggested_weight_g", "is_pr", "completed_at", "note" from "set_entry" where ("set_entry"."kind" <> 'warmup' and "set_entry"."completed_at" is not null);