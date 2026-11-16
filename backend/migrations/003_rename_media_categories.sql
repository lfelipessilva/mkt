UPDATE media_assets
SET
  category = 'cover',
  storage_path = replace(storage_path, '/capas/', '/cover/')
WHERE category = 'capas';

UPDATE media_assets
SET
  category = 'random',
  storage_path = replace(storage_path, '/aleatorias/', '/random/')
WHERE category = 'aleatorias';

UPDATE carousel_slides
SET storage_path = regexp_replace(storage_path, '^.*?/output/', 'output/')
WHERE storage_path LIKE '%/output/%'
  AND storage_path NOT LIKE 'output/%';

UPDATE carousel_runs
SET output_dir = regexp_replace(output_dir, '^.*?/output/', 'output/')
WHERE output_dir LIKE '%/output/%'
  AND output_dir NOT LIKE 'output/%';
