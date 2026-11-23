// backend/src/scripts/resetMfa.js
//
// LAST-RESORT 2FA reset - only for the Allookate team, run from the server.
// Usage:  node src/scripts/resetMfa.js user@example.com
//
// Deletes every MFA factor of that user. After this the user logs in with
// just the password and sets up 2FA again (the app forces it for them).
// Verify the person's identity BEFORE running this.
require("dotenv").config();
const supabase = require("../config/supabaseClient");

async function findAuthUserByEmail(email) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;
    const hit = data.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );
    if (hit) return hit;
    if (data.users.length < 1000) return null;
  }
  return null;
}

(async () => {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: node src/scripts/resetMfa.js user@example.com");
    process.exit(1);
  }
  const user = await findAuthUserByEmail(email);
  if (!user) {
    console.error(`No user found for ${email}`);
    process.exit(1);
  }
  const { data, error } = await supabase.auth.admin.mfa.listFactors({
    userId: user.id,
  });
  if (error) throw error;
  const factors = data?.factors || [];
  if (!factors.length) {
    console.log("This user has no 2FA factors - nothing to reset.");
    return;
  }
  for (const f of factors) {
    const { error: e } = await supabase.auth.admin.mfa.deleteFactor({
      id: f.id,
      userId: user.id,
    });
    if (e) throw e;
  }
  console.log(`Done: removed ${factors.length} factor(s) for ${email}.`);
  console.log(`Audit: ${new Date().toISOString()} reset MFA for ${user.id}`);
})().catch((e) => {
  console.error("Reset failed:", e.message || e);
  process.exit(1);
});
