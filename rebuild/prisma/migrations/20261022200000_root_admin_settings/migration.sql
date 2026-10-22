-- Preserve saved values and metadata; an existing canonical key always wins.
UPDATE app_settings AS source
SET key = 'root.admin.' || substr(source.key, length('root.legacy.') + 1)
WHERE source.key LIKE 'root.legacy.%'
  AND NOT EXISTS (
    SELECT 1 FROM app_settings AS target
    WHERE target.key = 'root.admin.' || substr(source.key, length('root.legacy.') + 1)
  );
