import { useState, useEffect } from "react";
import { fontSize, fontWeight, radius } from "../../styles/theme";
import { useNavigate } from "react-router-dom";
import { authFetch } from "../../utils/authFetch";
import { getCurrentUser } from "../../utils/auth";

// Public marketing/landing page — this is now what "/" shows before
// login, per the reference design. The "Existing User? Login Here"
// panel at the bottom is a REAL, working login form (calls the same
// /api/auth/login endpoint and role-redirect logic as pages/auth/login.tsx),
// not a mockup — so returning users never have to click through to a
// separate page first.

// NEW: colorful row data for the redesigned "What Alookate is" section.
const ABOUT_DEFS = [
    {
        icon: "ti-users-group",
        title: "Clients",
        desc: "Clients and their subclients, with contact details, country and status.",
        bg: "#EAF2FE",
        fg: "#2F6FED",
    },
    {
        icon: "ti-briefcase",
        title: "Services",
        desc: "Each type of work you deliver, with its billing unit and expected turnaround time.",
        bg: "#E8F8F0",
        fg: "#16A34A",
    },
    {
        icon: "ti-users",
        title: "People",
        desc: "Employees by department and team, with roles that decide what each person can see and do.",
        bg: "#F1ECFB",
        fg: "#8B5CF6",
    },
    {
        icon: "ti-file-check",
        title: "Cases",
        desc: "Every case number, from the moment it is logged to the moment it is checked, reported and billed.",
        bg: "#FFF1E0",
        fg: "#F59E0B",
    },
];

const FEATURES = [
    {
        icon: "ti-adjustments",
        title: "Optimize Resources",
        desc: "Allocate the right people to the right projects based on skills, availability, and workload.",
    },
    {
        icon: "ti-trending-up",
        title: "Increase Productivity",
        desc: "Reduce idle time and improve team productivity with intelligent allocation.",
    },
    {
        icon: "ti-shield-check",
        title: "Secure & Compliant",
        desc: "Enterprise-grade security to keep your data safe, always.",
    },
    {
        icon: "ti-plug",
        title: "Easy Integration",
        desc: "Connects with the tools your team already uses, so nothing feels new.",
    },
    // NEW — merged in from the "Trust" points, same card style as the rest
    {
        icon: "ti-lock-access",
        title: "Role-Based Access",
        desc: "Permissions are checked on the server for every request, not just hidden in the interface.",
    },
    {
        icon: "ti-checkbox",
        title: "Approval Gates",
        desc: "Changes that matter are routed for approval and recorded with who asked and who decided.",
    },
    {
        icon: "ti-database",
        title: "Separated Data",
        desc: "Each organisation's clients, staff and cases stay inside that organisation.",
    },
    {
        icon: "ti-world",
        title: "Runs in the Browser",
        desc: "Nothing to install on a desk machine. Open it on a laptop at head office or a tablet on the floor.",
    },
];

// NEW: "Where Alookate Delivers Results" — industries/applications strip,
// sits between the "What Alookate is" section and the "Why Choose" section.
const APPLICATIONS = [
    { icon: "ti-briefcase", label: "Professional Services" },
    { icon: "ti-bulb", label: "Consulting" },
    { icon: "ti-cpu", label: "IT & Technology" },
    { icon: "ti-settings", label: "Operations" },
    { icon: "ti-heartbeat", label: "Healthcare" },
    { icon: "ti-school", label: "Education" },
];

// NEW: "Why teams move off the spreadsheet" — old-way vs new-way comparison,
// sits right after the "Why Choose Workforce Allocation?" features section.
const OLD_WAY = [
    "One person owns the allocation sheet, so nothing moves when they are away.",
    "Attendance is confirmed over chat, after the work has already been split.",
    '"Who did this case?" takes three messages and a scroll through old files.',
    "Quality checks happen informally, and there is no record that they happened.",
    "Month-end billing is rebuilt from memory and mailed-around sheets.",
];

const NEW_WAY = [
    "Allocation is a screen anyone with the right role can open and run.",
    "Only employees marked present are counted, so no case lands on an empty chair.",
    "Every case carries its employee, allocator, status and timestamp with it.",
    "QC and audit run as queues, with marks and remarks stored against the case.",
    "Production reports and the billing register are built from the same records, not re-keyed.",
];

// NEW: "Everything the day needs" — 9-item feature grid, sits right after
// the "Why teams move off the spreadsheet" (Why it matters) section.
const EVERYTHING = [
    {
        icon: "ti-upload",
        title: "Bulk upload everywhere",
        desc: "Clients, subclients, services, employees and case numbers all come in from a sheet, with a sample file to match.",
    },
    {
        icon: "ti-table",
        title: "Excel export",
        desc: "Daily work, production reports and history leave the system as spreadsheets your finance team already knows how to read.",
    },
    {
        icon: "ti-shield-check",
        title: "Roles and permissions",
        desc: "Super admin, admin, manager or user — each role sees its own set of screens and actions, and nothing more.",
    },
    {
        icon: "ti-calendar-check",
        title: "Approvals",
        desc: "Sensitive changes wait for a decision instead of happening quietly. You see what was requested, by whom, and what came of it.",
    },
    {
        icon: "ti-clock",
        title: "Attendance-aware allocation",
        desc: "Present, absent, on leave or working external — allocation counts only the people who can actually take the work.",
    },
    {
        icon: "ti-chart-bar",
        title: "History you can search",
        desc: "Every allocation stays on record, filterable by employee, service, client, subclient, date and status.",
    },
    {
        icon: "ti-align-left",
        title: "Billing register",
        desc: "Billable work adds up per client from the same case records your team already filled in — nothing to reconcile by hand.",
    },
    {
        icon: "ti-sun",
        title: "Celebrations on the home screen",
        desc: "Holidays, birthdays, work anniversaries and new joiners greet the team before the work does.",
    },
    {
        icon: "ti-lock",
        title: "Secure sign-in",
        desc: "Organisation sign-up, password reset and protected sessions, with each organisation's data kept to itself.",
    },
];

// NEW: "How it works, in four moves" — numbered step-by-step section.
const STEPS = [
    {
        title: "Set up your organisation",
        desc: "Add clients and their subclients, define the services you deliver with their billing unit and turnaround time, and add employees with a department, team and role. Long lists go in through a sample sheet rather than one form at a time.",
        tags: ["Bulk upload", "Sample sheet", "Roles and permissions"],
    },
    {
        title: "Log the day's cases",
        desc: "Pick a service, client and subclient, then enter case numbers by hand, auto-generate a numbered range from a prefix, or upload the list you already received. The day's register builds itself as you go.",
        tags: ["Manual entry", "Auto generate", "Upload case numbers", "Export to Excel"],
    },
    {
        title: "Allocate in one click, or by hand",
        desc: "Smart Allocation spreads today's cases evenly across the employees marked present. Prefer to decide yourself? Change any row from the dropdown. Totals for cases, present employees, allocated and remaining stay live at the top of the screen.",
        tags: ["Smart Allocation", "Manual override", "Present-only", "Live totals"],
    },
    {
        title: "Check it, report it, bill it",
        desc: "Completed work lands in the QC and audit queues for marks and remarks. Production reports filter by service, date range, employee, status or client and export to Excel. The billing register reads from the same case records, so the month closes on numbers you can trace back to a case number.",
        tags: ["QC queue", "Audit queue", "Production reports", "Billing register"],
    },
];

// Country picker shown in the nav (replaces the old "Sign Up" button).
// Flags come from flagcdn.com as images, because flag emojis don't render
// on Windows. India is the default selection.
const COUNTRIES = [
    { code: "IN", name: "India" },
    { code: "US", name: "United States" },
    { code: "GB", name: "United Kingdom" },
    { code: "AE", name: "United Arab Emirates" },
    { code: "SG", name: "Singapore" },
    { code: "AU", name: "Australia" },
    { code: "CA", name: "Canada" },
    { code: "DE", name: "Germany" },
    { code: "SA", name: "Saudi Arabia" },
    { code: "NP", name: "Nepal" },
    { code: "BD", name: "Bangladesh" },
    { code: "LK", name: "Sri Lanka" },
];

const PLANS = [
    {
        name: "Free",
        price: "₹0",
        period: "/ user / month",
        desc: "Ideal for small teams just getting started.",
        features: ["Up to 5 Users", "Basic Allocation", "Project Tracking", "Standard Reports"],
        cta: "Get Started",
        highlighted: false,
    },
    {
        name: "Basic",
        price: "₹149",
        period: "/ user / month",
        desc: "Perfect for growing teams and small businesses.",
        features: ["Up to 25 Users", "Advanced Allocation", "Team Management", "Custom Reports"],
        cta: "Choose Plan",
        highlighted: false,
    },
    {
        name: "Professional",
        price: "₹199",
        period: "/ user / month",
        desc: "Advanced features for scaling teams and complex projects.",
        features: [
            "Up to 100 Users",
            "AI-powered Suggestions",
            "Advanced Reports",
            "Priority Support",
        ],
        cta: "Choose Plan",
        highlighted: true,
        badge: "Most Popular",
    },
    {
        name: "Enterprise",
        price: "Custom Pricing",
        period: "",
        desc: "Custom setup for large teams with their own needs.",
        features: ["Unlimited Users", "Custom Features", "Dedicated Support", "SLA & Onboarding"],
        cta: "Contact Sales",
        highlighted: false,
    },
];

// Fix (#4, social profiles linked): no social profiles exist for this
// product yet, so this array is intentionally empty — the `.filter()`
// below means the footer's social icon row won't render at all until a
// real URL is added, rather than linking to a dead/placeholder profile.
// When a profile exists, just fill in its url below.
const SOCIAL_LINKS = [
    { label: "LinkedIn", icon: "ti-brand-linkedin", url: "" },
    { label: "X (Twitter)", icon: "ti-brand-x", url: "" },
    { label: "Instagram", icon: "ti-brand-instagram", url: "" },
].filter((s) => s.url.trim().length > 0);

// NEW: "A look inside" — ported from the standalone marketing page's
// #screens section. Sample data only (organisation, people, clients and
// case numbers are made up for illustration, same as the source page).
// Rendered inside a modal (see lp-screens-modal) instead of a page
// section, opened from the "A look inside" nav link.
const SCREENS: { id: string; label: string }[] = [
    { id: "s-add", label: "Add User" },
    { id: "s-svc", label: "Services" },
    { id: "s-cli", label: "Clients Preview" },
    { id: "s-emp", label: "Employee Preview" },
    { id: "s-daily", label: "Daily Work" },
    { id: "s-alloc", label: "Allocate Daily Materialisation" },
    { id: "s-rep", label: "Production Reports" },
    { id: "s-prof", label: "Profile" },
    { id: "s-people", label: "Present Employees" },
    { id: "s-qc", label: "QC & Audit" },
];

const SCREEN_CAPTIONS: Record<string, { title: string; body: string }> = {
    "s-alloc": {
        title: "Allocate Daily Materialisation.",
        body: "Pick a date and service, then hand out cases yourself or let Smart Allocation do it. Total cases, present employees, allocated and remaining update as you work.",
    },
    "s-people": {
        title: "Present employees.",
        body: "Mark who is in before you allocate. Cases only go to people who are actually on the floor, including external members when you need them.",
    },
    "s-daily": {
        title: "Daily Work.",
        body: "Log cases manually, auto-generate a numbered range from a prefix, or upload the list. The register on the right is editable and exports straight to Excel.",
    },
    "s-qc": {
        title: "QC & Audit.",
        body: "Pick an employee, a service and the cases still pending check. Enter marks, leave a remark, mark it passed or failed — and the decision stays attached to the case.",
    },
    "s-rep": {
        title: "Production Reports.",
        body: "Case-level production across every service, filtered by date range, employee, status, submission or client, and exported to Excel in one click.",
    },
    "s-svc": {
        title: "Services.",
        body: "Every service you deliver, with its billing unit and expected turnaround time. Add them one by one or bring the whole catalogue in through a sample sheet.",
    },
    "s-cli": {
        title: "Clients.",
        body: "Clients and their subclients in one view, with website, email, phone and status. Bulk upload, edit and remove without leaving the screen.",
    },
    "s-emp": {
        title: "Employees.",
        body: "Browse the organisation by department and team, switch between card and list view, and search by name, team or department.",
    },
    "s-add": {
        title: "Add User.",
        body: "Create one person with their role, department and team — or upload an entire joining batch at once.",
    },
    "s-prof": {
        title: "Profile.",
        body: "What each person sees about themselves: their details, their role, and the work allocated to them today.",
    },
};

