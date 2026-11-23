// src/utils/teamScope.js
//
// Team scoping for Vertical Head and Team Member.
//
// These two roles must only see the services, clients and subclients that
// are linked to THEIR OWN team:
//   - service   : product/service_master `teams` array contains the user's team
//                 (user_master "Worked In Teams", compared case-insensitively)
//   - client    : mapped (client_products) to at least one of those services
//   - subclient : mapped (subclient_products) to one of those services, or - when
//                 the subclient has no service links at all - its client is visible
//
// Every other role gets `null` from getTeamScope() = no restriction.

const supabase = require("../config/supabaseClient");

const TEAM_SCOPED_ROLES = ["VERTICAL_HEAD", "TEAM_MEMBER"];

const norm = (v) =>
  String(v || "")
    .trim()
    .toLowerCase();

function isTeamScopedRole(role) {
  return TEAM_SCOPED_ROLES.includes(role);
}

async function getOwnTeam(req) {
  const { data: self } = await supabase
    .from("user_master")
    .select('"Worked In Teams"')
    .eq("Auth User Id", req.user.userId)
    .eq("organization_id", req.user.organizationId)
    .maybeSingle();
  return norm(self?.["Worked In Teams"]);
}

// null  -> caller is not team-scoped, show everything (unchanged behaviour)
// {productIds, clientIds, subclientIds} (Sets of strings) -> allowed ids only
async function getTeamScope(req) {
  if (!isTeamScopedRole(req.user.role)) return null;

  const orgId = req.user.organizationId;
  const empty = {
    productIds: new Set(),
    clientIds: new Set(),
    subclientIds: new Set(),
  };

  const team = await getOwnTeam(req);
  // NOTE: no early return when team is empty any more — the user can still
  // have assigned cases whose services must be selectable (see FIX below).

  const [prodRes, clientLinkRes, subLinkRes, subRes] = await Promise.all([
    supabase
      .from("service_master")
      .select("id, teams")
      .eq("organization_id", orgId),
    supabase
      .from("client_products")
      .select("client_id, product_id")
      .eq("organization_id", orgId),
    supabase
      .from("subclient_products")
      .select("subclient_id, product_id")
      .eq("organization_id", orgId),
    supabase
      .from("subclients")
      .select("id, client_id")
      .eq("organization_id", orgId),
  ]);
  [prodRes, clientLinkRes, subLinkRes, subRes].forEach((r) => {
    if (r.error) throw r.error;
  });

  const productIds = new Set(
    (prodRes.data || [])
      .filter((p) => (p.teams || []).some((t) => norm(t) === team))
      .map((p) => String(p.id)),
  );

  // FIX: a case can be ASSIGNED to an employee for a service that is not on
  // their own team (the manager decides who works on what). Without this the
  // employee's Client / Subclient dropdown on that case was empty, while the
  // admin saw the clients. Services of cases assigned to this user that still
  // miss a client / subclient are therefore allowed too.
  const { data: myCases, error: myCasesErr } = await supabase
    .from("service_cases")
    .select("product_id")
    .eq("organization_id", orgId)
    .eq("assigned_employee_id", req.user.userId)
    .or("client_id.is.null,subclient_id.is.null");
  if (myCasesErr) throw myCasesErr;
  (myCases || []).forEach((c) => {
    if (c.product_id != null) productIds.add(String(c.product_id));
  });

  const clientIds = new Set(
    (clientLinkRes.data || [])
      .filter((l) => productIds.has(String(l.product_id)))
      .map((l) => String(l.client_id)),
  );

  const linkedSubs = new Set(
    (subLinkRes.data || []).map((l) => String(l.subclient_id)),
  );
  const teamSubs = new Set(
    (subLinkRes.data || [])
      .filter((l) => productIds.has(String(l.product_id)))
      .map((l) => String(l.subclient_id)),
  );
  const subclientIds = new Set(teamSubs);
  (subRes.data || []).forEach((s) => {
    const id = String(s.id);
    // no service links at all -> follows its client
    if (!linkedSubs.has(id) && clientIds.has(String(s.client_id))) {
      subclientIds.add(id);
    }
  });

  return { productIds, clientIds, subclientIds };
}

module.exports = {
  TEAM_SCOPED_ROLES,
  isTeamScopedRole,
  getOwnTeam,
  getTeamScope,
};
