import { useState } from "react";
import type { CSSProperties } from "react";

interface TeamMember {
  id: number;
  name: string;
  vertical: string;
  assignTo: string;
  lastUpdate: string;
  modifiedBy: string;
}

interface TeamForm {
  name: string;
  vertical: string;
  assignTo: string;
}

const initialTeams: TeamMember[] = [
  { id: 1, name: "Alice Johnson", vertical: "Title Checks (TH)", assignTo: "John Developer", lastUpdate: "14/01/2026 09:00", modifiedBy: "Developer" },
  { id: 2, name: "Bob Smith", vertical: "Mortgage Reports (MR)", assignTo: "Sarah Manager", lastUpdate: "12/01/2026 11:30", modifiedBy: "Developer" },
  { id: 3, name: "Carol White", vertical: "Search Report (SR)", assignTo: "Mike Admin", lastUpdate: "10/01/2026 14:00", modifiedBy: "Developer" },
];

const verticals: string[] = [
  "Title Checks (TH)",
  "Mortgage Reports (MR)",
  "Search Report (SR)",
  "Draft Contract Packs (DCP)",
  "SDLT",
  "PC-SALE",
  "PC-Purchase",
];

export default function TeamTab() {
  const [teams, setTeams] = useState<TeamMember[]>(initialTeams);
  const [search, setSearch] = useState<string>("");
  const [showModal, setShowModal] = useState<boolean>(false);
  const [editItem, setEditItem] = useState<TeamMember | null>(null);
  const [form, setForm] = useState<TeamForm>({ name: "", vertical: verticals[0], assignTo: "" });

  const filtered = teams.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleNew = (): void => {
    setEditItem(null);
    setForm({ name: "", vertical: verticals[0], assignTo: "" });
    setShowModal(true);
  };

  const handleEdit = (item: TeamMember): void => {
    setEditItem(item);
    setForm({ name: item.name, vertical: item.vertical, assignTo: item.assignTo });
    setShowModal(true);
  };

  const handleDelete = (id: number): void => {
    if (window.confirm("Remove team member?")) setTeams((d) => d.filter((x) => x.id !== id));
  };

  const handleSave = (): void => {
    const now = new Date().toLocaleString("en-GB").replace(",", "");
    if (editItem) {
      setTeams((d) =>
        d.map((x) => (x.id === editItem.id ? { ...x, ...form, lastUpdate: now } : x))
      );
    } else {
      setTeams((d) => [
        ...d,
        { id: Date.now(), ...form, lastUpdate: now, modifiedBy: "Developer" },
      ]);
    }
    setShowModal(false);
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.toolbar}>
        <div style={styles.searchBox}>
          <span>🔍</span>
          <input
            style={styles.searchInput}
            placeholder="Search team members..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={styles.refreshBtn}>↻ Refresh</button>
          <button style={styles.newBtn} onClick={handleNew}>+ New</button>
        </div>
      </div>

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr style={styles.thead}>
              {["Admin Name", "Vertical", "Assign To", "Last Update", "Modify by", "Actions"].map((h) => (
                <th key={h} style={styles.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, i) => (
              <tr key={row.id} style={{ ...styles.tr, background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                <td style={styles.td}>{row.name}</td>
                <td style={styles.td}><span style={styles.vertBadge}>{row.vertical}</span></td>
                <td style={styles.td}>{row.assignTo}</td>
                <td style={styles.td}>{row.lastUpdate}</td>
                <td style={styles.td}>{row.modifiedBy}</td>
                <td style={styles.td}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button style={styles.editBtn} onClick={() => handleEdit(row)}>✏ Edit</button>
                    <button style={styles.delBtn} onClick={() => handleDelete(row.id)}>🗑</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <h3 style={styles.modalTitle}>{editItem ? "Edit Team Member" : "New Team Member"}</h3>
            <div style={styles.modalField}>
              <label style={styles.modalLabel}>Full Name</label>
              <input
                style={styles.modalInput}
                placeholder="e.g. Alice Johnson"
                value={form.name}
                onChange={(e) => setForm((x) => ({ ...x, name: e.target.value }))}
              />
            </div>
            <div style={styles.modalField}>
              <label style={styles.modalLabel}>Vertical</label>
              <select
                style={styles.modalInput}
                value={form.vertical}
                onChange={(e) => setForm((x) => ({ ...x, vertical: e.target.value }))}
              >
                {verticals.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </div>
            <div style={styles.modalField}>
              <label style={styles.modalLabel}>Assign To</label>
              <input
                style={styles.modalInput}
                placeholder="e.g. John Developer"
                value={form.assignTo}
                onChange={(e) => setForm((x) => ({ ...x, assignTo: e.target.value }))}
              />
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
              <button style={styles.cancelBtn} onClick={() => setShowModal(false)}>Cancel</button>
              <button style={styles.saveBtn} onClick={handleSave}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: { display: "flex", flexDirection: "column", gap: 16 },
  toolbar: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
  searchBox: { display: "flex", alignItems: "center", gap: 8, background: "#f3f4f6", borderRadius: 8, padding: "8px 14px", flex: 1, maxWidth: 320 },
  searchInput: { border: "none", background: "transparent", outline: "none", fontSize: 14, color: "#111", width: "100%" },
  refreshBtn: { padding: "8px 16px", borderRadius: 6, border: "1.5px solid #d1d5db", background: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#374151" },
  newBtn: { padding: "8px 16px", borderRadius: 6, border: "none", background: "linear-gradient(135deg, #e53935, #c62828)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700 },
  tableWrap: { borderRadius: 10, overflow: "hidden", border: "1px solid #e5e7eb", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" },
  table: { width: "100%", borderCollapse: "collapse" },
  thead: { background: "#f9fafb" },
  th: { padding: "12px 16px", textAlign: "center", fontSize: 12, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid #e5e7eb" },
  tr: { borderBottom: "1px solid #f3f4f6" },
  td: { padding: "11px 16px", textAlign: "center", fontSize: 13, color: "#374151" },
  vertBadge: { background: "#f0fdf4", color: "#15803d", borderRadius: 20, padding: "2px 10px", fontSize: 12, fontWeight: 600 },
  editBtn: { padding: "5px 12px", borderRadius: 5, border: "none", background: "#e53935", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 },
  delBtn: { padding: "5px 9px", borderRadius: 5, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 13 },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 },
  modal: { background: "#fff", borderRadius: 12, padding: "32px", width: 420, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" },
  modalTitle: { margin: "0 0 24px", fontSize: 18, fontWeight: 700, color: "#1a1a2e" },
  modalField: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 },
  modalLabel: { fontSize: 13, fontWeight: 600, color: "#374151" },
  modalInput: { padding: "10px 14px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 14, outline: "none", color: "#111" },
  cancelBtn: { padding: "9px 20px", borderRadius: 7, border: "1.5px solid #d1d5db", background: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600 },
  saveBtn: { padding: "9px 24px", borderRadius: 7, border: "none", background: "linear-gradient(135deg, #e53935, #c62828)", color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 700 },
};