const renderScreenPanel = (id: string) => {
    switch (id) {
        case "s-alloc":
            return (
                <div className="sc-panel">
                    <div className="sc-filters">
                        <label>
                            Service
                            <select disabled>
                                <option>Report Validation</option>
                            </select>
                        </label>
                        <label>
                            Team
                            <select disabled>
                                <option>Client Services</option>
                            </select>
                        </label>
                        <label className="grow">
                            Search
                            <input
                                disabled
                                placeholder="Search by name, client, service or status…"
                            />
                        </label>
                    </div>
                    <div className="sc-kpis">
                        <div className="sc-kpi">
                            <b>6</b>
                            <span>Total cases</span>
                        </div>
                        <div className="sc-kpi">
                            <b>4</b>
                            <span>Present employees</span>
                        </div>
                        <div className="sc-kpi green">
                            <b>4</b>
                            <span>Allocated</span>
                        </div>
                        <div className="sc-kpi amber">
                            <b>2</b>
                            <span>Remaining</span>
                        </div>
                    </div>
                    <div className="sc-actions">
                        <button className="sc-btn primary" disabled>
                            ⚡ Smart Allocation
                        </button>
                        <button className="sc-btn" disabled>
                            Clear
                        </button>
                    </div>
                    <table className="sc-table">
                        <thead>
                            <tr>
                                <th>Case #</th>
                                <th>Client</th>
                                <th>Sub-client</th>
                                <th>Service</th>
                                <th>Date</th>
                                <th>Status</th>
                                <th>Allocate to</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>SLS-1042</td>
                                <td>Solstice Retail</td>
                                <td>Solstice East</td>
                                <td>Report Validation</td>
                                <td>2026-09-18</td>
                                <td>
                                    <span className="sc-pill green">Allocated</span>
                                </td>
                                <td>Kabir Sinha</td>
                            </tr>
                            <tr>
                                <td>SLS-1041</td>
                                <td>Solstice Retail</td>
                                <td>Solstice East</td>
                                <td>Report Validation</td>
                                <td>2026-09-18</td>
                                <td>
                                    <span className="sc-pill green">Allocated</span>
                                </td>
                                <td>Devika Rao</td>
                            </tr>
                            <tr>
                                <td>MBL-0207</td>
                                <td>Marblewood Logistics</td>
                                <td>Marblewood North</td>
                                <td>Report Validation</td>
                                <td>2026-09-18</td>
                                <td>
                                    <span className="sc-pill green">Allocated</span>
                                </td>
                                <td>Ira Kapoor</td>
                            </tr>
                            <tr>
                                <td>MBL-0206</td>
                                <td>Marblewood Logistics</td>
                                <td>Marblewood North</td>
                                <td>Report Validation</td>
                                <td>2026-09-18</td>
                                <td>
                                    <span className="sc-pill amber">Pending</span>
                                </td>
                                <td>—</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            );

        case "s-people":
            return (
                <div className="sc-panel">
                    <div className="sc-filters">
                        <label>
                            Team
                            <select disabled>
                                <option>All teams</option>
                            </select>
                        </label>
                        <label className="grow">
                            Search
                            <input disabled placeholder="Search by name or team…" />
                        </label>
                    </div>
                    <div className="sc-people">
                        {[
                            {
                                ini: "IK",
                                bg: "#204297",
                                name: "Ira Kapoor",
                                team: "Client Services",
                                status: "Present",
                            },
                            {
                                ini: "DR",
                                bg: "#08A1CE",
                                name: "Devika Rao",
                                team: "Client Services",
                                status: "Present",
                            },
                            {
                                ini: "KS",
                                bg: "#2EBBA8",
                                name: "Kabir Sinha",
                                team: "Operations",
                                status: "Present",
                            },
                            {
                                ini: "LF",
                                bg: "#7C5CD6",
                                name: "Leah Fernandes",
                                team: "Operations",
                                status: "On leave",
                            },
                            {
                                ini: "RM",
                                bg: "#C9922A",
                                name: "Rohan Mehta",
                                team: "External — Contract",
                                status: "Present",
                            },
                        ].map((p) => (
                            <div key={p.name} className="sc-person">
                                <span className="sc-ini" style={{ background: p.bg }}>
                                    {p.ini}
                                </span>
                                <div>
                                    <b>{p.name}</b>
                                    <small>{p.team}</small>
                                </div>
                                <span
                                    className={`sc-pill ${p.status === "Present" ? "green" : "grey"}`}
                                >
                                    {p.status}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            );

        case "s-daily":
            return (
                <div className="sc-panel">
                    <div className="sc-kpis">
                        <div className="sc-kpi">
                            <b>14</b>
                            <span>Services</span>
                        </div>
                        <div className="sc-kpi">
                            <b>4</b>
                            <span>Allocated</span>
                        </div>
                        <div className="sc-kpi green">
                            <b>2</b>
                            <span>Pending</span>
                        </div>
                        <div className="sc-kpi">
                            <b>5</b>
                            <span>Employees</span>
                        </div>
                    </div>
                    <div className="sc-split">
                        <div className="sc-form">
                            <div className="sc-tabbar">
                                <span className="on">Manual entry</span>
                                <span>Auto generate</span>
                                <span>Upload case numbers</span>
                            </div>
                            <label className="sc-f">
                                Date
                                <input disabled defaultValue="18-09-2026" />
                            </label>
                            <label className="sc-f">
                                Service
                                <select disabled>
                                    <option>Report Validation</option>
                                </select>
                            </label>
                            <label className="sc-f">
                                Client
                                <select disabled>
                                    <option>Solstice Retail</option>
                                </select>
                            </label>
                            <label className="sc-f">
                                Sub-client
                                <select disabled>
                                    <option>Solstice East</option>
                                </select>
                            </label>
                            <label className="sc-f">
                                Prefix
                                <input disabled defaultValue="SLS-10" />
                            </label>
                        </div>
                        <table className="sc-table">
                            <thead>
                                <tr>
                                    <th>Case No.</th>
                                    <th>Client</th>
                                    <th>Service</th>
                                    <th>Date</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td>SLS-1042</td>
                                    <td>Solstice Retail</td>
                                    <td>Report Validation</td>
                                    <td>18-09-2026</td>
                                </tr>
                                <tr>
                                    <td>SLS-1041</td>
                                    <td>Solstice Retail</td>
                                    <td>Report Validation</td>
                                    <td>18-09-2026</td>
                                </tr>
                                <tr>
                                    <td>MBL-0207</td>
                                    <td>Marblewood Logistics</td>
                                    <td>Report Validation</td>
                                    <td>18-09-2026</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            );

        case "s-qc":
            return (
                <div className="sc-panel">
                    <div className="sc-tabbar">
                        <span className="on">QC Queue</span>
                        <span>Audit Queue</span>
                    </div>
                    <div className="sc-filters">
                        <label>
                            Employee
                            <select disabled>
                                <option>Devika Rao</option>
                            </select>
                        </label>
                        <label>
                            Service
                            <select disabled>
                                <option>Report Validation</option>
                            </select>
                        </label>
                        <label>
                            Case number
                            <select disabled>
                                <option>SLS-1041</option>
                            </select>
                        </label>
                    </div>
                    <div className="sc-qccard">
                        <div className="sc-qctop">
                            <b>SLS-1041</b>
                            <span className="sc-pill amber">QC pending</span>
                        </div>
                        <div className="sc-qcrow">
                            <span>
                                Client
                                <br />
                                <b>Solstice Retail</b>
                            </span>
                            <span>
                                Service
                                <br />
                                <b>Report Validation</b>
                            </span>
                            <span>
                                Date
                                <br />
                                <b>2026-09-18</b>
                            </span>
                            <span>
                                Employee
                                <br />
                                <b>Devika Rao</b>
                            </span>
                            <span>
                                Marks
                                <br />
                                <b>—</b>
                            </span>
                        </div>
                        <div className="sc-qcremark">Looks clean, minor formatting check only.</div>
                        <div className="sc-actions">
                            <button className="sc-btn danger" disabled>
                                Fail
                            </button>
                            <button className="sc-btn primary" disabled>
                                Pass
                            </button>
                        </div>
                    </div>
                </div>
            );

        case "s-rep":
            return (
                <div className="sc-panel">
                    <div className="sc-filters">
                        <label>
                            Service
                            <select disabled>
                                <option>All services</option>
                            </select>
                        </label>
                        <label>
                            From
                            <input disabled defaultValue="01-09-2026" />
                        </label>
                        <label>
                            To
                            <input disabled defaultValue="18-09-2026" />
                        </label>
                        <label>
                            Employee
                            <select disabled>
                                <option>All employees</option>
                            </select>
                        </label>
                        <label>
                            Status
                            <select disabled>
                                <option>Allocated</option>
                            </select>
                        </label>
                    </div>
                    <table className="sc-table">
                        <thead>
                            <tr>
                                <th>Case #</th>
                                <th>Client</th>
                                <th>Service</th>
                                <th>Date</th>
                                <th>Employee</th>
                                <th>Allocated by</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>SLS-1042</td>
                                <td>Solstice Retail</td>
                                <td>Report Validation</td>
                                <td>2026-09-18</td>
                                <td>Kabir Sinha</td>
                                <td>Nimbus Teamspace</td>
                                <td>
                                    <span className="sc-pill green">Allocated</span>
                                </td>
                            </tr>
                            <tr>
                                <td>SLS-1041</td>
                                <td>Solstice Retail</td>
                                <td>Report Validation</td>
                                <td>2026-09-18</td>
                                <td>Devika Rao</td>
                                <td>Nimbus Teamspace</td>
                                <td>
                                    <span className="sc-pill green">Allocated</span>
                                </td>
                            </tr>
                            <tr>
                                <td>MBL-0207</td>
                                <td>Marblewood Logistics</td>
                                <td>Report Validation</td>
                                <td>2026-09-18</td>
                                <td>Ira Kapoor</td>
                                <td>Nimbus Teamspace</td>
                                <td>
                                    <span className="sc-pill green">Allocated</span>
                                </td>
                            </tr>
                            <tr>
                                <td>COB-0088</td>
                                <td>Cobalt Finance</td>
                                <td>Invoice Audit</td>
                                <td>2026-09-17</td>
                                <td>Leah Fernandes</td>
                                <td>Nimbus Teamspace</td>
                                <td>
                                    <span className="sc-pill grey">Submitted</span>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            );

        case "s-svc":
            return (
                <div className="sc-panel">
                    <div className="sc-cardgrid">
                        {[
                            {
                                dot: "#204297",
                                name: "Report Validation",
                                unit: "Per case",
                                time: "50 min turnaround",
                            },
                            {
                                dot: "#08A1CE",
                                name: "Invoice Audit",
                                unit: "Hourly",
                                time: "1 hr turnaround",
                            },
                            {
                                dot: "#2EBBA8",
                                name: "Customer Onboarding",
                                unit: "Per case",
                                time: "35 min turnaround",
                            },
                            {
                                dot: "#C9922A",
                                name: "Payment Reconciliation",
                                unit: "Hourly",
                                time: "2.5 hr turnaround",
                            },
                            {
                                dot: "#7C5CD6",
                                name: "Data Sync",
                                unit: "Per minute",
                                time: "20 min turnaround",
                            },
                            {
                                dot: "#C0392B",
                                name: "Report Generation",
                                unit: "Hourly",
                                time: "3 hr turnaround",
                            },
                        ].map((s) => (
                            <div key={s.name} className="sc-svc">
                                <span className="sc-dot" style={{ background: s.dot }} />
                                <b>{s.name}</b>
                                <span className="sc-pill blue">{s.unit}</span>
                                <small>{s.time}</small>
                            </div>
                        ))}
                    </div>
                </div>
            );

        case "s-cli":
            return (
                <div className="sc-panel">
                    <div className="sc-cardgrid">
                        {[
                            {
                                ini: "SR",
                                bg: "#204297",
                                name: "Solstice Retail",
                                tag: "2 subclients",
                                email: "hello@solsticeretail-demo.com",
                            },
                            {
                                ini: "ML",
                                bg: "#08A1CE",
                                name: "Marblewood Logistics",
                                tag: "1 subclient",
                                email: "ops@marblewood-demo.com",
                            },
                            {
                                ini: "CF",
                                bg: "#2EBBA8",
                                name: "Cobalt Finance",
                                tag: "3 subclients",
                                email: "contact@cobaltfinance-demo.com",
                            },
                            {
                                ini: "FM",
                                bg: "#C9922A",
                                name: "Ferngate Media",
                                tag: "1 subclient",
                                email: "hi@ferngatemedia-demo.com",
                            },
                        ].map((c) => (
                            <div key={c.name} className="sc-cli">
                                <span className="sc-ini" style={{ background: c.bg }}>
                                    {c.ini}
                                </span>
                                <b>{c.name}</b>
                                <span className="sc-pill blue">{c.tag}</span>
                                <small>{c.email}</small>
                            </div>
                        ))}
                    </div>
                </div>
            );

        case "s-emp":
            return (
                <div className="sc-panel">
                    <div className="sc-cardgrid">
                        {[
                            {
                                ini: "IK",
                                bg: "#204297",
                                name: "Ira Kapoor",
                                role: "Associate · Client Services",
                            },
                            {
                                ini: "DR",
                                bg: "#08A1CE",
                                name: "Devika Rao",
                                role: "Senior Associate · Client Services",
                            },
                            {
                                ini: "KS",
                                bg: "#2EBBA8",
                                name: "Kabir Sinha",
                                role: "Team Lead · Operations",
                            },
                            {
                                ini: "LF",
                                bg: "#7C5CD6",
                                name: "Leah Fernandes",
                                role: "Associate · Operations",
                            },
                        ].map((e) => (
                            <div key={e.name} className="sc-emp">
                                <span className="sc-ini" style={{ background: e.bg }}>
                                    {e.ini}
                                </span>
                                <b>{e.name}</b>
                                <small>{e.role}</small>
                            </div>
                        ))}
                    </div>
                </div>
            );

        case "s-prof":
            return (
                <div className="sc-panel">
                    <div className="sc-profile">
                        <span className="sc-ini big" style={{ background: "#204297" }}>
                            DR
                        </span>
                        <div>
                            <b>Devika Rao</b>
                            <small>Senior Associate · Client Services</small>
                            <span className="sc-pill blue">Role: User</span>
                        </div>
                    </div>
                    <table className="sc-table">
                        <thead>
                            <tr>
                                <th>Case #</th>
                                <th>Client</th>
                                <th>Service</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>SLS-1041</td>
                                <td>Solstice Retail</td>
                                <td>Report Validation</td>
                                <td>
                                    <span className="sc-pill green">Allocated</span>
                                </td>
                            </tr>
                            <tr>
                                <td>COB-0088</td>
                                <td>Cobalt Finance</td>
                                <td>Invoice Audit</td>
                                <td>
                                    <span className="sc-pill grey">Submitted</span>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            );

        case "s-add":
        default:
            return (
                <div className="sc-panel">
                    <div className="sc-form sc-form-wide">
                        <label className="sc-f">
                            Full name
                            <input disabled placeholder="e.g. Rohan Mehta" />
                        </label>
                        <label className="sc-f">
                            Email
                            <input disabled placeholder="name@company.com" />
                        </label>
                        <label className="sc-f">
                            Role
                            <select disabled>
                                <option>Associate</option>
                            </select>
                        </label>
                        <label className="sc-f">
                            Department
                            <select disabled>
                                <option>Operations</option>
                            </select>
                        </label>
                        <label className="sc-f">
                            Team
                            <select disabled>
                                <option>Client Services</option>
                            </select>
                        </label>
                        <div className="sc-actions">
                            <button className="sc-btn primary" disabled>
                                + Add user
                            </button>
                            <button className="sc-btn" disabled>
                                Bulk upload
                            </button>
                        </div>
                    </div>
                </div>
            );
    }
};

const Landing = () => {
    const navigate = useNavigate();
    const API_URL = import.meta.env.VITE_API_URL;

    const [menuOpen, setMenuOpen] = useState(false);

    // Country picker in the nav — India selected by default.
    const [country, setCountry] = useState("IN");
    const [countryOpen, setCountryOpen] = useState(false);

    // NEW: "Plans & Pricing" now opens as a modal from the nav instead of
    // living as a section on the page — the pricing grid itself (PLANS,
    // handlePlanSelect) is unchanged, it's just rendered inside an overlay.
    const [pricingOpen, setPricingOpen] = useState(false);

    // NEW: "A look inside" — same idea as pricing: opens as a modal from
    // the nav instead of living as a page section. activeScreen tracks
    // which sidebar item is selected inside the modal.
    const [screensOpen, setScreensOpen] = useState(false);
    const [activeScreen, setActiveScreen] = useState("s-add");

    // ---------- Razorpay checkout (Basic / Professional plans) ----------
    const [checkoutPlan, setCheckoutPlan] = useState<{
        key: string;
        name: string;
        price: string;
    } | null>(null);
    const [checkoutEmail, setCheckoutEmail] = useState("");
    const [checkoutLoading, setCheckoutLoading] = useState(false);
    const [checkoutError, setCheckoutError] = useState("");
    // Demo/dummy card fields — no real Razorpay keys are configured for
    // this project, so payment is a mock step (see /api/billing/mock-checkout).
    // Prefilled with a standard test-card number; nothing here is charged
    // or stored anywhere.
    const [cardNumber, setCardNumber] = useState("4242 4242 4242 4242");
    const [cardExpiry, setCardExpiry] = useState("12/29");
    const [cardCvv, setCardCvv] = useState("123");

    // NEW: "Upgrade" flow — for someone who's ALREADY logged in (this
    // landing page still opens for a logged-in visitor, e.g. via a
    // direct link to "/"), an existing organization can upgrade its OWN
    // plan right from this same modal instead of going through the
    // brand-new-organization signup path below. currentUser is only
    // read once on mount (a login/logout always does a full page nav in
    // this app, so it can't go stale mid-session).
    const [currentUser] = useState(() => getCurrentUser());
    const [upgradeMode, setUpgradeMode] = useState(false);
    const [upgradeSuccessMsg, setUpgradeSuccessMsg] = useState("");

    // ---------- "Sign up your organization" popup (org name + email only) ----------
    const [orgSignupOpen, setOrgSignupOpen] = useState(false);
    const [orgName, setOrgName] = useState("");
    const [orgEmail, setOrgEmail] = useState("");
    const [orgSignupLoading, setOrgSignupLoading] = useState(false);
    const [orgSignupError, setOrgSignupError] = useState("");
    const [orgSignupSuccess, setOrgSignupSuccess] = useState("");

    // NEW: "Book a demo" popup — replaces the old mailto link on the bottom
    // CTA section. Collects Name, Contact, Email and Organisation Name and
    // posts them as a lead instead of opening the visitor's mail client.
    const [demoOpen, setDemoOpen] = useState(false);
    const [demoName, setDemoName] = useState("");
    const [demoContact, setDemoContact] = useState("");
    const [demoEmail, setDemoEmail] = useState("");
    const [demoOrgName, setDemoOrgName] = useState("");
    const [demoLoading, setDemoLoading] = useState(false);
    const [demoError, setDemoError] = useState("");
    const [demoSuccess, setDemoSuccess] = useState("");

    // If this page was opened via the "Sign Up" nav button (new tab with
    // ?signup=1), auto-open the org signup modal on load.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get("signup") === "1") {
            setOrgSignupOpen(true);
        }
    }, []);

    const handleOrgSignup = async () => {
        setOrgSignupError("");
        if (!orgName.trim() || !orgEmail.trim()) {
            setOrgSignupError("Organization name and email are both required.");
            return;
        }
        setOrgSignupLoading(true);
        try {
            const res = await fetch(`${API_URL}/api/auth/register-organization`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    organizationName: orgName.trim(),
                    email: orgEmail.trim(),
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.message || "Something went wrong. Please try again.");
            }
            setOrgSignupSuccess(
                data.message ||
                    "Organization created. Check your email to set your password, then log in."
            );
        } catch (err: any) {
            setOrgSignupError(err.message || "Something went wrong. Please try again.");
        } finally {
            setOrgSignupLoading(false);
        }
    };

    const closeOrgSignup = () => {
        setOrgSignupOpen(false);
        setOrgName("");
        setOrgEmail("");
        setOrgSignupError("");
        setOrgSignupSuccess("");
    };

    // NEW: "Book a demo" popup handlers.
    const closeDemo = () => {
        setDemoOpen(false);
        setDemoName("");
        setDemoContact("");
        setDemoEmail("");
        setDemoOrgName("");
        setDemoError("");
        setDemoSuccess("");
    };

    const handleDemoSubmit = async () => {
        setDemoError("");
        if (!demoName.trim() || !demoContact.trim() || !demoOrgName.trim()) {
            setDemoError("Name, contact number and organisation name are all required.");
            return;
        }
        if (!demoEmail || !/\S+@\S+\.\S+/.test(demoEmail)) {
            setDemoError("Enter a valid email address.");
            return;
        }
        setDemoLoading(true);
        try {
            // TRACKING NOTE (for whoever wires up the backend route):
            // this hits a lead-capture endpoint rather than opening a mailto
            // link, so the request should (a) insert a row into a
            // `demo_requests` table for a record you own, (b) forward the
            // same payload to your CRM (HubSpot / Salesforce / Pipedrive —
            // whichever your marketing/sales team uses) via its lead API or
            // a webhook, and (c) ping sales on Slack/email so a fresh lead
            // doesn't sit unseen. `source` below tags where the lead came
            // from for attribution; extend with UTM params if you run paid
            // campaigns to this page.
            const res = await fetch(`${API_URL}/api/leads/demo-request`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: demoName.trim(),
                    contact: demoContact.trim(),
                    email: demoEmail.trim(),
                    organizationName: demoOrgName.trim(),
                    source: "landing_page_bottom_cta",
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.message || "Something went wrong. Please try again.");
            }
            setDemoSuccess(
                data.message || "Thanks! Our team will reach out to schedule your walkthrough."
            );
        } catch (err: any) {
            setDemoError(err.message || "Something went wrong. Please try again.");
        } finally {
            setDemoLoading(false);
        }
    };

    // Free -> straight to login/signup. Enterprise -> Contact Sales.
    // Basic / Professional -> open the email-collection modal, which
    // then kicks off Razorpay Checkout.
    const handlePlanSelect = (planName: string) => {
        if (planName === "Free") {
            navigate("/login");
            return;
        }
        if (planName === "Enterprise") {
            window.location.href =
                "mailto:contact@osoitech.com?subject=Enterprise%20Plan%20Inquiry";
            return;
        }
        const plan = PLANS.find((p) => p.name === planName);
        if (!plan) return;
        setCheckoutError("");
        setCheckoutEmail("");
        setUpgradeMode(false);
        setUpgradeSuccessMsg("");
        setCheckoutPlan({ key: planName.toLowerCase(), name: planName, price: plan.price });
    };

    // NEW: "Upgrade" (shown only when currentUser is set — see the modal
    // JSX below) — switches the SAME modal into upgrade mode: no email
    // needed (we already know who's asking, via the session cookie),
    // and on submit this hits the authenticated /api/billing/upgrade
    // endpoint instead of /api/billing/mock-checkout, which updates
    // THIS org's existing subscriptions row directly rather than
    // minting a new-organization signup token.
    const handleStartUpgrade = () => {
        setCheckoutError("");
        setUpgradeSuccessMsg("");
        setUpgradeMode(true);
    };

    const handleConfirmUpgrade = async () => {
        if (!checkoutPlan) return;
        if (!/^\d{4}\s?\d{4}\s?\d{4}\s?\d{4}$/.test(cardNumber.trim())) {
            setCheckoutError("Enter a valid 16-digit card number.");
            return;
        }
        setCheckoutError("");
        setCheckoutLoading(true);
        try {
            const res = await authFetch(`${API_URL}/api/billing/upgrade`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ plan: checkoutPlan.key, cardNumber }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.message || "Upgrade failed. Please try again.");
            }
            setUpgradeSuccessMsg(
                data.message || `Your plan has been upgraded to ${checkoutPlan.name}.`
            );
        } catch (err: any) {
            setCheckoutError(err.message || "Something went wrong.");
        } finally {
            setCheckoutLoading(false);
        }
    };

    // Demo/dummy payment — this project has no live Razorpay keys
    // configured, so instead of opening real Razorpay Checkout, we send
    // the (dummy) card details straight to /api/billing/mock-checkout,
    // which marks the signup as paid the same way verify-payment would
    // and hands back a signupToken. Swap this back to real create-order +
    // Razorpay Checkout + verify-payment (see billing.controller.js) to
    // go live.
    const handleConfirmCheckout = async () => {
        if (!checkoutPlan) return;
        if (!checkoutEmail || !/\S+@\S+\.\S+/.test(checkoutEmail)) {
            setCheckoutError("Enter a valid email address.");
            return;
        }
        if (!/^\d{4}\s?\d{4}\s?\d{4}\s?\d{4}$/.test(cardNumber.trim())) {
            setCheckoutError("Enter a valid 16-digit card number.");
            return;
        }
        setCheckoutError("");
        setCheckoutLoading(true);

        try {
            const res = await fetch(`${API_URL}/api/billing/mock-checkout`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    plan: checkoutPlan.key,
                    email: checkoutEmail,
                    cardNumber,
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.message || "Payment failed. Please try again.");
            }
            setCheckoutPlan(null);
            navigate(`/register?token=${data.data.signupToken}`);
        } catch (err: any) {
            setCheckoutError(err.message || "Something went wrong.");
        } finally {
            setCheckoutLoading(false);
        }
    };

    const scrollTo = (id: string) => {
        setMenuOpen(false);
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    };

    const renderCountryPicker = (variant: "desktop" | "mobile") => {
        const current = COUNTRIES.find((c) => c.code === country) ?? COUNTRIES[0];
        return (
            <div className={`lp-country lp-country-${variant}`}>
                <button
                    type="button"
                    className="lp-country-btn"
                    onClick={() => setCountryOpen((v) => !v)}
                    aria-haspopup="listbox"
                    aria-expanded={countryOpen}
                    aria-label={`Country: ${current.name}`}
                >
                    <img
                        src={`https://flagcdn.com/w40/${current.code.toLowerCase()}.png`}
                        alt=""
                        width={22}
                        height={16}
                    />
                    <span>{current.code}</span>
                    <i className={`ti ${countryOpen ? "ti-chevron-up" : "ti-chevron-down"}`} />
                </button>
                {countryOpen && (
                    <>
                        <div
                            className="lp-country-backdrop"
                            onClick={() => setCountryOpen(false)}
                        />
                        <div className="lp-country-menu" role="listbox">
                            {COUNTRIES.map((c) => (
                                <button
                                    key={c.code}
                                    type="button"
                                    role="option"
                                    aria-selected={c.code === country}
                                    className={`lp-country-item${c.code === country ? " active" : ""}`}
                                    onClick={() => {
                                        setCountry(c.code);
                                        setCountryOpen(false);
                                    }}
                                >
                                    <img
                                        src={`https://flagcdn.com/w40/${c.code.toLowerCase()}.png`}
                                        alt=""
                                        width={22}
                                        height={16}
                                    />
                                    <span className="lp-country-name">{c.name}</span>
                                    {c.code === country && <i className="ti ti-check" />}
                                </button>
                            ))}
                        </div>
                    </>
                )}
            </div>
        );
    };

    return (
        <div className="lp-page">
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap');

                .lp-page {
                    --lp-blue: #204297;
                    --lp-cyan: #08A1CE;
                    --lp-green: #2EBBA8;
                    --lp-gradient: linear-gradient(135deg, #204297 0%, #08A1CE 55%, #2EBBA8 100%);
                    --lp-ink: #0A1224;
                    --lp-ink-soft: #101B34;
                    --lp-text: #101828;
                    --lp-muted: #5B6B85;
                    --lp-bg: #F6F9FC;
                    --lp-border: #E3E9F3;
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                    /* FIX (#7, no text under 12px): explicit 16px base so
                       nothing on the page inherits a smaller default. */
                    font-size: 16px;
                    color: var(--lp-text);
                    background: #fff;
                }
                /* New: visible field labels for the login form (fix #2) */
                .lp-field { display: flex; flex-direction: column; gap: 6px; }
                .lp-field-label { font-size: 13px; font-weight: 600; color: #334155; }
                .lp-page h1, .lp-page h2, .lp-page h3 {
                    font-family: 'Sora', 'Inter', sans-serif;
                }
                .lp-topline {
                    height: 4px;
                    width: 100%;
                    background: var(--lp-gradient);
                    background-size: 200% 100%;
                    animation: lp-flow 6s linear infinite;
                }
                @keyframes lp-flow {
                    0% { background-position: 0% 0; }
                    100% { background-position: 200% 0; }
                }
                @keyframes lp-fade-up {
                    from { opacity: 0; transform: translateY(14px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @keyframes lp-float-particle {
                    0% { transform: translate(0, 0); }
                    50% { transform: translate(6px, -14px); }
                    100% { transform: translate(0, 0); }
                }
                @media (prefers-reduced-motion: reduce) {
                    .lp-hero-left, .lp-hero-right { animation: none !important; }
                    .lp-particle { animation: none !important; }
                }

                .lp-particle {
                    position: absolute;
                    border-radius: 50%;
                    pointer-events: none;
                    z-index: 0;
                    animation: lp-float-particle 7s ease-in-out infinite;
                }
                .lp-particle.p1 { width: 6px; height: 6px; background: var(--lp-cyan); opacity: 0.55; top: 14%; right: 30%; animation-duration: 6s; }
                .lp-particle.p2 { width: 4px; height: 4px; background: var(--lp-green); opacity: 0.5; bottom: 12%; right: 8%; animation-duration: 8s; animation-delay: 0.6s; }
                .lp-particle.p3 { width: 5px; height: 5px; background: #fff; opacity: 0.3; top: 20%; left: 4%; animation-duration: 9s; animation-delay: 1.2s; }
                .lp-particle.p4 { width: 4px; height: 4px; background: var(--lp-cyan); opacity: 0.4; bottom: 22%; left: 3%; animation-duration: 7s; animation-delay: 0.3s; }

                /* ---------- Nav ---------- */
                .lp-nav {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 16px clamp(20px, 5vw, 56px);
                    background: var(--lp-ink);
                    /* "position: fixed" instead of "sticky": sticky stops
                       working the moment ANY ancestor's overflow isn't
                       "visible" (it then sticks to that ancestor's box
                       instead of the real page scroll) — too easy to
                       re-break by accident elsewhere in a file this size.
                       "fixed" always pins to the viewport itself, so it
                       can't be broken that way. The trade-off: it's now
                       out of normal document flow, so the spacer right
                       after this nav (and the mobile menu panel below)
                       compensate for the space it used to take up. */
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    z-index: 30;
                }
                /* Sits directly after the fixed nav in the JSX and reserves
                   the same height the nav itself takes up, so page content
                   doesn't start out hidden underneath it. 76px covers both
                   the desktop row (16+16 padding + 38px logo) and the
                   mobile row (16+16 padding + 44px burger button). */
                .lp-nav-spacer {
                    height: 76px;
                }
                .lp-nav-brand {
                    display: flex;
                    align-items: center;
                    gap: 9px;
                    color: #fff;
                    font-family: 'Sora', sans-serif;
                    font-weight: 700;
                    font-size: 16px;
                    white-space: nowrap;
                }
                /* Same logo image + oval shape used in the app's own header
                   (components/header.tsx): white pill background, contain-
                   fit, fully-rounded ends. */
                .lp-nav-brand .lp-nav-logo {
                    width: 125px;
                    height: 38px;
                    object-fit: contain;
                    border-radius: 19px;
                    padding: 0 10px;
                    background-color: #fff;
                    flex-shrink: 0;
                }
                .lp-nav-links {
                    display: flex;
                    gap: 30px;
                }
                .lp-nav-links {
                    /* FIX (#1, tap targets + spacing): nav links now carry
                       real hit-area padding via .lp-nav-link, so the 30px
                       gap keeps 8px+ of dead space between them even with
                       the bigger boxes. */
                    gap: 22px;
                }
                .lp-nav-link {
                    display: inline-flex;
                    align-items: center;
                    /* FIX (#1): was plain text with no padding — the
                       clickable box was just the glyph height (~20px).
                       min-height + vertical padding brings the real hit
                       area up to 44px without changing how the link looks. */
                    min-height: 44px;
                    padding: 4px 6px;
                    box-sizing: border-box;
                    color: #B9C4DA;
                    text-decoration: none;
                    font-size: 14px;
                    font-weight: 500;
                    transition: color 0.15s ease;
                }
                .lp-nav-link:hover { color: #fff; }
                .lp-nav-login-btn {
                    background: var(--lp-gradient);
                    color: #fff;
                    border: none;
                    border-radius: 8px;
                    padding: 9px 22px;
                    /* FIX (#1): 9px padding + 14px text landed around 35px
                       tall — min-height with flex-centering guarantees 44px
                       regardless of font metrics. */
                    min-height: 44px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    box-sizing: border-box;
                    font-weight: 600;
                    cursor: pointer;
                    font-size: 14px;
                    font-family: inherit;
                    transition: filter 0.15s ease, transform 0.15s ease;
                    flex-shrink: 0;
                }
                .lp-nav-login-btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
                .lp-nav-signup-btn {
                    background: transparent;
                    color: #fff;
                    border: 1px solid #33415F;
                    border-radius: 8px;
                    padding: 9px 22px;
                    min-height: 44px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    box-sizing: border-box;
                    font-weight: 600;
                    cursor: pointer;
                    font-size: 14px;
                    font-family: inherit;
                    transition: border-color 0.15s ease, background 0.15s ease;
                    flex-shrink: 0;
                }
                .lp-nav-signup-btn:hover { border-color: #08A1CE; background: rgba(8,161,206,0.08); }
                .lp-burger {
                    display: none;
                    background: none;
                    border: 1px solid #26314F;
                    border-radius: 8px;
                    /* FIX (#1): 38x38 -> 44x44, the full recommended box. */
                    width: 44px;
                    height: 44px;
                    color: #fff;
                    font-size: 18px;
                    cursor: pointer;
                    align-items: center;
                    justify-content: center;
                }
                .lp-mobile-panel {
                    display: none;
                    flex-direction: column;
                    background: var(--lp-ink-soft);
                    padding: 14px clamp(20px, 5vw, 56px) 20px;
                    /* Nav is now "position: fixed" (out of document flow),
                       so this panel — its next sibling — no longer lands
                       visually right below it on its own. Pin it under the
                       nav explicitly instead. */
                    position: fixed;
                    top: 76px;
                    left: 0;
                    right: 0;
                    z-index: 29;
                    max-height: calc(100dvh - 76px);
                    overflow-y: auto;
                }
                .lp-mobile-panel a {
                    display: flex;
                    align-items: center;
                    /* FIX (#1): 12px top/bottom padding + ~18px text line
                       was ~42px; min-height locks it to 44px. */
                    min-height: 44px;
                    box-sizing: border-box;
                    color: #DCE4F2;
                    text-decoration: none;
                    padding: 12px 0;
                    font-size: 14.5px;
                    border-bottom: 1px solid rgba(255,255,255,0.08);
                }

                /* ---------- Hero ---------- */
                .lp-hero {
                    position: relative;
                    overflow: hidden;
                    display: flex;
                    gap: 48px;
                    align-items: center;
                    flex-wrap: wrap;
                    background: linear-gradient(160deg, var(--lp-ink) 0%, var(--lp-ink-soft) 55%, #142146 100%);
                    color: #fff;
                    padding: clamp(48px, 8vw, 84px) clamp(20px, 5vw, 56px);
                }
                .lp-hero-glow {
                    position: absolute;
                    border-radius: 50%;
                    filter: blur(80px);
                    pointer-events: none;
                    z-index: 0;
                }
                .lp-hero-glow.g1 { width: 440px; height: 440px; background: #08A1CE; opacity: 0.30; top: -160px; right: -100px; }
                .lp-hero-glow.g2 { width: 380px; height: 380px; background: #2EBBA8; opacity: 0.22; bottom: -160px; left: -120px; }
                .lp-hero-glow.g3 { width: 320px; height: 320px; background: #204297; opacity: 0.35; top: 35%; left: 38%; }
                .lp-hero-left {
                    flex: 1 1 420px;
                    min-width: 280px;
                    position: relative;
                    z-index: 1;
                    animation: lp-fade-up 0.7s ease both;
                    /* FIX: badge/heading/paragraph weren't guaranteed to share
                       the same left edge — this makes it explicit rather than
                       relying on each child's default block alignment. */
                    text-align: left;
                }
                .lp-hero-icon-badge {
                    width: 38px;
                    height: 38px;
                    border-radius: 11px;
                    background: rgba(255,255,255,0.06);
                    border: 1px solid rgba(255,255,255,0.14);
                    backdrop-filter: blur(6px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin-bottom: 16px;
                }
                .lp-hero-icon-badge i { font-size: 17px; color: var(--lp-cyan); }
                .lp-eyebrow {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 12.5px;
                    font-weight: 600;
                    letter-spacing: 0.04em;
                    color: #A9D9EA;
                    background: rgba(8,161,206,0.12);
                    border: 1px solid rgba(8,161,206,0.35);
                    padding: 6px 14px;
                    border-radius: 999px;
                    margin-bottom: 20px;
                }
                .lp-hero-title {
                    font-size: clamp(30px, 5.2vw, 46px);
                    font-weight: 800;
                    line-height: 1.14;
                    margin: 0 0 20px;
                    color: #fff;
                }
                .lp-hero-title span {
                    background: linear-gradient(90deg, #08A1CE, #2EBBA8);
                    -webkit-background-clip: text;
                    background-clip: text;
                    color: transparent;
                }
                .lp-hero-subtitle {
                    font-size: clamp(14.5px, 1.6vw, 16px);
                    color: #9FB0CC;
                    line-height: 1.65;
                    max-width: 480px;
                    margin: 0 0 28px;
                }
                .lp-hero-ctas { display: flex; gap: 14px; margin-bottom: 28px; flex-wrap: wrap; }
                .lp-btn-primary {
                    background: var(--lp-gradient);
                    color: #fff;
                    border: none;
                    border-radius: 9px;
                    padding: 13px 26px;
                    min-height: 44px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    box-sizing: border-box;
                    font-weight: 600;
                    cursor: pointer;
                    font-size: 15px;
                    font-family: inherit;
                    box-shadow: 0 10px 28px rgba(8,161,206,0.25);
                    transition: filter 0.15s ease, transform 0.15s ease;
                }
                .lp-btn-primary:hover { filter: brightness(1.1); transform: translateY(-1px); }
                .lp-btn-secondary {
                    background: transparent;
                    color: #fff;
                    border: 1px solid #33415F;
                    border-radius: 9px;
                    padding: 13px 26px;
                    min-height: 44px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    box-sizing: border-box;
                    font-weight: 600;
                    cursor: pointer;
                    font-size: 15px;
                    font-family: inherit;
                    transition: border-color 0.15s ease, background 0.15s ease;
                }
                .lp-btn-secondary:hover { border-color: #08A1CE; background: rgba(8,161,206,0.08); }
                .lp-hero-pills { display: flex; gap: 10px; flex-wrap: wrap; }
                .lp-hero-pill {
                    display: flex;
                    align-items: center;
                    gap: 7px;
                    font-size: 12.5px;
                    color: #CBD7ED;
                    background: rgba(255,255,255,0.06);
                    border: 1px solid rgba(255,255,255,0.13);
                    backdrop-filter: blur(4px);
                    padding: 8px 16px;
                    border-radius: 999px;
                }
                .lp-hero-pill i { color: var(--lp-cyan); font-size: 14.5px; }

                .lp-hero-right {
                    flex: 1 1 380px;
                    min-width: 260px;
                    display: flex;
                    justify-content: center;
                    z-index: 1;
                    animation: lp-fade-up 0.7s ease 0.1s both;
                }
                .lp-mock-wrap {
                    position: relative;
                    width: 100%;
                    max-width: 420px;
                }
                .lp-mock-card {
                    width: 100%;
                    background: #111C33;
                    border-radius: 18px;
                    border: 1px solid #22304F;
                    padding: 22px;
                    box-shadow: 0 24px 70px rgba(0,0,0,0.45);
                    position: relative;
                    z-index: 1;
                }
                .lp-mock-header { display: flex; align-items: center; gap: 8px; margin-bottom: 18px; }
                .lp-mock-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--lp-gradient); }
                .lp-mock-stats-row { display: flex; gap: 10px; margin-bottom: 20px; }
                .lp-mock-stat {
                    flex: 1;
                    background: #0D1526;
                    border-radius: 11px;
                    padding: 14px 8px;
                    text-align: center;
                    border: 1px solid #1B2740;
                }
                .lp-mock-stat-num {
                    font-size: 21px;
                    font-weight: 800;
                    font-family: 'Sora', sans-serif;
                    background: linear-gradient(90deg, #fff, #C7E4F0);
                    -webkit-background-clip: text;
                    background-clip: text;
                    color: transparent;
                }
                .lp-mock-stat-label { font-size: 12px; color: #7C8AA5; margin-top: 4px; }
                .lp-mock-bars { display: flex; align-items: flex-end; gap: 8px; height: 90px; }
                .lp-mock-bar { flex: 1; background: var(--lp-gradient); border-radius: 5px 5px 2px 2px; }

                .lp-float-card {
                    position: absolute;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    background: #fff;
                    color: var(--lp-text);
                    border-radius: 10px;
                    padding: 8px 12px;
                    font-size: 12px;
                    font-weight: 600;
                    box-shadow: 0 14px 30px rgba(0,0,0,0.3);
                    z-index: 2;
                    white-space: nowrap;
                }
                .lp-float-card i { font-size: 13px; }
                .lp-float-card.fc1 { top: -20px; right: -14px; transform: rotate(-6deg); }
                .lp-float-card.fc1 i { color: var(--lp-green); }
                .lp-float-card.fc2 { bottom: -18px; left: -14px; transform: rotate(4deg); }
                .lp-float-card .lp-avatar-dot {
                    width: 16px;
                    height: 16px;
                    border-radius: 50%;
                    background: var(--lp-gradient);
                    flex-shrink: 0;
                }

                /* ---------- Sections (redesigned) ---------- */
                .lp-section { padding: clamp(48px, 7vw, 88px) clamp(20px, 5vw, 56px); text-align: center; }
                .lp-section-title { font-size: clamp(26px, 4vw, 38px); font-weight: 800; margin: 0 0 12px; color: var(--lp-text); letter-spacing: -0.01em; }
                .lp-section-subtitle { color: var(--lp-muted); margin: 0 auto 44px; font-size: 16.5px; line-height: 1.65; max-width: 640px; }
                .lp-about-rail { width: 56px; height: 4px; border-radius: 999px; background: var(--lp-gradient); margin: 0 auto 20px; }
                .lp-about-tag { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--lp-blue); background: rgba(32,66,151,0.08); border: 1px solid rgba(32,66,151,0.18); padding: 6px 14px; border-radius: 999px; }
                .lp2-wrap { max-width: 1120px; margin: 0 auto; position: relative; }

                /* Stats band overlapping the hero */
                .lp2-stats-sec { position: relative; z-index: 3; padding: 0 clamp(20px, 5vw, 56px); margin-top: -44px; background: linear-gradient(180deg, transparent 44px, #fff 44px); }
                .lp2-stats { max-width: 1120px; margin: 0 auto; display: grid; grid-template-columns: repeat(4, 1fr); background: #fff; border-radius: 22px; box-shadow: 0 30px 60px -20px rgba(10,18,36,0.35), 0 0 0 1px var(--lp-border); overflow: hidden; }
                .lp2-stat { padding: 26px 24px; text-align: left; border-left: 1px solid var(--lp-border); }
                .lp2-stat:first-child { border-left: none; }
                .lp2-stat-num { white-space: nowrap; font-family: 'Sora', sans-serif; font-weight: 800; font-size: clamp(26px, 3.2vw, 34px); line-height: 1.1; background: var(--lp-gradient); -webkit-background-clip: text; background-clip: text; color: transparent; }
                .lp2-stat-label { margin-top: 6px; font-size: 14px; color: var(--lp-muted); line-height: 1.45; }
                @media (max-width: 480px) { .lp2-stat { padding: 20px 16px; } .lp2-stat-num { font-size: 22px; } }
                @media (max-width: 820px) { .lp2-stats { grid-template-columns: repeat(2, 1fr); } .lp2-stat:nth-child(3) { border-left: none; } .lp2-stat:nth-child(n+3) { border-top: 1px solid var(--lp-border); } }

                /* What is + industries marquee */
                .lp-apps-section { background: #fff; padding-bottom: clamp(40px, 6vw, 72px); }
                .lp2-about { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(28px, 5vw, 64px); align-items: center; text-align: left; margin-bottom: 64px; }
                .lp2-about h2 { text-align: left; margin-top: 14px; }
                .lp2-about p { color: var(--lp-muted); font-size: 16.5px; line-height: 1.75; margin: 0; }
                .lp2-about-tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
                .lp2-about-tile { border-radius: 18px; padding: 20px; text-align: left; }
                .lp2-about-tile i { font-size: 24px; display: block; margin-bottom: 12px; }
                .lp2-about-tile b { display: block; font-family: 'Sora', sans-serif; font-size: 16px; color: var(--lp-text); margin-bottom: 4px; }
                .lp2-about-tile span { font-size: 13.5px; color: #4B5B75; line-height: 1.5; display: block; }
                @media (max-width: 860px) { .lp2-about { grid-template-columns: 1fr; } }
                .lp2-marquee { overflow: hidden; margin-top: 8px; -webkit-mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent); mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent); }
                .lp2-marquee-track { display: flex; gap: 14px; width: max-content; animation: lp2-scroll 32s linear infinite; }
                .lp2-marquee:hover .lp2-marquee-track { animation-play-state: paused; }
                @keyframes lp2-scroll { to { transform: translateX(-50%); } }
                @media (prefers-reduced-motion: reduce) { .lp2-marquee-track { animation: none; flex-wrap: wrap; width: auto; justify-content: center; } }
                .lp2-pill { display: inline-flex; align-items: center; gap: 12px; padding: 12px 22px 12px 12px; border-radius: 999px; background: var(--lp-bg); border: 1px solid var(--lp-border); font-family: 'Sora', sans-serif; font-weight: 600; font-size: 15px; color: var(--lp-text); white-space: nowrap; }
                .lp2-pill i { width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--lp-gradient); color: #fff; font-size: 18px; }

                /* Why choose: bento */
                #features { background: var(--lp-bg); }
                .lp2-bento { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; text-align: left; }
                .lp2-bento-card { grid-column: span 1; background: #fff; border: 1px solid var(--lp-border); border-radius: 22px; padding: 28px; position: relative; overflow: hidden; transition: box-shadow .2s ease, border-color .2s ease; }
                .lp2-bento-card:hover { box-shadow: 0 20px 44px rgba(32,66,151,0.13); border-color: #C9DCF7; }
                .lp2-bento-card.wide { grid-column: span 2; }
                .lp2-bento-card.dark { background: linear-gradient(150deg, var(--lp-ink) 0%, #16265A 100%); border-color: transparent; color: #B9C9E0; }
                .lp2-bento-card.dark::after { content: ""; position: absolute; width: 260px; height: 260px; right: -80px; bottom: -100px; border-radius: 50%; background: var(--lp-cyan); opacity: .28; filter: blur(60px); }
                .lp2-bento-card.tint { background: linear-gradient(150deg, #EAF6FB 0%, #E6F7F3 100%); border-color: #CFE9EF; }
                .lp2-bento-icon { width: 48px; height: 48px; border-radius: 14px; background: var(--lp-gradient); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 22px; margin-bottom: 18px; position: relative; z-index: 1; }
                .lp2-bento-card h3 { font-size: 18px; margin: 0 0 8px; color: var(--lp-text); position: relative; z-index: 1; }
                .lp2-bento-card.dark h3 { color: #fff; font-size: 22px; }
                .lp2-bento-card p { margin: 0; font-size: 15px; line-height: 1.65; color: var(--lp-muted); position: relative; z-index: 1; }
                .lp2-bento-card.dark p { color: #B9C9E0; }
                @media (max-width: 900px) { .lp2-bento { grid-template-columns: repeat(2, 1fr); } }
                @media (max-width: 560px) { .lp2-bento { grid-template-columns: 1fr; } .lp2-bento-card.wide { grid-column: span 1; } }

                /* Old way vs new way */
                .lp2-vs { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; position: relative; text-align: left; }
                .lp2-vs-card { border-radius: 24px; padding: clamp(26px, 4vw, 38px); }
                .lp2-vs-card.old { background: #FBF3F3; border: 1px solid #F3D9D9; }
                .lp2-vs-card.new { background: linear-gradient(150deg, var(--lp-ink) 0%, #16265A 100%); color: #fff; box-shadow: 0 30px 60px -24px rgba(10,18,36,0.6); position: relative; overflow: hidden; }
                .lp2-vs-card.new::after { content: ""; position: absolute; width: 300px; height: 300px; top: -120px; right: -100px; border-radius: 50%; background: var(--lp-green); opacity: .25; filter: blur(70px); }
                .lp2-vs-card h3 { font-size: 21px; margin: 0 0 4px; color: var(--lp-text); }
                .lp2-vs-card.new h3 { color: #fff; }
                .lp2-vs-sub { font-size: 14px; color: var(--lp-muted); margin: 0 0 22px; }
                .lp2-vs-card.new .lp2-vs-sub { color: #9FB4D6; }
                .lp2-vs-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 16px; position: relative; z-index: 1; }
                .lp2-vs-list li { display: grid; grid-template-columns: 26px 1fr; gap: 12px; font-size: 15px; line-height: 1.6; color: #4B5B75; }
                .lp2-vs-card.new .lp2-vs-list li { color: #E3ECFA; }
                .lp2-vs-mark { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; margin-top: 1px; }
                .lp2-vs-mark.bad { background: #FBDADA; color: #C0392B; }
                .lp2-vs-mark.good { background: var(--lp-green); color: #06281F; }
                .lp2-vs-badge { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 52px; height: 52px; border-radius: 50%; background: #fff; box-shadow: 0 8px 24px rgba(10,18,36,0.25); display: flex; align-items: center; justify-content: center; font-family: 'Sora', sans-serif; font-weight: 800; font-size: 14px; color: var(--lp-blue); z-index: 2; }
                @media (max-width: 780px) { .lp2-vs { grid-template-columns: 1fr; } .lp2-vs-badge { display: none; } }

                /* Everything the day needs */
                .lp-everything-section { background: var(--lp-bg); }
                .lp2-grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; text-align: left; }
                .lp2-card { background: #fff; border: 1px solid var(--lp-border); border-radius: 20px; padding: 26px; transition: transform .2s ease, box-shadow .2s ease; }
                .lp2-card:hover { transform: translateY(-3px); box-shadow: 0 18px 40px rgba(32,66,151,0.12); }
                .lp2-card-icon { width: 46px; height: 46px; border-radius: 14px; display: flex; align-items: center; justify-content: center; font-size: 21px; margin-bottom: 16px; }
                .lp2-card:nth-child(4n+1) .lp2-card-icon { background: #EAF2FE; color: #2F6FED; }
                .lp2-card:nth-child(4n+2) .lp2-card-icon { background: #E8F8F0; color: #16A34A; }
                .lp2-card:nth-child(4n+3) .lp2-card-icon { background: #F1ECFB; color: #8B5CF6; }
                .lp2-card:nth-child(4n) .lp2-card-icon { background: #FFF1E0; color: #D97706; }
                .lp2-card h3 { font-size: 17px; margin: 0 0 8px; color: var(--lp-text); }
                .lp2-card p { margin: 0; font-size: 15px; line-height: 1.65; color: var(--lp-muted); }
                @media (max-width: 900px) { .lp2-grid3 { grid-template-columns: repeat(2, 1fr); } }
                @media (max-width: 560px) { .lp2-grid3 { grid-template-columns: 1fr; } }

                /* How it works */
                .lp-how-section { background: #fff; }
                .lp2-steps { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; text-align: left; }
                .lp2-step { border: 1px solid var(--lp-border); border-radius: 22px; padding: 28px; background: linear-gradient(180deg, #fff, var(--lp-bg)); }
                .lp2-step-num { width: 44px; height: 44px; border-radius: 50%; background: var(--lp-gradient); color: #fff; font-family: 'Sora', sans-serif; font-weight: 800; font-size: 18px; display: flex; align-items: center; justify-content: center; margin-bottom: 16px; box-shadow: 0 8px 18px rgba(32,66,151,0.28); }
                .lp2-step h3 { font-size: 19px; margin: 0 0 10px; color: var(--lp-text); }
                .lp2-step p { font-size: 15px; line-height: 1.7; color: var(--lp-muted); margin: 0 0 16px; }
                .lp2-tags { display: flex; flex-wrap: wrap; gap: 8px; }
                .lp2-tag { font-size: 12.5px; font-weight: 600; color: var(--lp-blue); background: rgba(32,66,151,0.08); border: 1px solid rgba(32,66,151,0.16); padding: 5px 12px; border-radius: 999px; }
                @media (max-width: 780px) { .lp2-steps { grid-template-columns: 1fr; } }

                /* Pricing teaser */
                .lp2-price-sec { background: var(--lp-bg); }
                .lp2-price-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px; text-align: left; }
                .lp2-price-chip { background: #fff; border: 1px solid var(--lp-border); border-radius: 20px; padding: 22px; position: relative; }
                .lp2-price-chip.hot { background: var(--lp-gradient); color: #fff; border-color: transparent; box-shadow: 0 24px 44px -16px rgba(32,66,151,0.6); }
                .lp2-price-chip small { display: block; font-size: 13.5px; font-weight: 600; color: var(--lp-muted); margin-bottom: 8px; }
                .lp2-price-chip.hot small { color: rgba(255,255,255,0.85); }
                .lp2-price-chip b { font-family: 'Sora', sans-serif; font-size: 26px; font-weight: 800; color: var(--lp-text); display: block; line-height: 1.15; }
                .lp2-price-chip.hot b { color: #fff; }
                .lp2-price-chip span { display: block; margin-top: 8px; font-size: 13.5px; line-height: 1.5; color: var(--lp-muted); }
                .lp2-price-chip.hot span { color: rgba(255,255,255,0.88); }
                .lp2-badge { position: absolute; top: -11px; right: 16px; background: #FFB547; color: #3A2500; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 999px; }
                @media (max-width: 900px) { .lp2-price-row { grid-template-columns: repeat(2, 1fr); } }
                @media (max-width: 480px) { .lp2-price-row { grid-template-columns: 1fr; } }

                /* Bottom CTA */
                .lp-cta-section { background: #fff; padding-top: clamp(32px, 5vw, 64px); }
                .lp2-cta { position: relative; overflow: hidden; border-radius: 32px; padding: clamp(36px, 6vw, 72px); text-align: left; color: #B9C9E0; background: linear-gradient(150deg, var(--lp-ink) 0%, #16265A 60%, #0E4A66 100%); display: grid; grid-template-columns: 1.3fr 1fr; gap: 40px; align-items: center; }
                .lp-cta-title { font-size: clamp(28px, 4.2vw, 42px); font-weight: 800; color: #fff; margin: 0 0 16px; line-height: 1.15; }
                .lp-cta-desc { font-size: 16.5px; line-height: 1.7; color: #B9C9E0; margin: 0 0 28px; max-width: 34em; }
                .lp-cta-actions { display: flex; gap: 14px; flex-wrap: wrap; }
                .lp-cta-btn-primary, .lp-cta-btn-secondary { min-height: 48px; padding: 13px 28px; border-radius: 12px; font-weight: 700; font-size: 15.5px; font-family: inherit; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; box-sizing: border-box; transition: transform .15s ease, background .15s ease; }
                .lp-cta-btn-primary { background: linear-gradient(135deg, #FFB547, #FF8A3D); color: #2A1500; border: none; box-shadow: 0 14px 28px rgba(255,138,61,0.35); }
                .lp-cta-btn-secondary { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,0.4); }
                .lp-cta-btn-primary:hover, .lp-cta-btn-secondary:hover { transform: translateY(-2px); }
                .lp-cta-btn-secondary:hover { background: rgba(255,255,255,0.09); }
                .lp2-cta-list { list-style: none; margin: 0; padding: 22px; border-radius: 20px; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.14); display: flex; flex-direction: column; gap: 14px; position: relative; z-index: 1; }
                .lp2-cta-list li { display: flex; gap: 12px; align-items: flex-start; font-size: 15px; color: #E3ECFA; line-height: 1.5; }
                .lp2-cta-list i { color: var(--lp-green); font-size: 20px; }
                .lp2-cta-left { position: relative; z-index: 1; }
                @media (max-width: 860px) { .lp2-cta { grid-template-columns: 1fr; } }

                /* ---------- Testimonial (social proof) ---------- */
                .lp-testimonial-card {
                    max-width: 640px;
                    margin: 0 auto;
                    background: #fff;
                    border: 1px solid var(--lp-border);
                    border-left: 4px solid var(--lp-cyan);
                    border-radius: 16px;
                    padding: clamp(28px, 5vw, 40px);
                    text-align: left;
                    box-shadow: 0 18px 42px rgba(32,66,151,0.1);
                    position: relative;
                    overflow: hidden;
                }
                .lp-testimonial-mark {
                    font-family: 'Sora', sans-serif;
                    font-size: 90px;
                    font-weight: 800;
                    line-height: 1;
                    position: absolute;
                    top: -10px;
                    right: 22px;
                    background: linear-gradient(135deg, rgba(32,66,151,0.1), rgba(8,161,206,0.1));
                    -webkit-background-clip: text;
                    background-clip: text;
                    color: transparent;
                    pointer-events: none;
                    user-select: none;
                }
                .lp-testimonial-quote {
                    font-size: 18px;
                    line-height: 1.65;
                    color: var(--lp-text);
                    margin: 0 0 22px;
                    position: relative;
                }
                .lp-testimonial-person { display: flex; align-items: center; gap: 12px; }
                .lp-testimonial-avatar {
                    width: 46px;
                    height: 46px;
                    border-radius: 50%;
                    background: var(--lp-gradient);
                    color: #fff;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: 700;
                    font-size: 15px;
                    flex-shrink: 0;
                }
                .lp-testimonial-name { font-weight: 700; font-size: 14.5px; }
                .lp-testimonial-role { font-size: 13px; color: var(--lp-muted); }
                .lp-testimonial-stat {
                    margin-left: auto;
                    text-align: right;
                    padding-left: 12px;
                }
                .lp-testimonial-stat-num {
                    font-size: 22px;
                    font-weight: 800;
                    color: var(--lp-blue);
                    font-family: 'Sora', sans-serif;
                    line-height: 1;
                }
                .lp-testimonial-stat-label { font-size: 12px; color: var(--lp-muted); margin-top: 2px; }

                /* ---------- Pricing ---------- */
                .lp-pricing-section { background: var(--lp-bg); }
                .lp-pricing-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(235px, 1fr));
                    gap: 20px;
                    max-width: 1150px;
                    margin: 0 auto;
                    text-align: left;
                }
                .lp-price-card {
                    background: #fff;
                    border: 1px solid var(--lp-border);
                    border-radius: 16px;
                    padding: 26px;
                    display: flex;
                    flex-direction: column;
                    position: relative;
                    transition: box-shadow 0.2s ease, transform 0.2s ease;
                }
                .lp-price-card:hover {
                    transform: translateY(-4px);
                    box-shadow: 0 16px 34px rgba(32,66,151,0.12);
                }
                .lp-price-card.lp-highlighted {
                    border: 2px solid var(--lp-blue);
                    box-shadow: 0 20px 48px rgba(32,66,151,0.22);
                    transform: scale(1.03);
                }
                .lp-price-card.lp-highlighted:hover { transform: scale(1.03) translateY(-4px); }
                .lp-price-badge {
                    position: absolute;
                    top: -13px;
                    left: 22px;
                    background: var(--lp-gradient);
                    color: #fff;
                    font-size: 12px;
                    font-weight: 700;
                    padding: 5px 12px;
                    border-radius: 999px;
                }
                .lp-price-name { font-weight: 700; font-size: 16px; margin-bottom: 8px; font-family: 'Sora', sans-serif; }
                .lp-price-value { font-size: 30px; font-weight: 800; margin-bottom: 4px; font-family: 'Sora', sans-serif; color: var(--lp-text); }
                .lp-price-period { font-size: 13px; font-weight: 400; color: var(--lp-muted); }
                .lp-price-desc { font-size: 13px; color: var(--lp-muted); margin-bottom: 18px; min-height: 36px; }
                .lp-price-features { list-style: none; padding: 0; margin: 0 0 22px; font-size: 13.5px; display: flex; flex-direction: column; gap: 9px; }
                .lp-price-features li { display: flex; align-items: center; gap: 8px; }
                .lp-price-features i { color: var(--lp-green); font-size: 15px; flex-shrink: 0; }
                .lp-price-btn {
                    border: none;
                    border-radius: 9px;
                    padding: 11px 0;
                    min-height: 44px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-sizing: border-box;
                    font-weight: 600;
                    cursor: pointer;
                    margin-top: auto;
                    font-family: inherit;
                    font-size: 14px;
                    transition: filter 0.15s ease, transform 0.15s ease;
                }
                .lp-price-btn.primary { background: var(--lp-gradient); color: #fff; }
                .lp-price-btn.secondary { background: #fff; color: var(--lp-text); border: 1px solid #CBD5E1; }
                .lp-price-btn:hover { filter: brightness(1.06); transform: translateY(-1px); }

                /* ---------- Footer (redesigned) ---------- */
                .lp-footer { text-align: left; background: var(--lp-ink); color: #8FA3C4; padding: 56px clamp(20px, 5vw, 56px) 0; font-size: 14px; }
                .lp2-foot { max-width: 1120px; margin: 0 auto; display: grid; grid-template-columns: 1.6fr 1fr 1fr; gap: 40px; padding-bottom: 40px; }
                .lp2-foot img { height: 40px; border-radius: 8px; margin-bottom: 14px; }
                .lp2-foot p { margin: 0; line-height: 1.7; max-width: 26em; }
                .lp2-foot h4 { color: #fff; font-family: 'Sora', sans-serif; font-size: 15px; margin: 0 0 14px; }
                .lp2-foot button, .lp-footer a { background: none; border: none; padding: 0; font: inherit; color: #8FA3C4; text-decoration: none; cursor: pointer; display: flex; align-items: center; min-height: 36px; text-align: left; }
                .lp2-foot button:hover, .lp-footer a:hover { color: #fff; }
                .lp2-foot-bar { max-width: 1120px; margin: 0 auto; border-top: 1px solid #1E2A47; padding: 14px 0; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 20px; font-size: 13px; }
                .lp-footer-links { display: flex; gap: 20px; flex-wrap: wrap; }
                .lp-footer-social { display: flex; gap: 8px; }
                .lp-footer-social a { width: 44px; height: 44px; min-height: 44px; border-radius: 10px; border: 1px solid #26314F; justify-content: center; font-size: 16px; }
                .lp-footer-social a:hover { border-color: #08A1CE; }
                @media (max-width: 720px) { .lp2-foot { grid-template-columns: 1fr 1fr; } .lp2-foot > div:first-child { grid-column: 1 / -1; } }

                /* ---------- Checkout modal ---------- */
                .lp-checkout-overlay {
                    position: fixed;
                    inset: 0;
                    background: rgba(10, 18, 36, 0.6);
                    backdrop-filter: blur(3px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 100;
                    padding: 20px;
                }
                .lp-checkout-modal {
                    position: relative;
                    width: 100%;
                    max-width: 400px;
                    background: #fff;
                    border-radius: 18px;
                    padding: 28px;
                    box-shadow: 0 24px 60px rgba(0,0,0,0.35);
                }
                .lp-checkout-close {
                    position: absolute;
                    top: 8px;
                    right: 8px;
                    /* FIX (#1, tap targets round 2): 30x30 -> 44x44. Also
                       shifted top/right in from 14px to 8px so the bigger
                       button doesn't overhang the modal's rounded corner. */
                    width: 44px;
                    height: 44px;
                    border-radius: 10px;
                    border: 1px solid var(--lp-border);
                    background: #fff;
                    color: var(--lp-muted);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .lp-checkout-close:hover { color: var(--lp-text); }

                /* ---------- Book a Demo modal (NEW — richer styling) ---------- */
                .lp-demo-modal {
                    max-width: 560px;
                    width: 100%;
                    padding: 44px 40px 36px;
                    position: relative;
                    overflow: hidden;
                    border: 1px solid var(--lp-border);
                }
                .lp-demo-modal::before {
                    content: "";
                    position: absolute;
                    top: -140px;
                    left: 50%;
                    transform: translateX(-50%);
                    width: 460px;
                    height: 300px;
                    background: radial-gradient(closest-side, rgba(8,161,206,0.16), transparent 72%);
                    pointer-events: none;
                    z-index: 0;
                }
                .lp-demo-modal > * { position: relative; z-index: 1; }
                .lp-demo-icon {
                    width: 72px;
                    height: 72px;
                    border-radius: 19px;
                    background: var(--lp-gradient);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin: 0 auto 20px;
                    box-shadow: 0 14px 34px rgba(8,161,206,0.4), 0 0 0 7px rgba(8,161,206,0.08);
                }
                .lp-demo-icon i { font-size: 32px; color: #fff; }
                .lp-demo-modal .lp-login-title {
                    text-align: center;
                    font-size: 26px;
                    background: var(--lp-gradient);
                    -webkit-background-clip: text;
                    background-clip: text;
                    color: transparent;
                    display: inline-block;
                    width: 100%;
                    margin-bottom: 10px;
                }
                .lp-demo-modal .lp-login-subtitle {
                    text-align: center;
                    max-width: 400px;
                    margin: 0 auto 28px;
                    font-size: 15px;
                }
                .lp-demo-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 16px;
                    margin-bottom: 22px;
                }
                @media (max-width: 520px) {
                    .lp-demo-grid { grid-template-columns: 1fr; }
                }
                .lp-demo-field { position: relative; }
                .lp-demo-chip {
                    position: absolute;
                    left: 8px;
                    top: 50%;
                    transform: translateY(-50%);
                    width: 34px;
                    height: 34px;
                    border-radius: 9px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    pointer-events: none;
                    transition: transform 0.15s ease;
                }
                .lp-demo-chip i { font-size: 16px; }
                .lp-demo-field input.lp-login-input {
                    padding-left: 54px;
                    padding-top: 15px;
                    padding-bottom: 15px;
                    min-height: 52px;
                    font-size: 15px;
                    margin-bottom: 0;
                    border-color: #DCE3EF;
                    border-radius: 11px;
                }
                .lp-demo-field:focus-within .lp-demo-chip { transform: translateY(-50%) scale(1.08); }
                .lp-demo-submit {
                    width: 100%;
                    box-sizing: border-box;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 9px;
                    letter-spacing: 0.01em;
                    box-shadow: 0 14px 30px rgba(8,161,206,0.32);
                    min-height: 54px;
                    font-size: 16px;
                    border-radius: 11px;
                }
                .lp-demo-note {
                    text-align: center;
                    font-size: 13px;
                    color: var(--lp-muted);
                    margin: 20px auto 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 7px;
                    background: rgba(32,66,151,0.06);
                    border: 1px solid rgba(32,66,151,0.12);
                    border-radius: 999px;
                    padding: 9px 18px;
                    width: fit-content;
                }
                .lp-demo-note i { color: var(--lp-cyan); font-size: 14px; }

                /* Plans & Pricing modal — same overlay as checkout, but wider
                   to fit the 4-card pricing grid, and scrolls internally on
                   short screens instead of overflowing the viewport. */
                .lp-pricing-modal {
                    position: relative;
                    width: 100%;
                    max-width: 1150px;
                    max-height: 90vh;
                    overflow-y: auto;
                    background: var(--lp-bg);
                    border-radius: 18px;
                    padding: clamp(28px, 5vw, 44px);
                    box-shadow: 0 24px 60px rgba(0,0,0,0.35);
                }
                .lp-pricing-modal .lp-pricing-grid { margin: 0 auto; }

                /* ---------- "A look inside" screens — now opens as a FULL
                   PAGE takeover instead of a centered modal card. The
                   overlay drops its padding/centering and the panel fills
                   the viewport edge-to-edge (its own sc-body/sc-main still
                   scroll internally). Classes are prefixed sc- to keep them
                   isolated from the rest of the page's lp- classes. Colours
                   reuse the same --lp-* tokens so it matches the rest of
                   the site instead of looking bolted on. */
                .lp-screens-overlay {
                    padding: 0;
                    align-items: stretch;
                    justify-content: stretch;
                }
                .lp-screens-modal {
                    position: relative;
                    width: 100%;
                    max-width: 100%;
                    height: 100vh;
                    max-height: 100vh;
                    overflow-y: auto;
                    background: var(--lp-ink);
                    border-radius: 0;
                    padding: 20px clamp(20px, 4vw, 48px) 40px;
                    box-shadow: none;
                }
                .sc-head { padding: 6px 10px 18px; text-align: center; }
                .sc-head h3 {
                    color: #fff;
                    font-size: 24px;
                    margin: 0 0 6px;
                    font-family: 'Sora', sans-serif;
                }
                .sc-head p { color: #9FB0CC; font-size: 14.5px; line-height: 1.6; max-width: 640px; margin: 0 auto; }
                .sc-frame {
                    background: #fff;
                    border-radius: 14px;
                    overflow: hidden;
                    border: 1px solid #22304F;
                    box-shadow: 0 30px 60px -30px rgba(0,0,0,0.6);
                    max-width: 1180px;
                    margin: 0 auto;
                }
                .sc-top {
                    background: var(--lp-gradient);
                    color: #fff;
                    display: flex;
                    align-items: center;
                    gap: 14px;
                    padding: 12px 18px;
                    font-size: 13.5px;
                }
                .sc-brand {
                    display: flex;
                    align-items: center;
                    background: #fff;
                    border-radius: 8px;
                    padding: 5px 9px;
                }
                .sc-welcome { font-weight: 500; opacity: 0.95; }
                .sc-welcome b { font-weight: 700; }
                .sc-avatar {
                    margin-left: auto;
                    width: 30px;
                    height: 30px;
                    border-radius: 50%;
                    background: rgba(255,255,255,0.25);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font: 700 11px 'Sora', sans-serif;
                    flex-shrink: 0;
                }
                .sc-body { display: flex; align-items: stretch; min-height: 520px; }
                .sc-side {
                    flex: none;
                    width: 208px;
                    background: #FBFCFE;
                    border-right: 1px solid var(--lp-border);
                    padding: 14px 10px;
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    font-size: 13.5px;
                }
                .sc-item {
                    cursor: pointer;
                    padding: 10px 14px;
                    border-radius: 9px;
                    color: var(--lp-muted);
                    font-weight: 500;
                    background: none;
                    border: none;
                    text-align: left;
                    font-family: inherit;
                    transition: background 0.15s ease, color 0.15s ease;
                }
                .sc-item:hover { background: var(--lp-bg); color: var(--lp-text); }
                .sc-item.active { background: var(--lp-blue); color: #fff; font-weight: 600; }
                .sc-main { flex: 1; min-width: 0; overflow-x: auto; background: var(--lp-bg); }
                .sc-panel { padding: 26px 28px; min-height: 480px; }
                .sc-filters { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 16px; font-size: 12px; color: var(--lp-muted); }
                .sc-filters label { display: flex; flex-direction: column; gap: 5px; font-weight: 500; }
                .sc-filters label.grow { flex: 1; min-width: 200px; }
                .sc-filters select, .sc-filters input, .sc-f input, .sc-f select {
                    font: 400 13px inherit;
                    padding: 8px 11px;
                    border-radius: 8px;
                    border: 1px solid var(--lp-border);
                    background: #fff;
                    color: var(--lp-text);
                    min-width: 150px;
                }
                .sc-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
                @media (max-width: 620px) { .sc-kpis { grid-template-columns: repeat(2, 1fr); } }
                .sc-kpi { background: #fff; border: 1px solid var(--lp-border); border-radius: 10px; padding: 12px 14px; }
                .sc-kpi b { display: block; font: 700 21px 'Sora', sans-serif; color: var(--lp-text); }
                .sc-kpi span { font-size: 12px; color: var(--lp-muted); }
                .sc-kpi.green b { color: #1E8F7E; }
                .sc-kpi.amber b { color: #B7791F; }
                .sc-actions { display: flex; gap: 10px; margin-bottom: 16px; }
                .sc-btn {
                    font: 600 13px inherit;
                    padding: 9px 14px;
                    border-radius: 8px;
                    border: 1px solid var(--lp-border);
                    background: #fff;
                    color: var(--lp-muted);
                }
                .sc-btn.primary { background: var(--lp-blue); color: #fff; border-color: var(--lp-blue); }
                .sc-btn.danger { background: #FEECEC; color: #C0392B; border-color: #F6D2D2; }
                .sc-table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid var(--lp-border); border-radius: 10px; overflow: hidden; font-size: 12.5px; line-height: 1.3; }
                .sc-table th {
                    text-align: left;
                    background: var(--lp-bg);
                    color: var(--lp-muted);
                    font-weight: 600;
                    padding: 8px 12px;
                    font-size: 11px;
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                }
                .sc-table td { padding: 8px 12px; border-top: 1px solid #EEF3FA; color: var(--lp-text); }
                .sc-pill { display: inline-block; font: 600 11px inherit; padding: 3px 9px; border-radius: 999px; }
                .sc-pill.green { background: #E4F6F2; color: #1E8F7E; }
                .sc-pill.amber { background: #FBF1DB; color: #B7791F; }
                .sc-pill.grey { background: var(--lp-bg); color: var(--lp-muted); border: 1px solid var(--lp-border); }
                .sc-pill.blue { background: #E5EEFB; color: var(--lp-blue); }
                .sc-split { display: grid; grid-template-columns: 220px 1fr; gap: 18px; }
                @media (max-width: 620px) { .sc-split { grid-template-columns: 1fr; } }
                .sc-form { display: flex; flex-direction: column; gap: 10px; background: #fff; border: 1px solid var(--lp-border); border-radius: 10px; padding: 14px; }
                .sc-form-wide { max-width: 480px; padding: 24px; gap: 16px; }
                .sc-form-wide .sc-f input, .sc-form-wide .sc-f select { padding: 12px 14px; font-size: 14.5px; }
                .sc-form-wide .sc-f { font-size: 13.5px; gap: 7px; }
                .sc-form-wide .sc-btn { padding: 12px 20px; font-size: 14px; }
                .sc-f { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--lp-muted); font-weight: 500; }
                .sc-tabbar { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
                .sc-tabbar span { font: 500 12.5px inherit; padding: 7px 12px; border-radius: 999px; background: #fff; border: 1px solid var(--lp-border); color: var(--lp-muted); white-space: nowrap; }
                .sc-tabbar span.on { background: var(--lp-blue); color: #fff; border-color: var(--lp-blue); }
                .sc-people { display: flex; flex-direction: column; gap: 8px; }
                .sc-person { display: flex; align-items: center; gap: 12px; background: #fff; border: 1px solid var(--lp-border); border-radius: 10px; padding: 10px 14px; font-size: 13px; }
                .sc-person > div { flex: 1; }
                .sc-person b { display: block; color: var(--lp-text); }
                .sc-person small { color: var(--lp-muted); font-size: 11.5px; }
                .sc-ini { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; font: 600 12px 'Sora', sans-serif; flex-shrink: 0; }
                .sc-ini.big { width: 52px; height: 52px; font-size: 17px; }
                .sc-qccard { background: #fff; border: 1px solid var(--lp-border); border-left: 3px solid var(--lp-blue); border-radius: 10px; padding: 16px; }
                .sc-qctop { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; font: 700 15px 'Sora', sans-serif; color: var(--lp-text); }
                .sc-qcrow { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; font-size: 11.5px; color: var(--lp-muted); margin-bottom: 12px; }
                @media (max-width: 620px) { .sc-qcrow { grid-template-columns: repeat(2, 1fr); } }
                .sc-qcrow b { display: block; color: var(--lp-text); font-size: 13px; font-weight: 600; margin-top: 2px; }
                .sc-qcremark { background: var(--lp-bg); border: 1px solid var(--lp-border); border-radius: 8px; padding: 10px 12px; font-size: 12.5px; margin-bottom: 14px; color: var(--lp-muted); }
                .sc-cardgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
                .sc-svc, .sc-cli, .sc-emp { background: #fff; border: 1px solid var(--lp-border); border-radius: 10px; padding: 14px; font-size: 12.5px; }
                .sc-svc b, .sc-cli b, .sc-emp b { display: block; color: var(--lp-text); font-size: 14px; margin: 8px 0 6px; }
                .sc-svc small, .sc-cli small, .sc-emp small { color: var(--lp-muted); display: block; margin-top: 6px; }
                .sc-dot { display: inline-block; width: 10px; height: 10px; border-radius: 3px; }
                .sc-profile { display: flex; align-items: center; gap: 22px; background: #fff; border: 1px solid var(--lp-border); border-radius: 12px; padding: 26px; margin-bottom: 20px; }
                .sc-profile b { display: block; color: var(--lp-text); font-size: 19px; }
                .sc-profile small { color: var(--lp-muted); display: block; margin: 3px 0 8px; }
                .sc-caption { padding: 16px 10px 4px; font-size: 14px; color: #9FB0CC; max-width: 680px; margin: 0 auto; }
                .sc-caption b { color: #fff; font-weight: 600; }
                @media (max-width: 720px) {
                    .sc-body { flex-direction: column; }
                    .sc-side { width: 100%; flex-direction: row; overflow-x: auto; border-right: none; border-bottom: 1px solid var(--lp-border); }
                    .sc-item { white-space: nowrap; }
                }

                /* ---------- Base login/modal form styles (were missing) ---------- */
                .lp-login-title { font-size: 22px; font-weight: 800; margin: 0 0 8px; color: var(--lp-text); }
                .lp-login-subtitle { font-size: 14.5px; color: var(--lp-muted); line-height: 1.6; margin: 0 0 18px; }
                .lp-login-error {
                    background: #FEECEC; color: #B42318; border: 1px solid #F6D2D2;
                    border-radius: 10px; padding: 10px 14px; font-size: 13.5px; margin-bottom: 14px;
                }
                .lp-login-input {
                    width: 100%; box-sizing: border-box; font: 400 15px 'Inter', sans-serif;
                    padding: 13px 14px; border-radius: 11px; border: 1px solid #DCE3EF;
                    background: #fff; color: var(--lp-text); outline: none;
                    transition: border-color 0.15s ease, box-shadow 0.15s ease;
                }
                .lp-login-input:focus { border-color: var(--lp-cyan); box-shadow: 0 0 0 4px rgba(8,161,206,0.14); }
                .lp-login-submit {
                    width: 100%; box-sizing: border-box; min-height: 48px; border: none; border-radius: 11px;
                    background: var(--lp-gradient); color: #fff; font: 600 15px 'Inter', sans-serif;
                    cursor: pointer; box-shadow: 0 12px 26px rgba(8,161,206,0.28);
                    transition: filter 0.15s ease, transform 0.15s ease;
                }
                .lp-login-submit:hover:not(:disabled) { filter: brightness(1.08); transform: translateY(-1px); }
                .lp-login-submit:disabled { opacity: 0.65; cursor: not-allowed; }

                /* ---------- Payment modal ---------- */
                .lp-pay-modal {
                    max-width: 440px; padding: 0; overflow: hidden;
                    max-height: 92vh; overflow-y: auto;
                }
                .lp-pay-head {
                    background: linear-gradient(160deg, var(--lp-ink) 0%, #142146 60%, #1B3A7A 100%);
                    color: #fff; padding: 34px 28px 26px; text-align: center; position: relative; overflow: hidden;
                }
                .lp-pay-head::before {
                    content: ""; position: absolute; top: -90px; right: -60px; width: 240px; height: 240px;
                    border-radius: 50%; background: var(--lp-cyan); opacity: 0.25; filter: blur(60px);
                }
                .lp-pay-head > * { position: relative; }
                .lp-pay-badge {
                    display: inline-block; font-size: 12px; font-weight: 700; letter-spacing: 0.04em;
                    padding: 5px 14px; border-radius: 999px; margin-bottom: 12px;
                    background: var(--lp-gradient); color: #fff;
                }
                .lp-pay-plan { font-size: 20px; font-weight: 700; margin: 0 0 6px; color: #fff; }
                .lp-pay-price { font-family: 'Sora', sans-serif; font-size: 38px; font-weight: 800; line-height: 1.1; color: #fff; }
                .lp-pay-price span { font-size: 14px; font-weight: 500; color: #A9BBD9; font-family: 'Inter', sans-serif; }
                .lp-pay-close {
                    position: absolute; top: 10px; right: 10px; z-index: 3;
                    background: rgba(255,255,255,0.14); border: 1px solid rgba(255,255,255,0.25); color: #fff;
                }
                .lp-pay-close:hover { background: rgba(255,255,255,0.26); color: #fff; }
                .lp-pay-body { padding: 24px 28px 26px; }
                .lp-pay-features { list-style: none; margin: 0 0 20px; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; }
                .lp-pay-features li { display: flex; align-items: center; gap: 7px; font-size: 13.5px; color: var(--lp-text); }
                .lp-pay-features i { color: var(--lp-green); font-size: 16px; flex-shrink: 0; }
                @media (max-width: 420px) { .lp-pay-features { grid-template-columns: 1fr; } }
                .lp-pay-upgrade {
                    width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;
                    min-height: 44px; margin-bottom: 18px; border-radius: 11px; cursor: pointer;
                    background: rgba(32,66,151,0.06); border: 1px dashed rgba(32,66,151,0.35);
                    color: var(--lp-blue); font: 600 14px 'Inter', sans-serif;
                }
                .lp-pay-upgrade:hover { background: rgba(32,66,151,0.11); }
                .lp-pay-mode {
                    font-size: 13px; color: var(--lp-muted); background: var(--lp-bg);
                    border: 1px solid var(--lp-border); border-radius: 10px; padding: 10px 14px; margin-bottom: 16px; line-height: 1.5;
                }
                .lp-pay-label { display: block; font-size: 12.5px; font-weight: 600; color: #334155; margin: 0 0 6px; }
                .lp-pay-field { position: relative; margin-bottom: 14px; }
                .lp-pay-field > i {
                    position: absolute; left: 14px; top: 50%; transform: translateY(-50%);
                    font-size: 17px; color: var(--lp-muted); pointer-events: none;
                }
                .lp-pay-field .lp-login-input { padding-left: 42px; }
                .lp-pay-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
                .lp-pay-secure {
                    display: flex; align-items: center; justify-content: center; gap: 7px;
                    font-size: 12.5px; color: var(--lp-muted); margin-top: 14px;
                }
                .lp-pay-secure i { color: var(--lp-green); font-size: 14px; }
                .lp-pay-back {
                    width: 100%; margin-top: 8px; background: transparent; border: none;
                    color: var(--lp-muted); font-size: 13.5px; cursor: pointer; min-height: 44px;
                }
                .lp-pay-back:hover { color: var(--lp-text); }
                .lp-pay-done { text-align: center; padding: 8px 0 0; }
                .lp-pay-done-icon {
                    width: 64px; height: 64px; border-radius: 50%; margin: 0 auto 16px;
                    background: #E4F6F2; color: #1E8F7E; display: flex; align-items: center; justify-content: center; font-size: 30px;
                }

                /* ---------- Country picker (replaces Sign Up in nav) ---------- */
                .lp-country { position: relative; }
                .lp-country-btn {
                    display: inline-flex; align-items: center; gap: 8px;
                    min-height: 44px; padding: 0 12px; box-sizing: border-box;
                    background: transparent; border: 1px solid #33415F; border-radius: 8px;
                    color: #fff; font: 600 14px 'Inter', sans-serif; cursor: pointer;
                    transition: border-color 0.15s ease, background 0.15s ease;
                }
                .lp-country-btn:hover { border-color: #08A1CE; background: rgba(8,161,206,0.08); }
                .lp-country-btn img { width: 22px; height: 16px; object-fit: cover; border-radius: 2px; }
                .lp-country-btn i { font-size: 15px; color: #B9C4DA; }
                .lp-country-backdrop { position: fixed; inset: 0; z-index: 39; }
                .lp-country-menu {
                    position: absolute; top: calc(100% + 8px); right: 0; z-index: 40;
                    width: 240px; max-height: 300px; overflow-y: auto; padding: 6px;
                    background: #fff; border: 1px solid var(--lp-border); border-radius: 12px;
                    box-shadow: 0 18px 40px rgba(10,18,36,0.28);
                }
                .lp-country-item {
                    width: 100%; display: flex; align-items: center; gap: 10px;
                    min-height: 44px; padding: 0 10px; box-sizing: border-box;
                    background: none; border: none; border-radius: 8px; cursor: pointer;
                    text-align: left; font: 500 14px 'Inter', sans-serif; color: var(--lp-text);
                }
                .lp-country-item:hover { background: var(--lp-bg); }
                .lp-country-item.active { background: rgba(32,66,151,0.08); font-weight: 600; }
                .lp-country-item img { width: 22px; height: 16px; object-fit: cover; border-radius: 2px; flex-shrink: 0; }
                .lp-country-item .lp-country-name { flex: 1; }
                .lp-country-item i { color: var(--lp-blue); font-size: 16px; }
                .lp-country-mobile .lp-country-btn { width: 100%; justify-content: center; }
                .lp-country-mobile .lp-country-menu { left: 0; right: 0; width: auto; }

                /* ---------- Responsive ---------- */
                /* FIX: Sign Up + Login buttons were always visible, even
                   alongside the burger menu — on narrow phones the three
                   together (brand + 2 buttons + burger) were wider than
                   the viewport, so Login got pushed off-screen. Standard
                   fix: below 900px, hide the header buttons and rely on
                   the burger's mobile panel instead (Login/Sign Up are
                   added there — see the JSX). */
                html, body, #root {
                    max-width: 100%;
                    overflow-x: hidden;
                }
                /* The nav is "position: fixed" and covers the top 76px of
                   the viewport, so jumping straight to a section's exact
                   top (via scrollIntoView, or a real #hash reload) would
                   land it right underneath the nav, hidden. This tells the
                   browser's own scrolling to stop 76px short every time. */
                html {
                    scroll-padding-top: 76px;
                }
                @media (max-width: 900px) {
                    .lp-nav-links { display: none; }
                    .lp-country-desktop { display: none; }
                    .lp-nav-signup-btn, .lp-nav-login-btn { display: none; }
                    .lp-burger { display: flex; }
                    .lp-mobile-panel.open { display: flex; }
                }
                @media (max-width: 720px) {
                    .lp-hero, .lp-login-section { flex-direction: column; text-align: center; }
                    .lp-hero-left { text-align: center; }
                    .lp-hero-left .lp-hero-icon-badge { margin-left: auto; margin-right: auto; }
                    .lp-hero-subtitle { margin-left: auto; margin-right: auto; }
                    .lp-hero-ctas, .lp-hero-pills { justify-content: center; }
                    .lp-float-card { display: none; }
                    .lp-login-card { width: 100%; }
                    .lp-price-card.lp-highlighted { order: -1; transform: none; }
                }
                @media (max-width: 480px) {
                    .lp-mock-stats-row { flex-wrap: wrap; }
                    .lp-mock-stat { flex: 1 1 40%; }
                    .lp-footer { justify-content: center; text-align: center; }
                }
            `}</style>

            <div className="lp-topline" />

            {/* ---------- Nav ---------- */}
            <header className="lp-nav">
                <div className="lp-nav-brand">
                    <img src="/Logo.jpg" alt="Alookate" className="lp-nav-logo" />
                </div>
                <nav className="lp-nav-links">
                    <a
                        href="#overview"
                        className="lp-nav-link"
                        onClick={(e) => {
                            e.preventDefault();
                            scrollTo("overview");
                        }}
                    >
                        Overview
                    </a>
                    <a
                        href="#features"
                        className="lp-nav-link"
                        onClick={(e) => {
                            e.preventDefault();
                            scrollTo("features");
                        }}
                    >
                        Features
                    </a>
                    <a
                        href="#screens"
                        className="lp-nav-link"
                        onClick={(e) => {
                            e.preventDefault();
                            setMenuOpen(false);
                            setScreensOpen(true);
                        }}
                    >
                        A Look Inside
                    </a>
                    <a
                        href="#pricing"
                        className="lp-nav-link"
                        onClick={(e) => {
                            e.preventDefault();
                            setMenuOpen(false);
                            setPricingOpen(true);
                        }}
                    >
                        Plans &amp; Pricing
                    </a>
                </nav>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <button className="lp-nav-signup-btn" onClick={() => setDemoOpen(true)}>
                        Book a Demo
                    </button>
                    {renderCountryPicker("desktop")}
                    <button
                        className="lp-nav-login-btn"
                        onClick={() => window.open("/login", "_blank", "noopener,noreferrer")}
                    >
                        Login
                    </button>
                    <button
                        className="lp-burger"
                        onClick={() => setMenuOpen((v) => !v)}
                        aria-label="Toggle menu"
                    >
                        <i className={`ti ${menuOpen ? "ti-x" : "ti-menu-2"}`} />
                    </button>
                </div>
            </header>
            {/* Reserves the space the now-fixed nav used to occupy in
                normal flow — see .lp-nav-spacer above. */}
            <div className="lp-nav-spacer" aria-hidden="true" />
            <div className={`lp-mobile-panel${menuOpen ? " open" : ""}`}>
                <a
                    href="#overview"
                    onClick={(e) => {
                        e.preventDefault();
                        scrollTo("overview");
                    }}
                >
                    Overview
                </a>
                <a
                    href="#features"
                    onClick={(e) => {
                        e.preventDefault();
                        scrollTo("features");
                    }}
                >
                    Features
                </a>
                <a
                    href="#screens"
                    onClick={(e) => {
                        e.preventDefault();
                        setMenuOpen(false);
                        setScreensOpen(true);
                    }}
                >
                    A Look Inside
                </a>
                <a
                    href="#pricing"
                    onClick={(e) => {
                        e.preventDefault();
                        setMenuOpen(false);
                        setPricingOpen(true);
                    }}
                >
                    Plans &amp; Pricing
                </a>
                <button
                    className="lp-nav-signup-btn"
                    style={{
                        display: "flex",
                        width: "100%",
                        justifyContent: "center",
                        marginTop: 14,
                    }}
                    onClick={() => {
                        setMenuOpen(false);
                        setDemoOpen(true);
                    }}
                >
                    Book a Demo
                </button>
                <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                    <div style={{ flex: 1 }}>{renderCountryPicker("mobile")}</div>
                    <button
                        className="lp-nav-login-btn"
                        style={{ display: "flex", flex: 1, justifyContent: "center" }}
                        onClick={() => window.open("/login", "_blank", "noopener,noreferrer")}
                    >
                        Login
                    </button>
                </div>
            </div>

            {/* ---------- Hero ---------- */}
            <section id="overview" className="lp-hero">
                <div className="lp-hero-glow g1" />
                <div className="lp-hero-glow g2" />
                <div className="lp-hero-glow g3" />

                <span className="lp-particle p1" />
                <span className="lp-particle p2" />
                <span className="lp-particle p3" />
                <span className="lp-particle p4" />

                <div className="lp-hero-left">
                    <div className="lp-hero-icon-badge">
                        <i className="ti ti-layout-grid" />
                    </div>
                    <span className="lp-eyebrow">
                        <i className="ti ti-bolt" /> Built for real-time allocation
                    </span>
                    <h1 className="lp-hero-title">
                        Smart Workforce.
                        <br />
                        <span>Better Allocation.</span>
                    </h1>
                    <p className="lp-hero-subtitle">
                        OSOI Allocate assigns daily work to the right person, automatically.
                        Managers set the rules — time of day, department, or task type — and the
                        system handles the rest.
                    </p>
                    <div className="lp-hero-ctas">
                        <button className="lp-btn-primary" onClick={() => setPricingOpen(true)}>
                            Get Started
                        </button>
                        <button className="lp-btn-secondary" onClick={() => setPricingOpen(true)}>
                            View Plans
                        </button>
                    </div>
                    <div className="lp-hero-pills">
                        <span className="lp-hero-pill">
                            <i className="ti ti-shield-check" /> Secure &amp; Reliable
                        </span>
                        <span className="lp-hero-pill">
                            <i className="ti ti-chart-arrows" /> Scalable for Growth
                        </span>
                        <span className="lp-hero-pill">
                            <i className="ti ti-mood-smile" /> Easy to Use
                        </span>
                    </div>
                </div>

                <div className="lp-hero-right">
                    <div className="lp-mock-wrap">
                        <div className="lp-float-card fc1">
                            <i className="ti ti-check" /> Task Completed
                        </div>

                        <div className="lp-mock-card">
                            <div className="lp-mock-header">
                                <span className="lp-mock-dot" />
                                <span style={{ fontSize: fontSize.sm, opacity: 0.7 }}>
                                    Dashboard
                                </span>
                            </div>
                            <div className="lp-mock-stats-row">
                                <div className="lp-mock-stat">
                                    <div className="lp-mock-stat-num">24</div>
                                    <div className="lp-mock-stat-label">Active Employees</div>
                                </div>
                                <div className="lp-mock-stat">
                                    <div className="lp-mock-stat-num">128</div>
                                    <div className="lp-mock-stat-label">Tasks Assigned</div>
                                </div>
                                <div className="lp-mock-stat">
                                    <div className="lp-mock-stat-num">16</div>
                                    <div className="lp-mock-stat-label">Projects</div>
                                </div>
                            </div>
                            <div className="lp-mock-bars">
                                {[60, 90, 40, 75, 55, 100, 35].map((h, i) => (
                                    <div
                                        key={i}
                                        className="lp-mock-bar"
                                        style={{ height: `${h}%` }}
                                    />
                                ))}
                            </div>
                        </div>

                        <div className="lp-float-card fc2">
                            <span className="lp-avatar-dot" /> Team Synced
                        </div>
                    </div>
                </div>
            </section>

            {/* ---------- Stats band (overlaps hero) ---------- */}
            <div className="lp2-stats-sec">
                <div className="lp2-stats">
                    {[
                        ["1 click", "Smart Allocation across everyone marked present"],
                        ["4 roles", "Super admin, admin, manager and user"],
                        ["₹0", "to start, on the Free plan"],
                        ["0 installs", "Runs in any browser, on any device"],
                    ].map(([n, l]) => (
                        <div key={n} className="lp2-stat">
                            <div className="lp2-stat-num">{n}</div>
                            <div className="lp2-stat-label">{l}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* ---------- What is + industries ---------- */}
            <section id="applications" className="lp-section lp-apps-section">
                <div className="lp2-wrap">
                    <div className="lp2-about">
                        <div>
                            <span className="lp-about-tag">
                                <i className="ti ti-sparkles" /> What is Alookate
                            </span>
                            <h2 className="lp-section-title">
                                Daily case work, handed out fairly and tracked end to end.
                            </h2>
                            <p>
                                Alookate keeps track of your clients, the services you deliver, your
                                people and every case that moves between them, then hands out
                                today's work to whoever is actually present. No spreadsheet, and no
                                single person holding it all together.
                            </p>
                        </div>
                        <div className="lp2-about-tiles">
                            {ABOUT_DEFS.map((a) => (
                                <div
                                    key={a.title}
                                    className="lp2-about-tile"
                                    style={{ background: a.bg }}
                                >
                                    <i className={`ti ${a.icon}`} style={{ color: a.fg }} />
                                    <b>{a.title}</b>
                                    <span>{a.desc}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                    <h2 className="lp-section-title">Where Alookate delivers results</h2>
                    <p className="lp-section-subtitle" style={{ marginBottom: 28 }}>
                        Built for teams that move cases, not tickets, across every kind of service
                        floor.
                    </p>
                    <div className="lp2-marquee">
                        <div className="lp2-marquee-track">
                            {[...APPLICATIONS, ...APPLICATIONS].map((a, i) => (
                                <span key={a.label + i} className="lp2-pill">
                                    <i className={`ti ${a.icon}`} />
                                    {a.label}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            {/* ---------- Why choose (bento) ---------- */}
            <section id="features" className="lp-section">
                <div className="lp2-wrap">
                    <h2 className="lp-section-title">Why choose Workforce Allocation?</h2>
                    <p className="lp-section-subtitle">
                        The right people on the right work, with security and control built in.
                    </p>
                    <div className="lp2-bento">
                        {FEATURES.map((f, i) => {
                            const variant =
                                i === 0
                                    ? "wide dark"
                                    : i === 5
                                      ? "wide tint"
                                      : i >= 6
                                        ? "wide"
                                        : "";
                            return (
                                <div key={f.title} className={`lp2-bento-card ${variant}`}>
                                    <div className="lp2-bento-icon">
                                        <i className={`ti ${f.icon}`} />
                                    </div>
                                    <h3>{f.title}</h3>
                                    <p>{f.desc}</p>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>

            {/* ---------- Old way vs new way ---------- */}
            <section id="switch" className="lp-section">
                <div className="lp2-wrap">
                    <h2 className="lp-section-title">Spreadsheets work, until someone's away</h2>
                    <p className="lp-section-subtitle">
                        Allocation by spreadsheet holds up right until the one person who owns it
                        takes a day off. Here's what changes when the system owns the job.
                    </p>
                    <div className="lp2-vs">
                        <div className="lp2-vs-card old">
                            <h3>The usual Monday</h3>
                            <p className="lp2-vs-sub">Allocation without a system</p>
                            <ul className="lp2-vs-list">
                                {OLD_WAY.map((p, i) => (
                                    <li key={i}>
                                        <span className="lp2-vs-mark bad">
                                            <i className="ti ti-x" />
                                        </span>
                                        <span>{p}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="lp2-vs-badge">VS</div>
                        <div className="lp2-vs-card new">
                            <h3>The same Monday, on Alookate</h3>
                            <p className="lp2-vs-sub">What the system takes off your plate</p>
                            <ul className="lp2-vs-list">
                                {NEW_WAY.map((p, i) => (
                                    <li key={i}>
                                        <span className="lp2-vs-mark good">
                                            <i className="ti ti-check" />
                                        </span>
                                        <span>{p}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            </section>

            {/* ---------- Everything the day needs ---------- */}
            <section className="lp-section lp-everything-section">
                <div className="lp2-wrap">
                    <h2 className="lp-section-title">Everything the day needs</h2>
                    <p className="lp-section-subtitle">
                        The small things that decide whether a system is still used after week two.
                    </p>
                    <div className="lp2-grid3">
                        {EVERYTHING.map((f) => (
                            <div key={f.title} className="lp2-card">
                                <div className="lp2-card-icon">
                                    <i className={`ti ${f.icon}`} />
                                </div>
                                <h3>{f.title}</h3>
                                <p>{f.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ---------- How it works ---------- */}
            <section className="lp-section lp-how-section">
                <div className="lp2-wrap">
                    <h2 className="lp-section-title">How it works, in four moves</h2>
                    <p className="lp-section-subtitle">
                        Set up once, then repeat three steps every working day.
                    </p>
                    <div className="lp2-steps">
                        {STEPS.map((s, i) => (
                            <div key={s.title} className="lp2-step">
                                <div className="lp2-step-num">{i + 1}</div>
                                <h3>{s.title}</h3>
                                <p>{s.desc}</p>
                                <div className="lp2-tags">
                                    {s.tags.map((t) => (
                                        <span key={t} className="lp2-tag">
                                            {t}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ---------- Pricing teaser ---------- */}
            <section className="lp-section lp2-price-sec">
                <div className="lp2-wrap">
                    <h2 className="lp-section-title">Start free. Upgrade when your team grows.</h2>
                    <p className="lp-section-subtitle">
                        Plans from ₹0 to custom pricing, with no setup fee to get started.
                    </p>
                    <div className="lp2-price-row">
                        {PLANS.map((p) => (
                            <div
                                key={p.name}
                                className={`lp2-price-chip ${p.highlighted ? "hot" : ""}`}
                            >
                                {p.highlighted && <span className="lp2-badge">{p.badge}</span>}
                                <small>{p.name}</small>
                                <b>{p.price}</b>
                                <span>{p.period || p.desc}</span>
                            </div>
                        ))}
                    </div>
                    <div className="lp-cta-actions" style={{ justifyContent: "center" }}>
                        <button className="lp-cta-btn-primary" onClick={() => setPricingOpen(true)}>
                            Compare plans <i className="ti ti-arrow-right" />
                        </button>
                        <button
                            className="lp-cta-btn-secondary"
                            style={{
                                color: "var(--lp-blue)",
                                borderColor: "#C9DCF7",
                                background: "#fff",
                            }}
                            onClick={() => navigate("/login")}
                        >
                            Start free
                        </button>
                    </div>
                </div>
            </section>

            {/* ---------- Bottom CTA ---------- */}
            <section id="demo" className="lp-section lp-cta-section">
                <div className="lp2-wrap">
                    <div className="lp2-cta">
                        <div className="lp-hero-glow g1" style={{ top: -140, right: -80 }} />
                        <div className="lp-hero-glow g2" style={{ bottom: -160, left: -100 }} />
                        <div className="lp2-cta-left">
                            <h2 className="lp-cta-title">See it run on your own working day.</h2>
                            <p className="lp-cta-desc">
                                Tell us how many people you allocate to and which services you run.
                                We'll set up a walkthrough on data that looks like yours.
                            </p>
                            <div className="lp-cta-actions">
                                <button
                                    className="lp-cta-btn-primary"
                                    onClick={() => setDemoOpen(true)}
                                >
                                    Book a demo <i className="ti ti-arrow-right" />
                                </button>
                                <button
                                    className="lp-cta-btn-secondary"
                                    onClick={() => scrollTo("overview")}
                                >
                                    Back to the top
                                </button>
                            </div>
                        </div>
                        <ul className="lp2-cta-list">
                            {[
                                "A walkthrough on data that looks like yours",
                                "You'll know inside half an hour whether it fits",
                                "Free plan available, no setup fee",
                            ].map((t) => (
                                <li key={t}>
                                    <i className="ti ti-circle-check" />
                                    {t}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </section>

            {/* ---------- Footer ---------- */}
            <footer className="lp-footer">
                <div className="lp2-foot">
                    <div>
                        <img src="/Logo.jpg" alt="Alookate" />
                        <p>
                            Workforce allocation for teams that handle daily case work, from first
                            entry to final bill.
                        </p>
                    </div>
                    <div>
                        <h4>Explore</h4>
                        <button onClick={() => scrollTo("features")}>Why Alookate</button>
                        <button onClick={() => scrollTo("switch")}>Spreadsheet vs system</button>
                        <button onClick={() => setScreensOpen(true)}>A look inside</button>
                    </div>
                    <div>
                        <h4>Get started</h4>
                        <button onClick={() => setPricingOpen(true)}>Plans and pricing</button>
                        <button onClick={() => setDemoOpen(true)}>Book a demo</button>
                        <button onClick={() => navigate("/login")}>Log in</button>
                    </div>
                </div>
                <div className="lp2-foot-bar">
                    <span>
                        © {new Date().getFullYear()} Workforce Allocation. All rights reserved.
                    </span>
                    <div className="lp-footer-links">
                        <a href="#">Privacy Policy</a>
                        <a href="#">Terms of Use</a>
                    </div>
                    {SOCIAL_LINKS.length > 0 && (
                        <div className="lp-footer-social">
                            {SOCIAL_LINKS.map((s) => (
                                <a
                                    key={s.label}
                                    href={s.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={s.label}
                                >
                                    <i className={`ti ${s.icon}`} aria-hidden="true" />
                                </a>
                            ))}
                        </div>
                    )}
                </div>
            </footer>

            {/* ---------- "A look inside" — now a FULL-PAGE takeover (NEW —
                ported from the standalone marketing page's #screens
                section; not shown on the page itself, opens from the
                nav) ---------- */}
            {screensOpen && (
                <div
                    className="lp-checkout-overlay lp-screens-overlay"
                    onClick={() => setScreensOpen(false)}
                >
                    <div className="lp-screens-modal" onClick={(e) => e.stopPropagation()}>
                        <button
                            className="lp-checkout-close"
                            onClick={() => setScreensOpen(false)}
                            aria-label="Close"
                            style={{ position: "absolute", top: 14, right: 14, zIndex: 2 }}
                        >
                            <i className="ti ti-x" />
                        </button>
                        <div className="sc-head">
                            <h3>A look inside</h3>
                            <p>
                                Interface recreated here for illustration. Organisation, people,
                                clients and case numbers are sample data made up for this page — not
                                from any real account. Pick a screen on the left.
                            </p>
                        </div>
                        <div className="sc-frame">
                            <div className="sc-top">
                                <span className="sc-brand">
                                    <img
                                        src="/Logo.jpg"
                                        alt="Alookate"
                                        style={{ height: 18, objectFit: "contain" }}
                                    />
                                </span>
                                <span className="sc-welcome">
                                    Welcome back, <b>Nimbus Teamspace</b>
                                </span>
                                <span className="sc-avatar" aria-hidden="true">
                                    NT
                                </span>
                            </div>
                            <div className="sc-body">
                                <nav className="sc-side" aria-label="Screens">
                                    {SCREENS.map((s) => (
                                        <button
                                            key={s.id}
                                            type="button"
                                            className={`sc-item${activeScreen === s.id ? " active" : ""}`}
                                            onClick={() => setActiveScreen(s.id)}
                                        >
                                            {s.label}
                                        </button>
                                    ))}
                                </nav>
                                <div className="sc-main">{renderScreenPanel(activeScreen)}</div>
                            </div>
                        </div>
                        <p className="sc-caption">
                            <b>{SCREEN_CAPTIONS[activeScreen]?.title}</b>{" "}
                            {SCREEN_CAPTIONS[activeScreen]?.body}
                        </p>
                    </div>
                </div>
            )}

            {/* ---------- "Plans & Pricing" modal (NEW — moved off the page, opens from nav/hero) ---------- */}
            {pricingOpen && (
                <div className="lp-checkout-overlay" onClick={() => setPricingOpen(false)}>
                    <div className="lp-pricing-modal" onClick={(e) => e.stopPropagation()}>
                        <button
                            className="lp-checkout-close"
                            onClick={() => setPricingOpen(false)}
                            aria-label="Close"
                        >
                            <i className="ti ti-x" />
                        </button>
                        <h2 className="lp-section-title" style={{ textAlign: "center" }}>
                            Plans &amp; Pricing
                        </h2>
                        <p
                            className="lp-section-subtitle"
                            style={{ textAlign: "center", marginBottom: 28 }}
                        >
                            Choose the perfect plan for your team. All plans are billed per user.
                        </p>
                        <div className="lp-pricing-grid">
                            {PLANS.map((p) => (
                                <div
                                    key={p.name}
                                    className={`lp-price-card${p.highlighted ? " lp-highlighted" : ""}`}
                                >
                                    {p.badge && <div className="lp-price-badge">{p.badge}</div>}
                                    <div className="lp-price-name">{p.name}</div>
                                    <div className="lp-price-value">
                                        {p.price}
                                        {p.period && (
                                            <span className="lp-price-period"> {p.period}</span>
                                        )}
                                    </div>
                                    <div className="lp-price-desc">{p.desc}</div>
                                    <ul className="lp-price-features">
                                        {p.features.map((f) => (
                                            <li key={f}>
                                                <i className="ti ti-check" />
                                                {f}
                                            </li>
                                        ))}
                                    </ul>
                                    <button
                                        className={`lp-price-btn ${p.highlighted ? "primary" : "secondary"}`}
                                        onClick={() => {
                                            setPricingOpen(false);
                                            handlePlanSelect(p.name);
                                        }}
                                    >
                                        {p.cta}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* ---------- Checkout modal (Basic / Professional) ---------- */}
            {checkoutPlan &&
                (() => {
                    const plan = PLANS.find((p) => p.name === checkoutPlan.name);
                    return (
                        <div className="lp-checkout-overlay">
                            <div
                                className="lp-checkout-modal lp-pay-modal"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <button
                                    className="lp-checkout-close lp-pay-close"
                                    onClick={() => setCheckoutPlan(null)}
                                    aria-label="Close"
                                    disabled={checkoutLoading}
                                >
                                    <i className="ti ti-x" />
                                </button>

                                <div className="lp-pay-head">
                                    <span className="lp-pay-badge">
                                        {plan?.badge ?? "Selected plan"}
                                    </span>
                                    <h3 className="lp-pay-plan">{checkoutPlan.name} Plan</h3>
                                    <div className="lp-pay-price">
                                        {checkoutPlan.price}
                                        <span> / user / month</span>
                                    </div>
                                </div>

                                <div className="lp-pay-body">
                                    {upgradeSuccessMsg ? (
                                        <div className="lp-pay-done">
                                            <div className="lp-pay-done-icon">
                                                <i className="ti ti-check" />
                                            </div>
                                            <p className="lp-login-subtitle">{upgradeSuccessMsg}</p>
                                            <button
                                                className="lp-login-submit"
                                                onClick={() => setCheckoutPlan(null)}
                                            >
                                                Done
                                            </button>
                                        </div>
                                    ) : (
                                        <>
                                            {plan && (
                                                <ul className="lp-pay-features">
                                                    {plan.features.map((f) => (
                                                        <li key={f}>
                                                            <i className="ti ti-circle-check" />
                                                            {f}
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}

                                            {currentUser && !upgradeMode && (
                                                <button
                                                    type="button"
                                                    className="lp-pay-upgrade"
                                                    onClick={handleStartUpgrade}
                                                    disabled={checkoutLoading}
                                                >
                                                    <i className="ti ti-arrow-up-circle" />
                                                    Already a customer? Upgrade your plan
                                                </button>
                                            )}

                                            {upgradeMode && (
                                                <div className="lp-pay-mode">
                                                    This upgrades your existing organization's plan
                                                    ({currentUser?.email}). No new account is
                                                    created.
                                                </div>
                                            )}

                                            {checkoutError && (
                                                <div className="lp-login-error">
                                                    {checkoutError}
                                                </div>
                                            )}

                                            {!upgradeMode && (
                                                <>
                                                    <label className="lp-pay-label">Email</label>
                                                    <div className="lp-pay-field">
                                                        <i className="ti ti-mail" />
                                                        <input
                                                            type="email"
                                                            placeholder="you@company.com"
                                                            value={checkoutEmail}
                                                            onChange={(e) =>
                                                                setCheckoutEmail(e.target.value)
                                                            }
                                                            className="lp-login-input"
                                                            disabled={checkoutLoading}
                                                        />
                                                    </div>
                                                </>
                                            )}

                                            <label className="lp-pay-label">Card number</label>
                                            <div className="lp-pay-field">
                                                <i className="ti ti-credit-card" />
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    placeholder="1234 5678 9012 3456"
                                                    value={cardNumber}
                                                    onChange={(e) => {
                                                        const d = e.target.value
                                                            .replace(/\D/g, "")
                                                            .slice(0, 16);
                                                        setCardNumber(
                                                            d.replace(/(.{4})/g, "$1 ").trim()
                                                        );
                                                    }}
                                                    className="lp-login-input"
                                                    disabled={checkoutLoading}
                                                />
                                            </div>

                                            <div className="lp-pay-row">
                                                <div>
                                                    <label className="lp-pay-label">Expiry</label>
                                                    <div className="lp-pay-field">
                                                        <i className="ti ti-calendar" />
                                                        <input
                                                            type="text"
                                                            inputMode="numeric"
                                                            placeholder="MM/YY"
                                                            value={cardExpiry}
                                                            onChange={(e) => {
                                                                const d = e.target.value
                                                                    .replace(/\D/g, "")
                                                                    .slice(0, 4);
                                                                setCardExpiry(
                                                                    d.length > 2
                                                                        ? `${d.slice(0, 2)}/${d.slice(2)}`
                                                                        : d
                                                                );
                                                            }}
                                                            className="lp-login-input"
                                                            disabled={checkoutLoading}
                                                        />
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="lp-pay-label">CVV</label>
                                                    <div className="lp-pay-field">
                                                        <i className="ti ti-lock" />
                                                        <input
                                                            type="password"
                                                            inputMode="numeric"
                                                            placeholder="•••"
                                                            value={cardCvv}
                                                            onChange={(e) =>
                                                                setCardCvv(
                                                                    e.target.value
                                                                        .replace(/\D/g, "")
                                                                        .slice(0, 4)
                                                                )
                                                            }
                                                            className="lp-login-input"
                                                            disabled={checkoutLoading}
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            <button
                                                className="lp-login-submit"
                                                onClick={
                                                    upgradeMode
                                                        ? handleConfirmUpgrade
                                                        : handleConfirmCheckout
                                                }
                                                disabled={checkoutLoading}
                                            >
                                                {checkoutLoading
                                                    ? "Processing payment…"
                                                    : upgradeMode
                                                      ? `Upgrade & Pay ${checkoutPlan.price}`
                                                      : `Pay ${checkoutPlan.price} & Continue`}
                                            </button>

                                            {upgradeMode && (
                                                <button
                                                    type="button"
                                                    className="lp-pay-back"
                                                    onClick={() => setUpgradeMode(false)}
                                                    disabled={checkoutLoading}
                                                >
                                                    Back to new signup checkout
                                                </button>
                                            )}

                                            <div className="lp-pay-secure">
                                                <i className="ti ti-shield-lock" />
                                                Demo checkout — no real card is charged
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })()}

            {/* ---------- "Sign up your organization" popup ---------- */}
            {orgSignupOpen && (
                <div className="lp-checkout-overlay">
                    <div className="lp-checkout-modal" onClick={(e) => e.stopPropagation()}>
                        <button
                            className="lp-checkout-close"
                            onClick={closeOrgSignup}
                            aria-label="Close"
                            disabled={orgSignupLoading}
                        >
                            <i className="ti ti-x" />
                        </button>

                        {orgSignupSuccess ? (
                            <>
                                <h3 className="lp-login-title">You're all set!</h3>
                                <p className="lp-login-subtitle">{orgSignupSuccess}</p>
                                <button
                                    className="lp-login-submit"
                                    style={{ width: "100%", boxSizing: "border-box" }}
                                    onClick={() => {
                                        closeOrgSignup();
                                        window.open("/login", "_blank", "noopener,noreferrer");
                                    }}
                                >
                                    Go to Login
                                </button>
                            </>
                        ) : (
                            <>
                                <h3 className="lp-login-title">Sign Up Your Organization</h3>
                                <p className="lp-login-subtitle">
                                    Enter your organization name and email — we'll email you a link
                                    to set your password and log in.
                                </p>
                                {orgSignupError && (
                                    <div className="lp-login-error">{orgSignupError}</div>
                                )}
                                <input
                                    type="text"
                                    placeholder="Organization name"
                                    value={orgName}
                                    onChange={(e) => setOrgName(e.target.value)}
                                    className="lp-login-input"
                                    style={{ marginBottom: 10 }}
                                    disabled={orgSignupLoading}
                                />
                                <input
                                    type="email"
                                    placeholder="Your email"
                                    value={orgEmail}
                                    onChange={(e) => setOrgEmail(e.target.value)}
                                    className="lp-login-input"
                                    style={{ marginBottom: 14 }}
                                    disabled={orgSignupLoading}
                                />
                                <button
                                    className="lp-login-submit"
                                    onClick={handleOrgSignup}
                                    disabled={orgSignupLoading}
                                >
                                    {orgSignupLoading
                                        ? "Creating organization…"
                                        : "Create Organization"}
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* ---------- "Book a demo" popup (NEW) ---------- */}
            {demoOpen && (
                <div className="lp-checkout-overlay">
                    <div
                        className="lp-checkout-modal lp-demo-modal"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            className="lp-checkout-close"
                            onClick={closeDemo}
                            aria-label="Close"
                            disabled={demoLoading}
                        >
                            <i className="ti ti-x" />
                        </button>

                        {demoSuccess ? (
                            <>
                                <div className="lp-demo-icon">
                                    <i className="ti ti-check" />
                                </div>
                                <h3 className="lp-login-title">You're all set!</h3>
                                <p className="lp-login-subtitle">{demoSuccess}</p>
                                <button
                                    className="lp-login-submit lp-demo-submit"
                                    onClick={closeDemo}
                                >
                                    Done
                                </button>
                            </>
                        ) : (
                            <>
                                <div className="lp-demo-icon">
                                    <i className="ti ti-calendar-event" />
                                </div>
                                <h3 className="lp-login-title">Book a Demo</h3>
                                <p className="lp-login-subtitle">
                                    Tell us a bit about you and we'll set up a walkthrough on data
                                    that looks like yours.
                                </p>
                                {demoError && <div className="lp-login-error">{demoError}</div>}
                                <div className="lp-demo-grid">
                                    <div className="lp-demo-field">
                                        <input
                                            type="text"
                                            placeholder="Your name"
                                            value={demoName}
                                            onChange={(e) => setDemoName(e.target.value)}
                                            className="lp-login-input"
                                            disabled={demoLoading}
                                        />
                                        <span
                                            className="lp-demo-chip"
                                            style={{ background: "#EAF2FE", color: "#2F6FED" }}
                                        >
                                            <i className="ti ti-user" />
                                        </span>
                                    </div>
                                    <div className="lp-demo-field">
                                        <input
                                            type="tel"
                                            placeholder="Contact number"
                                            value={demoContact}
                                            onChange={(e) => setDemoContact(e.target.value)}
                                            className="lp-login-input"
                                            disabled={demoLoading}
                                        />
                                        <span
                                            className="lp-demo-chip"
                                            style={{ background: "#E8F8F0", color: "#16A34A" }}
                                        >
                                            <i className="ti ti-phone" />
                                        </span>
                                    </div>
                                    <div className="lp-demo-field">
                                        <input
                                            type="email"
                                            placeholder="Email"
                                            value={demoEmail}
                                            onChange={(e) => setDemoEmail(e.target.value)}
                                            className="lp-login-input"
                                            disabled={demoLoading}
                                        />
                                        <span
                                            className="lp-demo-chip"
                                            style={{ background: "#F1ECFB", color: "#8B5CF6" }}
                                        >
                                            <i className="ti ti-mail" />
                                        </span>
                                    </div>
                                    <div className="lp-demo-field">
                                        <input
                                            type="text"
                                            placeholder="Organisation name"
                                            value={demoOrgName}
                                            onChange={(e) => setDemoOrgName(e.target.value)}
                                            className="lp-login-input"
                                            disabled={demoLoading}
                                        />
                                        <span
                                            className="lp-demo-chip"
                                            style={{ background: "#FFF1E0", color: "#F59E0B" }}
                                        >
                                            <i className="ti ti-building" />
                                        </span>
                                    </div>
                                </div>
                                <button
                                    className="lp-login-submit lp-demo-submit"
                                    onClick={handleDemoSubmit}
                                    disabled={demoLoading}
                                >
                                    {demoLoading ? (
                                        "Submitting…"
                                    ) : (
                                        <>
                                            <i className="ti ti-send" /> Book a Demo
                                        </>
                                    )}
                                </button>
                                <p className="lp-demo-note">
                                    <i className="ti ti-shield-lock" /> No spam — just a short call
                                    to see if it fits.
                                </p>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default Landing;
