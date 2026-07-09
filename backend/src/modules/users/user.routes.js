const express = require("express");
const router = express.Router();
const supabase = require("../../config/supabaseClient");
const bcrypt = require("bcrypt");

// Reusable core logic — used by both single add-user and bulk add-user
async function createSingleUser({
  firstName, lastName, email, employeeId, designation,
  department, dob, doj, reportingManager, password,
  workedInTeams, role,
}) {
  if (!firstName || !email || !role || !password) {
    return { success: false, message: "First name, email, role and password are required.", email };
  }

  const { data: existingRows, error: checkError } = await supabase
    .from("user_master")
    .select("*")
    .eq("Email", email);

  if (checkError) {
    return { success: false, message: checkError.message, email };
  }

  if (existingRows && existingRows.length > 0) {
    for (const row of existingRows) {
      const sameRole = row["Role"] === role;
      const samePassword = row["Password Hash"]
        ? await bcrypt.compare(password, row["Password Hash"])
        : false;

      if (sameRole && samePassword) {
        return { success: false, message: "A user with this email, role and password already exists.", email };
      }
      if (samePassword && !sameRole) {
        return { success: false, message: "This password is already used by another role under this email.", email };
      }
      if (sameRole && !samePassword) {
        return { success: false, message: `A user with this email already exists for the ${role} role.`, email };
      }
    }
  }

  const [localPart, domain] = email.split("@");
  const loginEmail = `${localPart}+${role.toLowerCase()}@${domain}`;

  const { data: authData, error: authError } =
    await supabase.auth.admin.createUser({
      email: loginEmail,
      password,
      email_confirm: true,
      user_metadata: { role, first_name: firstName, last_name: lastName || "", real_email: email },
    });

  if (authError) {
    return { success: false, message: authError.message, email };
  }

  const createdAuthUserId = authData.user.id;
  const passwordHash = await bcrypt.hash(password, 10);

  const { data, error } = await supabase
    .from("user_master")
    .insert([
      {
        "Auth User Id": createdAuthUserId,
        "First Name": firstName,
        "Last Name": lastName || null,
        "Email": email,
        "Login Email": loginEmail,
        "Password Hash": passwordHash,
        "Employee ID": employeeId || null,
        "Designation": designation || null,
        "Department": department || null,
        "Date of Birth": dob || null,
        "Date of Joining": doj || null,
        "Reporting Manager": reportingManager || null,
        "Worked In Teams": workedInTeams || null,
        "Role": role,
      },
    ])
    .select();

  if (error) {
    await supabase.auth.admin.deleteUser(createdAuthUserId);
    return { success: false, message: error.message, email };
  }

  return { success: true, message: "User Added Successfully", email, user: data?.[0] };
}

// Single user add
router.post("/add-user", async (req, res) => {
  try {
    const result = await createSingleUser(req.body);
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.message });
    }
    res.status(201).json({ success: true, message: result.message, user: result.user });
  } catch (err) {
    console.error("ADD USER ERROR:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Bulk user add from Excel-parsed rows
router.post("/bulk-add-user", async (req, res) => {
  try {
    const { users } = req.body;

    if (!Array.isArray(users) || users.length === 0) {
      return res.status(400).json({ success: false, message: "No users provided." });
    }

    const results = [];

    for (const row of users) {
      const result = await createSingleUser(row);
      results.push(result);
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.length - successCount;

    res.status(200).json({
      success: true,
      message: `${successCount} user(s) created, ${failCount} failed.`,
      results,
    });
  } catch (err) {
    console.error("BULK ADD USER ERROR:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;