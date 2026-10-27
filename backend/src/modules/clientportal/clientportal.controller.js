// src/modules/clientportal/clientportal.controller.js
const { todayInTz } = require("../../utils/dates");
const { escapeLike } = require("../../utils/likeEscape");
//
// CLIENT DASHBOARD
// ----------------
// A login with role CLIENT is tied to exactly one client
// (user_master.client_id). It can see ONLY the cases that staff have
// explicitly shared with that client (client_shared_cases) — nothing else
// in the app. The client id is ALWAYS read server-side from the caller's
// own user_master row; it is never taken from the request.
//
// What a client never gets: employee names, QC/audit notes, pass/fail
// details, allocation history. Internal states are collapsed into the
// 5 client-facing statuses in clientStatus() below.
//
// Staff side (client_portal.manage): list a client's cases, share /
// unshare them, and link an existing login to a client.

const supabase = require("../../config/supabaseClient");
const {
  emailExists,
  normalizeEmail,
  generateFallbackPassword,
  createUserAndGenerateResetLink,
} = require("../users/user.service");
const { fetchAll } = require("../../utils/fetchAll");

const CHUNK = 200;
const MAX_IDS_PER_CALL = 500;
// ids may be integers OR uuids depending on the table — accept both shapes,
// reject anything else (also keeps junk out of PostgREST filters).
const UUID_RE =
  /^(\d{1,18}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Public mail providers never count as "the client's domain".
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.in",
  "yahoo.co.in",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
  "rediffmail.com",
]);

const domainOf = (email) =>
  String(email || "")
    .split("@")[1]
    ?.trim()
    .toLowerCase() || "";

