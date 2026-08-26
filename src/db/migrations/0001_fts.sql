CREATE VIRTUAL TABLE `exercise_fts` USING fts5(name_es, name_en, aliases, tokenize="unicode61 remove_diacritics 2");
--> statement-breakpoint
CREATE TRIGGER `exercise_fts_ai` AFTER INSERT ON `exercise` BEGIN
  INSERT INTO exercise_fts(rowid, name_es, name_en, aliases) VALUES (new.id, new.name_es, new.name_en, new.aliases);
END;
--> statement-breakpoint
CREATE TRIGGER `exercise_fts_ad` AFTER DELETE ON `exercise` BEGIN
  DELETE FROM exercise_fts WHERE rowid = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER `exercise_fts_au` AFTER UPDATE OF name_es, name_en, aliases ON `exercise` BEGIN
  DELETE FROM exercise_fts WHERE rowid = old.id;
  INSERT INTO exercise_fts(rowid, name_es, name_en, aliases) VALUES (new.id, new.name_es, new.name_en, new.aliases);
END;
