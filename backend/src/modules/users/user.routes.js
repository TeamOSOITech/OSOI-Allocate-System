const express = require("express");
const router = express.Router();
const supabase = require("../../config/supabaseClient");
const bcrypt = require("bcrypt");

router.post("/add-user", async (req, res) => {
  let createdAuthUserId = null;

  try {
    const {
      firstName, lastName, email, employeeId, designation,
      department, dob, doj, reportingManager, password,
      workedInTeams, role,
    } = req.body;

    if (!firstName || !lastName || !email || !role || !password) {
      return res.status(400).json({
        success: false,
        message: "First name, last name, email, role and password are required.",
      });
    }

    // Fetch all existing accounts under this real email (any role)
    const { data: existingRows, error: checkError } = await supabase
      .from("user_master")
      .select("*")
      .eq("Email", email);

    if (checkError) throw checkError;

    if (existingRows && existingRows.length > 0) {
      // Check each existing row against the new (role, password) combo
      for (const row of existingRows) {
        const samePassword = row["Password Hash"]
          ? await bcrypt.compare(password, row["Password Hash"])
          : false;
        const sameRole = row["Role"] === role;

        // Rule 1 + role-collision: same email + same role -> reject.
        // (A second account with the same role would also collide on the
        // tagged Auth email john+role@domain.com, so this must be blocked
        // regardless of password.)
        if (sameRole) {
          return res.status(400).json({
            success: false,
            message: `A user with this email already exists for the ${role} role.`,
          });
        }

        // Rule 3: same email + same password but different role -> reject.
        if (samePassword) {
          return res.status(400).json({
            success: false,
            message: "This password is already used by another role under this email. Please choose a different password.",
          });
        }
      }
      // If we reach here: email exists, but role differs AND password differs -> Rule 2, allowed.
    }

    console.log("========== CREATE USER DEBUG ==========");
    console.log("Email:", email);
    console.log("Role:", role);
    console.log("Supabase URL:", process.env.SUPABASE_URL);
    console.log("Service Role Key Exists:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);

    // Build a unique tagged email for Supabase Auth so multiple roles
    // under the same real email don't collide (Supabase enforces unique
    // emails on auth.users). Most providers (Gmail etc.) ignore "+tag"
    // for delivery, so mail still reaches the same inbox.
    const [localPart, domain] = email.split("@");
    const loginEmail = `${localPart}+${role.toLowerCase()}@${domain}`;

    const { data: authData, error: authError } =
      await supabase.auth.admin.createUser({
        email: loginEmail,
        password,
        email_confirm: true,
        user_metadata: { role, first_name: firstName, last_name: lastName, real_email: email },
      });

    if (authError) throw authError;
    createdAuthUserId = authData.user.id;

    const passwordHash = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from("user_master")
      .insert([
        {
          "Auth User Id": createdAuthUserId,
          "First Name": firstName,
          "Last Name": lastName,
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
      throw error;
    }

    res.status(201).json({
      success: true,
      message: "User Added Successfully",
      user: data?.[0],
    });
  } catch (err) {
    console.error("========== ADD USER ERROR ==========");
    console.error(err);
    res.status(500).json({
      success: false,
      message: err.message,
      stack: process.env.NODE_ENV !== "production" ? err.stack : undefined,
    });
  }
});

module.exports = router;