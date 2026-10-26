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
  if (!team) return empty;

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
