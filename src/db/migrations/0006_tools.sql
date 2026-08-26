-- drizzle-kit no emite la acción del FK en un ADD COLUMN; sqlite sí la acepta y sin ella borrar el
-- gimnasio activo falla en vez de dejar active_gym_id en null (el snapshot ya dice "set null").
ALTER TABLE `settings` ADD `active_gym_id` integer REFERENCES gym(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `sex` text;
