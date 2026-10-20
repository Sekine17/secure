import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const ALLOWED = ["employees", "logs", "settings", "auth"];

export default async function handler(req, res) {
  const key = req.query.key;
  if (!ALLOWED.includes(key)) return res.status(404).end();
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    const { data, error } = await db.from("kv").select("value").eq("key", key).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ value: data?.value ?? null });
  }

  if (req.method === "PUT") {
    const value = req.body?.value;
    const { error } = await db.from("kv").upsert({ key, value });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({});
  }

  res.status(405).end();
}