function hostOf(website) {
  try {
    const w = String(website || "").trim();
    if (!w) return "";
    const url = new URL(/^https?:\/\//i.test(w) ? w : `https://${w}`);
    return url.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

// Which emails / domains may be used for a client, from its own record:
// its saved contact emails are always allowed; any other address must be on
// one of the client's company domains (taken from those emails + website).
function buildEmailRules(c) {
  const emails = [
    c?.primary_contact_email,
    c?.secondary_contact_email,
    c?.main_email,
  ]
    .map((x) =>
      String(x || "")
        .trim()
        .toLowerCase(),
    )
    .filter((x) => EMAIL_RE.test(x));
  const domains = new Set(
    [...emails.map(domainOf), hostOf(c?.website)].filter(
      (d) => d && !PUBLIC_EMAIL_DOMAINS.has(d),
    ),
  );
  return { emails: new Set(emails), domains: [...domains] };
}

function emailAllowed(email, rules) {
  const e = String(email || "")
    .trim()
    .toLowerCase();
  if (rules.emails.has(e)) return true;
  const d = domainOf(e);
  return rules.domains.some((x) => d === x || d.endsWith(`.${x}`));
}

async function getClientEmailRules(clientId, organizationId) {
  const { data, error } = await supabase
    .from("clients")
    .select(
      "website, main_email, primary_contact_email, secondary_contact_email",
    )
    .eq("id", clientId)
    .eq("organization_id", organizationId)
    .limit(1);
  if (error) throw error;
  return buildEmailRules(data?.[0] || {});
}

const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

// Internal state -> what a client is allowed to see.
function clientStatus(r) {
  if (r.audit_status === "AUDIT_PASS") return "Completed";
  if (r.submission_status === "SUBMITTED") {
    if (r.qc_status === "QC_PASS" && !r.audit_status) return "Completed";
    if (r.qc_status || r.audit_status) return "Under Review";
    return "Submitted";
  }
  if ((r.allocation_status || "PENDING") === "ALLOCATED") return "In Progress";
  return "Received";
}

async function getMyClientId(req) {
  const { data, error } = await supabase
    .from("user_master")
    .select("client_id")
    .eq("Auth User Id", req.user.userId)
    .eq("organization_id", req.user.organizationId)
    .limit(1);
  if (error) throw error;
  return data?.[0]?.client_id || null;
}

async function assertClientInOrg(clientId, organizationId) {
  if (!UUID_RE.test(String(clientId || ""))) return null;
  const { data, error } = await supabase
    .from("clients")
    .select("id, name")
    .eq("id", clientId)
    .eq("organization_id", organizationId)
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

async function nameMaps(rows, organizationId) {
  const productIds = [
    ...new Set(rows.map((r) => r.product_id).filter(Boolean)),
  ];
  const subIds = [...new Set(rows.map((r) => r.subclient_id).filter(Boolean))];
  const productMap = {};
  const subMap = {};
  for (const ids of chunk(productIds, CHUNK)) {
    const { data, error } = await supabase
      .from("service_master")
      .select("id, product_name")
      .eq("organization_id", organizationId)
      .in("id", ids);
    if (error) throw error;
    (data || []).forEach((p) => (productMap[p.id] = p.product_name));
  }
  for (const ids of chunk(subIds, CHUNK)) {
    const { data, error } = await supabase
      .from("subclients")
      .select("id, name")
      .eq("organization_id", organizationId)
      .in("id", ids);
    if (error) throw error;
    (data || []).forEach((s) => (subMap[s.id] = s.name));
  }
  return { productMap, subMap };
}

const CASE_COLS =
  "id, case_number, work_date, product_id, subclient_id, allocation_status, submission_status, submitted_at, qc_status, audit_status";

// ---------------------------------------------------------------------
// CLIENT: GET /api/client-portal/dashboard
// ---------------------------------------------------------------------
async function getDashboard(req, res) {
  try {
    const orgId = req.user.organizationId;
    const clientId = await getMyClientId(req);
    if (!clientId) {
      return res.status(403).json({
        success: false,
        message:
          "Your login is not linked to a client yet. Please contact your account manager.",
      });
    }

    const client = await assertClientInOrg(clientId, orgId);
    if (!client) {
      return res
        .status(403)
        .json({ success: false, message: "Client not found." });
    }

    const { data: shares, error: shareErr } = await fetchAll(() =>
      supabase
        .from("client_shared_cases")
        .select("id, case_id, shared_at")
        .eq("organization_id", orgId)
        .eq("client_id", clientId)
        .order("shared_at", { ascending: false })
        .order("id"),
    );
    if (shareErr) throw shareErr;

    const sharedAtById = {};
    (shares || []).forEach((s) => (sharedAtById[s.case_id] = s.shared_at));
    const caseIds = Object.keys(sharedAtById);

    let rows = [];
    for (const ids of chunk(caseIds, CHUNK)) {
      const { data, error } = await supabase
        .from("service_cases")
        .select(CASE_COLS)
        .eq("organization_id", orgId)
        .eq("client_id", clientId) // defence in depth: must be THIS client's case
        .in("id", ids);
      if (error) throw error;
      rows.push(...(data || []));
    }

    const { productMap, subMap } = await nameMaps(rows, orgId);

    const cases = rows
      .map((r) => ({
        id: r.id,
        caseNumber: r.case_number,
        service: productMap[r.product_id] || null,
        subclient: subMap[r.subclient_id] || null,
        workDate: r.work_date,
        status: clientStatus(r),
        submittedAt: r.submitted_at || null,
        sharedAt: sharedAtById[r.id] || null,
      }))
      .sort((a, b) => String(b.sharedAt).localeCompare(String(a.sharedAt)));

    const count = (s) => cases.filter((c) => c.status === s).length;
    res.json({
      success: true,
      data: {
        client: { id: client.id, name: client.name },
        summary: {
          total: cases.length,
          received: count("Received"),
          inProgress: count("In Progress"),
          submitted: count("Submitted"),
          underReview: count("Under Review"),
          completed: count("Completed"),
        },
        cases,
      },
    });
  } catch (err) {
    console.error("CLIENT PORTAL dashboard error:", err);
    res
      .status(500)
      .json({ success: false, message: "Could not load your dashboard." });
  }
}

// ---------------------------------------------------------------------
// STAFF: GET /api/client-portal/clients/:clientId/cases?workDate=&q=
// ---------------------------------------------------------------------
async function listClientCases(req, res) {
  try {
    const orgId = req.user.organizationId;
    const client = await assertClientInOrg(req.params.clientId, orgId);
    if (!client)
      return res
        .status(404)
        .json({ success: false, message: "Client not found." });

    let q = supabase
      .from("service_cases")
      .select(CASE_COLS)
      .eq("organization_id", orgId)
      .eq("client_id", client.id)
      .order("work_date", { ascending: false })
      .order("sequence_number", { ascending: false })
      .limit(500);

    if (req.query.workDate) q = q.eq("work_date", String(req.query.workDate));
    if (req.query.q) {
      // strip characters that have meaning inside a PostgREST filter
      const term = String(req.query.q)
        .replace(/[%,()*\\]/g, "")
        .trim();
      if (term) q = q.ilike("case_number", `%${escapeLike(term)}%`);
    }

    const { data: rows, error } = await q;
    if (error) throw error;

    const ids = (rows || []).map((r) => r.id);
    const sharedSet = new Set();
    for (const part of chunk(ids, CHUNK)) {
      const { data, error: e2 } = await supabase
        .from("client_shared_cases")
        .select("case_id")
        .eq("organization_id", orgId)
        .eq("client_id", client.id)
        .in("case_id", part);
      if (e2) throw e2;
      (data || []).forEach((s) => sharedSet.add(s.case_id));
    }

    const { productMap, subMap } = await nameMaps(rows || [], orgId);

    res.json({
      success: true,
      data: (rows || []).map((r) => ({
        id: r.id,
        caseNumber: r.case_number,
        service: productMap[r.product_id] || null,
        subclient: subMap[r.subclient_id] || null,
        workDate: r.work_date,
        status: clientStatus(r),
        shared: sharedSet.has(r.id),
      })),
    });
  } catch (err) {
    console.error("CLIENT PORTAL list cases error:", err);
    res.status(500).json({ success: false, message: "Could not load cases." });
  }
}

// ---------------------------------------------------------------------
// STAFF: GET /api/client-portal/clients/:clientId/contacts
// Emails stored on the client record (primary, secondary, main), used by
// the Share dialog's contact dropdown. Primary comes first.
// ---------------------------------------------------------------------
async function getClientContacts(req, res) {
  try {
    const orgId = req.user.organizationId;
    const clientId = String(req.params.clientId || "");
    if (!UUID_RE.test(clientId))
      return res
        .status(404)
        .json({ success: false, message: "Client not found." });

    const { data, error } = await supabase
      .from("clients")
      .select(
        "id, website, main_email, primary_contact_name, primary_contact_email, secondary_contact_name, secondary_contact_email",
      )
      .eq("id", clientId)
      .eq("organization_id", orgId)
      .limit(1);
    if (error) throw error;

    const c = data?.[0];
    if (!c)
      return res
        .status(404)
        .json({ success: false, message: "Client not found." });

    const seen = new Set();
    const contacts = [
      {
        label: "Primary",
        name: c.primary_contact_name || null,
        email: c.primary_contact_email,
      },
      {
        label: "Secondary",
        name: c.secondary_contact_name || null,
        email: c.secondary_contact_email,
      },
      { label: "Main", name: null, email: c.main_email },
    ]
      .map((x) => ({ ...x, email: String(x.email || "").trim() }))
      .filter((x) => {
        const key = x.email.toLowerCase();
        if (!EMAIL_RE.test(x.email) || seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    res.json({
      success: true,
      data: contacts,
      domains: buildEmailRules(c).domains,
    });
  } catch (err) {
    console.error("CLIENT PORTAL contacts error:", err);
    res
      .status(500)
      .json({ success: false, message: "Could not load contacts." });
  }
}

function parseIds(body) {
  const ids = Array.isArray(body?.caseIds) ? body.caseIds : [];
  const clean = [...new Set(ids.map(String))].filter((id) => UUID_RE.test(id));
  return clean.slice(0, MAX_IDS_PER_CALL);
}

// STAFF: POST /api/client-portal/share   { clientId, caseIds: [] }
async function shareCases(req, res) {
  try {
    const orgId = req.user.organizationId;
    const client = await assertClientInOrg(req.body?.clientId, orgId);
    if (!client)
      return res
        .status(404)
        .json({ success: false, message: "Client not found." });

    const ids = parseIds(req.body);
    if (!ids.length)
      return res
        .status(400)
        .json({ success: false, message: "Select at least one case." });

    // only cases that really belong to THIS client in THIS org can be shared
    const valid = [];
    for (const part of chunk(ids, CHUNK)) {
      const { data, error } = await supabase
        .from("service_cases")
        .select("id")
        .eq("organization_id", orgId)
        .eq("client_id", client.id)
        .in("id", part);
      if (error) throw error;
      valid.push(...(data || []).map((r) => r.id));
    }

    if (valid.length) {
      const { error } = await supabase.from("client_shared_cases").upsert(
        valid.map((caseId) => ({
          organization_id: orgId,
          client_id: client.id,
          case_id: caseId,
          shared_by: req.user.userId,
        })),
        { onConflict: "client_id,case_id", ignoreDuplicates: true },
      );
      if (error) throw error;
    }

    res.json({
      success: true,
      message: `${valid.length} case(s) shared with ${client.name}.`,
      data: { shared: valid.length, skipped: ids.length - valid.length },
    });
  } catch (err) {
    console.error("CLIENT PORTAL share error:", err);
    res.status(500).json({ success: false, message: "Could not share cases." });
  }
}

// STAFF: POST /api/client-portal/unshare   { clientId, caseIds: [] }
async function unshareCases(req, res) {
  try {
    const orgId = req.user.organizationId;
    const client = await assertClientInOrg(req.body?.clientId, orgId);
    if (!client)
      return res
        .status(404)
        .json({ success: false, message: "Client not found." });

    const ids = parseIds(req.body);
    if (!ids.length)
      return res
        .status(400)
        .json({ success: false, message: "Select at least one case." });

    const { error } = await supabase
      .from("client_shared_cases")
      .delete()
      .eq("organization_id", orgId)
      .eq("client_id", client.id)
      .in("case_id", ids);
    if (error) throw error;

    res.json({
      success: true,
      message: `${ids.length} case(s) removed from ${client.name}'s dashboard.`,
    });
  } catch (err) {
    console.error("CLIENT PORTAL unshare error:", err);
    res
      .status(500)
      .json({ success: false, message: "Could not remove cases." });
  }
}

// STAFF (Super Admin / Ops Manager): POST /api/client-portal/link-user
//   { email, clientId }
// Turns an EXISTING login (created via Add User) into a CLIENT login for
// that client. Only plain Team Member accounts (or an existing CLIENT
// being re-pointed) can be converted — an admin/manager account can
// never be turned into a client by mistake.
async function linkUser(req, res) {
  try {
    const orgId = req.user.organizationId;
    const client = await assertClientInOrg(req.body?.clientId, orgId);
    if (!client)
      return res
        .status(404)
        .json({ success: false, message: "Client not found." });

    const email = String(req.body?.email || "").trim();
    if (!email)
      return res
        .status(400)
        .json({ success: false, message: "Email is required." });

    const { data: users, error } = await supabase
      .from("user_master")
      .select('"Auth User Id", "Role", "Email"')
      .eq("organization_id", orgId)
      .ilike("Email", email.replace(/[\\%_]/g, "\\$&"));
    if (error) throw error;

    if (!users?.length)
      return res.status(404).json({
        success: false,
        message: "No user with this email. Create it in Add User first.",
      });
    if (users.length > 1)
      return res.status(409).json({
        success: false,
        message: "More than one account uses this email — cannot link safely.",
      });

    const u = users[0];
    const role = String(u.Role || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "_");
    if (role !== "TEAM_MEMBER" && role !== "CLIENT")
      return res.status(400).json({
        success: false,
        message: `This account is ${role || "an internal role"} — only a Team Member account can be converted to a client login.`,
      });

    const { error: upErr } = await supabase
      .from("user_master")
      .update({ Role: "CLIENT", client_id: client.id })
      .eq("Auth User Id", u["Auth User Id"])
      .eq("organization_id", orgId);
    if (upErr) throw upErr;

    res.json({
      success: true,
      message: `${u.Email} is now a client login for ${client.name}. It may take up to a minute to take effect.`,
    });
  } catch (err) {
    console.error("CLIENT PORTAL link-user error:", err);
    res.status(500).json({ success: false, message: "Could not link user." });
  }
}

// =====================================================================
// PAGE SHARING (Google-Docs style)
// =====================================================================
// Staff click "Share" on a page, pick a client + one of its contacts (or
// type another email) and a permission. That person then sees the page on
// their Client Dashboard — a read-only, client-scoped version of it, never
// the staff page itself. Only VIEW is available for now; EDIT is stored in
// the schema for later but refused here.
//
// To add another shareable page: add it to PAGE_KEYS, write a
// GET /shared/<page> handler that uses loadGrant() and scopes by the grant (not the
// caller), and register it in clientdashboard.tsx and sharedwithme.tsx.

const PAGE_KEYS = {
  "production-reports": { label: "Production Reports" },
};
const ISO_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const normRole = (r) =>
  String(r || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");

// The caller's own grant for a page, from ANY organization (a grant carries
// the organization and client it was made for). Null if there is none.
async function loadGrant(req, pageKey) {
  const shareId = String(req.query.shareId || "");
  let q = supabase
    .from("page_shares")
    .select("id, organization_id, client_id, permission")
    .eq("page_key", pageKey)
    .eq("grantee_user_id", req.user.userId);
  if (shareId) {
    if (!UUID_RE.test(shareId)) return null;
    q = q.eq("id", shareId);
  }
  const { data, error } = await q
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

// STAFF: GET /api/client-portal/page-shares?pageKey=production-reports
async function listPageShares(req, res) {
  try {
    const orgId = req.user.organizationId;
    const pageKey = String(req.query.pageKey || "");
    if (!PAGE_KEYS[pageKey])
      return res.status(400).json({ success: false, message: "Unknown page." });

    const { data: shares, error } = await supabase
      .from("page_shares")
      .select("grantee_user_id, permission, created_at")
      .eq("organization_id", orgId)
      .eq("page_key", pageKey)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const ids = (shares || []).map((s) => s.grantee_user_id);
    const userMap = {};
    if (ids.length) {
      const { data: users, error: uErr } = await supabase
        .from("user_master")
        .select('"Auth User Id", "First Name", "Last Name", "Email"')
        .in("Auth User Id", ids);
      if (uErr) throw uErr;
      (users || []).forEach((u) => (userMap[u["Auth User Id"]] = u));
    }

    res.json({
      success: true,
      data: (shares || []).map((s) => {
        const u = userMap[s.grantee_user_id] || {};
        return {
          userId: s.grantee_user_id,
          email: u["Email"] || null,
          name:
            `${u["First Name"] || ""} ${u["Last Name"] || ""}`.trim() || null,
          permission: s.permission,
          sharedAt: s.created_at,
        };
      }),
    });
  } catch (err) {
    console.error("CLIENT PORTAL list page-shares error:", err);
    res
      .status(500)
      .json({ success: false, message: "Could not load sharing." });
  }
}

// STAFF: POST /api/client-portal/page-shares
//   { pageKey, email, clientId, permission }
//
// Sharing is a GRANT: "this login may see this page for this client", stored
// in page_shares with the organization and client. It never edits an existing
// account — the email can belong to any role or organization and its
// user_master row is left exactly as it is.
//   - email already has a login (any org) -> grant only
//   - brand-new email (Super Admin / Ops Manager only) -> a CLIENT account is
//     created, linked to the client, and the "set your password" mail is sent
async function addPageShare(req, res) {
  try {
    const orgId = req.user.organizationId;
    const pageKey = String(req.body?.pageKey || "");
    if (!PAGE_KEYS[pageKey])
      return res.status(400).json({ success: false, message: "Unknown page." });

    const permission = String(req.body?.permission || "VIEW").toUpperCase();
    if (permission !== "VIEW")
      return res.status(400).json({
        success: false,
        message: "Only view access is available right now.",
      });

    const email = String(req.body?.email || "").trim();
    if (!EMAIL_RE.test(email))
      return res
        .status(400)
        .json({ success: false, message: "Enter a valid email address." });

    const client = await assertClientInOrg(req.body?.clientId, orgId);
    if (!client)
      return res.status(400).json({
        success: false,
        message: "Choose which client this person belongs to.",
      });

    // The email must be one of this client's saved contacts, or on the
    // client's own company domain.
    const rules = await getClientEmailRules(client.id, orgId);
    if (!emailAllowed(email, rules))
      return res.status(400).json({
        success: false,
        message: rules.domains.length
          ? `Use an email from ${client.name}'s domain (${rules.domains.map((d) => `@${d}`).join(", ")}) or pick one of their saved contacts.`
          : `No company email domain is on file for ${client.name}, so only its saved contacts can be used.`,
      });

    // Look the email up across ALL organizations.
    const { data: found, error } = await supabase
      .from("user_master")
      .select('"Auth User Id", "Email"')
      .ilike("Email", email.replace(/[\\%_]/g, "\\$&"));
    if (error) throw error;

    const authIds = [...new Set((found || []).map((u) => u["Auth User Id"]))];
    if (authIds.length > 1)
      return res.status(409).json({
        success: false,
        message: "More than one account uses this email — cannot share safely.",
      });

    let granteeId;
    let message;

    if (authIds.length === 1) {
      // ---- existing login (any org / role): grant only ----------------
      granteeId = authIds[0];
      message = `${PAGE_KEYS[pageKey].label} shared with ${found[0].Email} (view only). They will see it after they log in.`;
    } else {
      // ---- brand-new email: create the client login + send the invite ---
      if (!["SUPER_ADMIN", "OPS_MANAGER"].includes(req.user.role))
        return res.status(403).json({
          success: false,
          message:
            "This email has no account yet. Only a Global Admin or Ops Manager can invite a new person.",
        });

      const normalized = normalizeEmail(email);
      if (await emailExists(normalized))
        return res.status(409).json({
          success: false,
          message:
            "This email has a leftover login with no profile. Ask the developer to repair it.",
        });

      const local = normalized.split("@")[0];
      const created = await createUserAndGenerateResetLink({
        email: normalized,
        tempPassword: generateFallbackPassword(),
        organizationId: orgId,
        metadata: {
          fullName: local,
          firstName: local,
          lastName: "",
          role: "CLIENT",
        },
      });

      if (!created.userMasterInserted)
        return res.status(500).json({
          success: false,
          message: `Account was created but could not be saved (${created.userMasterError}). Ask the developer to check user_master.`,
        });

      const { error: linkErr } = await supabase
        .from("user_master")
        .update({ client_id: client.id })
        .eq("Auth User Id", created.user.id)
        .eq("organization_id", orgId);
      if (linkErr) throw linkErr;

      granteeId = created.user.id;
      message = created.resetEmailSent
        ? `Invite sent to ${normalized}. ${PAGE_KEYS[pageKey].label} is shared (view only) — they just need to set a password.`
        : `${PAGE_KEYS[pageKey].label} shared, but the invite email could not be sent. Send them this link manually: ${created.resetLink || "(link unavailable)"}`;
    }

    const { error: shErr } = await supabase.from("page_shares").upsert(
      {
        organization_id: orgId,
        page_key: pageKey,
        grantee_user_id: granteeId,
        client_id: client.id,
        permission: "VIEW",
        shared_by: req.user.userId,
        seen_at: null, // shows up as a new notification for the grantee
      },
      { onConflict: "organization_id,page_key,grantee_user_id" },
    );
    if (shErr) throw shErr;

    res.json({ success: true, message });
  } catch (err) {
    console.error("CLIENT PORTAL add page-share error:", err);
    res.status(500).json({ success: false, message: "Could not share page." });
  }
}

// STAFF: POST /api/client-portal/page-shares/remove   { pageKey, userId }
async function removePageShare(req, res) {
  try {
    const pageKey = String(req.body?.pageKey || "");
    const userId = String(req.body?.userId || "");
    if (!PAGE_KEYS[pageKey] || !ISO_UUID.test(userId))
      return res.status(400).json({ success: false, message: "Bad request." });

    const { error } = await supabase
      .from("page_shares")
      .delete()
      .eq("organization_id", req.user.organizationId)
      .eq("page_key", pageKey)
      .eq("grantee_user_id", userId);
    if (error) throw error;
    res.json({ success: true, message: "Access removed." });
  } catch (err) {
    console.error("CLIENT PORTAL remove page-share error:", err);
    res
      .status(500)
      .json({ success: false, message: "Could not remove access." });
  }
}

// ANY LOGIN: GET /api/client-portal/my-pages
// Every page that has been shared with the caller, from any organization.
async function listMyPages(req, res) {
  try {
    const { data, error } = await supabase
      .from("page_shares")
      .select("id, page_key, permission, organization_id, client_id, seen_at")
      .eq("grantee_user_id", req.user.userId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const rows = (data || []).filter((r) => PAGE_KEYS[r.page_key]);
    const clientIds = [
      ...new Set(rows.map((r) => r.client_id).filter(Boolean)),
    ];
    const nameByKey = {};
    for (const ids of chunk(clientIds, CHUNK)) {
      const { data: cs, error: cErr } = await supabase
        .from("clients")
        .select("id, name, organization_id")
        .in("id", ids);
      if (cErr) throw cErr;
      (cs || []).forEach(
        (c) => (nameByKey[`${c.organization_id}:${c.id}`] = c.name),
      );
    }

    res.json({
      success: true,
      data: rows.map((r) => ({
        shareId: r.id,
        pageKey: r.page_key,
        label: PAGE_KEYS[r.page_key].label,
        permission: r.permission,
        clientName: nameByKey[`${r.organization_id}:${r.client_id}`] || null,
        seen: Boolean(r.seen_at),
      })),
    });
  } catch (err) {
    console.error("CLIENT PORTAL my-pages error:", err);
    res.status(500).json({ success: false, message: "Could not load pages." });
  }
}

// ANY LOGIN: POST /api/client-portal/my-pages/seen
// Marks everything shared with the caller as seen (clears the "new" badge).
async function markMySharesSeen(req, res) {
  try {
    const { error } = await supabase
      .from("page_shares")
      .update({ seen_at: new Date().toISOString() })
      .eq("grantee_user_id", req.user.userId)
      .is("seen_at", null);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error("CLIENT PORTAL mark seen error:", err);
    res.status(500).json({ success: false, message: "Could not update." });
  }
}

// CLIENT: GET /api/client-portal/shared/production-reports?from=&to=
// Read-only Production Report scoped to the caller's OWN client. No employee
// names, times, QC/audit detail or other clients' data ever leave here.
async function getSharedProductionReport(req, res) {
  try {
    const grant = await loadGrant(req, "production-reports");
    if (!grant)
      return res.status(403).json({
        success: false,
        message: "This page has not been shared with you.",
      });

    // The grant decides which organization and client's data is shown —
    // never anything sent by the caller. (Shares made before client_id was
    // stored fall back to the caller's own linked client.)
    const orgId = grant.organization_id;
    const clientId = grant.client_id || (await getMyClientId(req));
    const client = clientId ? await assertClientInOrg(clientId, orgId) : null;
    if (!client)
      return res.status(403).json({
        success: false,
        message: "This share is not linked to a client.",
      });

    const today = todayInTz();
    const from = DATE_RE.test(String(req.query.from || ""))
      ? String(req.query.from)
      : `${today.slice(0, 8)}01`;
    const to = DATE_RE.test(String(req.query.to || ""))
      ? String(req.query.to)
      : today;

    const { data: rows, error } = await fetchAll(
      () =>
        supabase
          .from("service_cases")
          .select(CASE_COLS)
          .eq("organization_id", orgId)
          .eq("client_id", clientId)
          .gte("work_date", from)
          .lte("work_date", to)
          .order("work_date", { ascending: false })
          .order("id"),
      { maxRows: 5000 },
    );
    if (error) throw error;

    const { productMap, subMap } = await nameMaps(rows, orgId);
    const cases = rows.map((r) => ({
      id: r.id,
      caseNumber: r.case_number,
      service: productMap[r.product_id] || "—",
      subclient: subMap[r.subclient_id] || null,
      workDate: r.work_date,
      status: clientStatus(r),
    }));

    const bump = (map, key) => {
      const row = (map[key] ||= { total: 0, completed: 0 });
      return row;
    };
    const byService = {};
    const byDay = {};
    const byStatus = {};
    cases.forEach((c) => {
      const a = bump(byService, c.service);
      const d = bump(byDay, c.workDate);
      a.total++;
      d.total++;
      if (c.status === "Completed") {
        a.completed++;
        d.completed++;
      }
      byStatus[c.status] = (byStatus[c.status] || 0) + 1;
    });

    res.json({
      success: true,
      data: {
        client: { id: client.id, name: client.name },
        from,
        to,
        truncated: rows.length >= 5000,
        summary: { total: cases.length, byStatus },
        byService: Object.entries(byService)
          .map(([service, v]) => ({ service, ...v }))
          .sort((a, b) => b.total - a.total),
        byDay: Object.entries(byDay)
          .map(([date, v]) => ({ date, ...v }))
          .sort((a, b) => b.date.localeCompare(a.date)),
        cases,
      },
    });
  } catch (err) {
    console.error("CLIENT PORTAL shared production report error:", err);
    res
      .status(500)
      .json({ success: false, message: "Could not load the report." });
  }
}

module.exports = {
  getDashboard,
  listClientCases,
  getClientContacts,
  shareCases,
  unshareCases,
  linkUser,
  listPageShares,
  addPageShare,
  removePageShare,
  listMyPages,
  markMySharesSeen,
  getSharedProductionReport,
  clientStatus,
};
