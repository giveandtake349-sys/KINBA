const POSTGRES_URL_PATTERN = /^postgres(?:ql)?:\/\//i;

/**
 * Resolve a PostgreSQL connection URL without ever exposing it in API responses.
 * DATABASE_URL is preferred so the API follows the primary database migrated by
 * deployment tooling; SUPABASE_DATABASE_URL remains a supported fallback.
 */
export function resolvePostgresDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const connectionString = env.DATABASE_URL?.trim() || env.SUPABASE_DATABASE_URL?.trim();
  return connectionString && POSTGRES_URL_PATTERN.test(connectionString) ? connectionString : null;
}
