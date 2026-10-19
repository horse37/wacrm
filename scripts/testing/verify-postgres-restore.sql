-- Emit a deterministic catalog manifest. The PowerShell harness compares the
-- exact manifest from the source database with the restored database.
SELECT 'migration', version::text, name || '|' || checksum
  FROM public.wacrm_schema_migrations
 ORDER BY version;

SELECT 'table', schemaname || '.' || tablename, ''
  FROM pg_tables
 WHERE schemaname IN ('public', 'auth', 'storage')
 ORDER BY schemaname, tablename;

SELECT 'column', n.nspname || '.' || c.relname || '.' || a.attname,
       format('%s|%s|%s|%s', a.attnum, format_type(a.atttypid, a.atttypmod),
              a.attnotnull, COALESCE(pg_get_expr(d.adbin, d.adrelid), ''))
  FROM pg_attribute AS a
  JOIN pg_class AS c ON c.oid = a.attrelid
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef AS d ON d.adrelid = c.oid AND d.adnum = a.attnum
 WHERE n.nspname IN ('public', 'auth', 'storage')
   AND c.relkind IN ('r', 'p')
   AND a.attnum > 0
   AND NOT a.attisdropped
 ORDER BY n.nspname, c.relname, a.attnum;

SELECT 'policy', schemaname || '.' || tablename || '.' || policyname,
       format('%s|%s|%s|%s|%s', permissive, roles, cmd,
              COALESCE(qual, ''), COALESCE(with_check, ''))
  FROM pg_policies
 ORDER BY schemaname, tablename, policyname;

SELECT 'auth-trigger', t.tgname,
       pg_get_triggerdef(t.oid) || '|' || t.tgfoid::regprocedure::text
  FROM pg_trigger AS t
  JOIN pg_class AS c ON c.oid = t.tgrelid
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
 WHERE n.nspname = 'auth'
   AND c.relname = 'users'
   AND NOT t.tgisinternal
 ORDER BY t.tgname;

SELECT 'publication', pubname,
       format('%s|%s|%s|%s', puballtables, pubinsert, pubupdate, pubdelete)
  FROM pg_publication
 ORDER BY pubname;
