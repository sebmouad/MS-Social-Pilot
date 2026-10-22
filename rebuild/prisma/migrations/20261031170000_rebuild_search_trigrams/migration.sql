-- Optional acceleration for existing literal ILIKE searches. No data changes.
-- Managed installations may forbid extension installation or omit its package.
-- Those cases must not prevent the rest of the release from migrating.
DO $migration$
DECLARE
  extension_schema text;
  search_column record;
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION
    WHEN insufficient_privilege OR undefined_file OR feature_not_supported THEN
      RAISE NOTICE 'pg_trgm is unavailable; search indexes were not installed';
  END;

  SELECT n.nspname INTO extension_schema
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_trgm';
  IF extension_schema IS NULL THEN
    RETURN;
  END IF;

  -- Match the unwrapped text columns used by ILIKE, including either side of
  -- the person/text OR. Resolve the opclass from the installed extension schema.
  FOR search_column IN
    SELECT * FROM (VALUES
      ('posts', 'message', 'posts_message_trgm_idx'),
      ('conversations', 'snippet', 'conversations_snippet_trgm_idx'),
      ('conversation_messages', 'message', 'conversation_messages_message_trgm_idx'),
      ('conversation_messages', 'fromName', 'conversation_messages_author_trgm_idx'),
      ('post_comments', 'message', 'post_comments_message_trgm_idx'),
      ('post_comments', 'fromName', 'post_comments_author_trgm_idx'),
      ('page_reviews', 'reviewText', 'page_reviews_text_trgm_idx'),
      ('page_reviews', 'reviewerName', 'page_reviews_author_trgm_idx')
    ) AS columns(table_name, column_name, index_name)
  LOOP
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I USING gin (%I %I.gin_trgm_ops)',
      search_column.index_name, search_column.table_name, search_column.column_name, extension_schema);
  END LOOP;
END;
$migration$;
