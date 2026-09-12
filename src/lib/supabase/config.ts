export function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey)
    throw new Error(
      "Supabase 尚未配置。请在 .env.local 或 Vercel 中设置 NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY。",
    );
  return { url, publishableKey };
}
