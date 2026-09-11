// Seeds a local Supabase stack with two test users and a game between them
// (docs/phase4.md §8). Usage:
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... \
//   SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node scripts/seed-local.mjs
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { createGameForUsers } from "../supabase/functions/_shared/katan.bundle.js";

const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbUrl = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required (see `supabase status`)");

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
async function user(email, name) {
  const { data: list } = await admin.auth.admin.listUsers();
  const existing = list.users.find((u) => u.email === email);
  if (existing) return existing.id;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { display_name: name } });
  if (error) throw error;
  return data.user.id;
}
const alice = await user("alice@example.com", "Alice");
const bob = await user("bob@example.com", "Bob");
const sql = postgres(dbUrl, { max: 1 });
const { gameId } = await createGameForUsers(sql, {
  createdBy: alice,
  board: "beginner",
  seed: "seed-local",
  players: [
    { name: "Alice", color: "red", kind: "human", userId: alice },
    { name: "Bob", color: "blue", kind: "human", userId: bob },
    { name: "Bot (medium)", color: "orange", kind: "bot", level: "medium" },
  ],
});
console.log(`game ${gameId}: alice@example.com and bob@example.com (magic link via Inbucket at http://127.0.0.1:54324) vs a medium bot`);
await sql.end();
