require("dotenv").config();
const supabase = require("../config/supabaseClient");
const crypto = require("crypto");

function splitName(fullName) {
  if (!fullName) return { firstName: "Admin", lastName: "" };
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts.shift() || "Admin";
  const lastName = parts.join(" ");
  return { firstName, lastName };
}

function generateTempPassword() {
  return crypto.randomBytes(16).toString("hex");
}

async function findAuthUserByEmail(email) {
  const { data, error } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (error) throw error;
  return data.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase()
  );
}

async function migrateAdmins() {
  console.log("=== Starting admin migration ===");

  const { data: admins, error } = await supabase.from("admin_login").select("*");

  if (error) {
    console.error("Failed to fetch admin_login rows:", error.message);
    return;
  }

  console.log(`Found ${admins.length} admin(s) to check.`);

  for (const admin of admins) {
    const email = admin["Admin Email"];
    const role = admin["Admin Role"] || "ADMIN";
    const teamName = admin["Team Name"] || null;
    const { firstName, lastName } = splitName(admin["Admin Name"]);

    console.log(`\n--- Processing ${email} ---`);

    if (!email) {
      console.log("SKIP: row has no email.");
      continue;
    }

    const { data: existingProfile } = await supabase
      .from("user_master")
      .select("*")
      .eq("Email", email)
      .maybeSingle();

    if (existingProfile && existingProfile["Auth User Id"]) {
      console.log("SKIP: already migrated.");
      continue;
    }

    let authUserId = null;
    let createdNew = false;
    const tempPassword = generateTempPassword();

    const { data: authData, error: authError } =
      await supabase.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { role, first_name: firstName, last_name: lastName },
      });

    if (authError) {
      if (authError.message?.includes("already been registered")) {
        console.log("Auth user already exists — looking it up instead.");
        const existingAuthUser = await findAuthUserByEmail(email);
        if (!existingAuthUser) {
          console.error(
            `FAILED: Auth says ${email} is registered, but it could not be found via listUsers.`
          );
          continue;
        }
        authUserId = existingAuthUser.id;
        console.log("Found existing Auth user:", authUserId);
      } else {
        console.error(`FAILED to create Auth user for ${email}:`, authError.message);
        continue;
      }
    } else {
      authUserId = authData.user.id;
      createdNew = true;
      console.log("Created Auth user:", authUserId);
    }

    if (existingProfile) {
      const { error: updateError } = await supabase
        .from("user_master")
        .update({ "Auth User Id": authUserId, "Role": role })
        .eq("Email", email);

      if (updateError) {
        console.error(`FAILED to update user_master for ${email}:`, updateError.message);
        continue;
      }
    } else {
      const { error: insertError } = await supabase
        .from("user_master")
        .insert([
          {
            "Auth User Id": authUserId,
            "First Name": firstName,
            "Last Name": lastName,
            "Email": email,
            "Department": teamName,
            "Role": role,
          },
        ]);

      if (insertError) {
        console.error(`FAILED to insert user_master row for ${email}:`, insertError.message);
        continue;
      }
    }

    if (createdNew) {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email);
      if (resetError) {
        console.error(`Could not send reset email to ${email}:`, resetError.message);
      } else {
        console.log(`Password reset email sent to ${email}.`);
      }
    }

    console.log(`DONE: ${email} migrated/linked successfully.`);
  }

  console.log("\n=== Migration complete ===");
}

migrateAdmins()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration script crashed:", err);
    process.exit(1);
  });