ALTER TABLE `set_entry` ADD `target_reps_min` integer;--> statement-breakpoint
ALTER TABLE `set_entry` ADD `target_reps_max` integer;--> statement-breakpoint
DROP VIEW `v_work_set`;--> statement-breakpoint
CREATE VIEW `v_work_set` AS select "id", "session_exercise_id", "order_index", "kind", "weight_g", "reps", "target_reps_min", "target_reps_max", "duration_ms", "distance_mm", "rpe", "rir", "side", "parent_set_id", "suggested_weight_g", "is_pr", "completed_at", "note" from "set_entry" where ("set_entry"."kind" <> 'warmup' and "set_entry"."completed_at" is not null);