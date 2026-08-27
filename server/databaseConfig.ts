const POSTGRES_URL_PATTERN = /^postgres(?:ql)?:\/\//i;

/**
 * Resolve a PostgreSQL connection URL without ever exposing it in API responses.
 * SUPABASE_DATABASE_URL is preferred, while DATABASE_URL supports standard hosts
 * such as Render that inject a conventional database variable.
 */
export function resolvePostgresDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const connectionString = env.SUPABASE_DATABASE_URL?.trim() || env.DATABASE_URL?.trim();
  return connectionString && POSTGRES_URL_PATTERN.test(connectionString) ? connectionString : null;
}
