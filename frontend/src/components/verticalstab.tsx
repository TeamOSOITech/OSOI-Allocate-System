import { useState, useEffect } from "react";
import type { CSSProperties } from "react";

interface Vertical {
  id: number;
  name: string;
  time: number;
  lastUpdate: string;
  modifiedBy: string;
}

interface VerticalForm {
  name: string;
  time: string | number;
}

const initialData: Vertical[] = [
  { id: 1, name: "Title Checks (TH)", time: 120, lastUpdate: "14/01/2026 18:37", modifiedBy: "Developer" },
  { id: 2, name: "Draft Contract Packs (DCP)", time: 30, lastUpdate: "03/12/2025 10:13", modifiedBy: "Developer" },
  { id: 3, name: "Mortgage Reports (MR)", time: 20, lastUpdate: "29/12/2025 17:59", modifiedBy: "Developer" },
  { id: 4, name: "Search Report (SR)", time: 40, lastUpdate: "24/10/2025 18:00", modifiedBy: "Developer" },
  { id: 5, name: "Remortgage Title Checks (RTC)", time: 20, lastUpdate: "24/12/2025 10:30", modifiedBy: "Developer" },
  { id: 6, name: "Request Redemption Figures (RRF)", time: 20, lastUpdate: "29/12/2025 17:17", modifiedBy: "Developer" },
  { id: 7, name: "Remortgage Completion Statements (RCS)", time: 20, lastUpdate: "10/12/2025 19:06", modifiedBy: "Developer" },
  { id: 8, name: "New File Opening (NFO)", time: 30, lastUpdate: "13/01/2026 10:32", modifiedBy: "Developer" },
  { id: 9, name: "Search Ordering (SO)", time: 20, lastUpdate: "13/01/2026 10:53", modifiedBy: "Developer" },
  { id: 10, name: "SDLT", time: 20, lastUpdate: "26/01/2026 09:52", modifiedBy: "Developer" },
  { id: 11, name: "PC-SALE", time: 30, lastUpdate: "13/01/2026 09:55", modifiedBy: "Developer" },
  { id: 12, name: "PC-Purchase", time: 10, lastUpdate: "25/01/2026 09:53", modifiedBy: "Developer" },
  { id: 13, name: "PC-Remo", time: 10, lastUpdate: "26/01/2026 09:20", modifiedBy: "Developer" },
  { id: 14, name: "Billings (S/R/R)", time: 10, lastUpdate: "05/01/2026 09:36", modifiedBy: "Developer" },
];

const MOBILE_BREAKPOINT = 768;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < MOBILE_BREAKPOINT : false
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return isMobile;
}

export default function VerticalsTab() {
  const [data, setData] = useState<Vertical[]>(initialData);
  const [search, setSearch] = useState<string>("");
  const [showModal, setShowModal] = useState<boolean>(false);
  const [editItem, setEditItem] = useState<Vertical | null>(null);
  const [form, setForm] = useState<VerticalForm>({ name: "", time: "" });
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const isMobile = useIsMobile();

  const filtered = data.filter((d) =>
    d.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleNew = (): void => {
    setEditItem(null);
    setForm({ name: "", time: "" });
    setShowModal(true);
  };

  const handleEdit = (item: Vertical): void => {
    setEditItem(item);
    setForm({ name: item.name, time: item.time });
    setShowModal(true);
  };

  const handleDelete = (id: number): void => {
    if (window.confirm("Delete this vertical?"))
      setData((d) => d.filter((x) => x.id !== id));
  };

  const handleSave = (): void => {
    const now = new Date().toLocaleString("en-GB").replace(",", "");
    if (editItem) {
      setData((d) =>
        d.map((x) =>
          x.id === editItem.id
            ? { ...x, name: form.name, time: Number(form.time), lastUpdate: now }
            : x
        )
      );
    } else {
      setData((d) => [
        ...d,
        { id: Date.now(), name: form.name, time: Number(form.time), lastUpdate: now, modifiedBy: "Developer" },
      ]);
    }
    setShowModal(false);
  };

  // Refresh: clears search filter and re-syncs the table.
  // Replace the inner setData(initialData) with a real API refetch when wired to a backend.
  const handleRefresh = (): void => {
    setIsRefreshing(true);
    setSearch("");
    setTimeout(() => {
      setData(initialData);
      setIsRefreshing(false);
    }, 400);
  };

  return (
    <div style={styles.wrap}>
      {/* Toolbar */}
      <div style={isMobile ? styles.toolbarMobile : styles.toolbar}>
        <div style={isMobile ? styles.searchBoxMobile : styles.searchBox}>
          <span style={styles.searchIcon}>🔍</span>
          <input
            style={styles.searchInput}
            placeholder="Search verticals..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div style={isMobile ? styles.toolRightMobile : styles.toolRight}>
          <button
            style={{ ...styles.refreshBtn, ...(isMobile ? styles.btnFlexMobile : {}) }}
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <span style={isRefreshing ? styles.spinning : undefined}>↻</span> Refresh
          </button>
          <button
            style={{ ...styles.newBtn, ...(isMobile ? styles.btnFlexMobile : {}) }}
            onClick={handleNew}
          >
            + New
          </button>
        </div>
      </div>

      {/* Table */}
      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr style={styles.thead}>
              <th style={styles.th}>Vertical Name</th>
              <th style={styles.th}>Allocated Time</th>
              <th style={styles.th}>Last Update</th>
              <th style={styles.th}>Modify by</th>
              <th style={styles.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} style={styles.emptyState}>No verticals found.</td>
              </tr>
            ) : (
              filtered.map((row, i) => (
                <tr key={row.id} style={{ ...styles.tr, background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                  <td style={styles.td}>{row.name}</td>
                  <td style={styles.td}>{row.time} (Minutes)</td>
                  <td style={styles.td}>{row.lastUpdate}</td>
                  <td style={styles.td}>{row.modifiedBy}</td>
                  <td style={styles.td}>
                    <div style={styles.actions}>
                      <button style={styles.editBtn} onClick={() => handleEdit(row)}>✏ Edit</button>
                      <button style={styles.delBtn} onClick={() => handleDelete(row.id)}>🗑</button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <div style={styles.overlay}>
          <div style={isMobile ? styles.modalMobile : styles.modal}>
            <h3 style={styles.modalTitle}>{editItem ? "Edit Vertical" : "New Vertical"}</h3>
            <div style={styles.modalField}>
              <label style={styles.modalLabel}>Vertical Name</label>
              <input
                style={styles.modalInput}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Title Checks"
              />
            </div>
            <div style={styles.modalField}>
              <label style={styles.modalLabel}>Allocated Time (Minutes)</label>
              <input
                style={styles.modalInput}
                type="number"
                value={form.time}
                onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
                placeholder="e.g. 30"
              />
            </div>
            <div style={styles.modalActions}>
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
  wrap: { display: "flex", flexDirection: "column", gap: 16, width: "100%", minWidth: 0 },
  toolbar: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, width: "100%" },
  toolbarMobile: { display: "flex", flexDirection: "column", gap: 10, width: "100%" },
  searchBox: { display: "flex", alignItems: "center", gap: 8, background: "#f3f4f6", borderRadius: 8, padding: "8px 14px", flex: 1, maxWidth: 320 },
  searchBoxMobile: { display: "flex", alignItems: "center", gap: 8, background: "#f3f4f6", borderRadius: 8, padding: "10px 14px", width: "100%" },
  searchIcon: { fontSize: 14, color: "#6b7280" },
  searchInput: { border: "none", background: "transparent", outline: "none", fontSize: 14, color: "#111", width: "100%" },
  toolRight: { display: "flex", gap: 8 },
  toolRightMobile: { display: "flex", gap: 8, width: "100%" },
  btnFlexMobile: { flex: 1, justifyContent: "center", padding: "10px 12px" },
  refreshBtn: {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "8px 16px", borderRadius: 6, border: "1.5px solid #d1d5db",
    background: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#374151",
  },
  newBtn: {
    padding: "8px 16px", borderRadius: 6, border: "none",
    background: "linear-gradient(135deg, #e53935, #c62828)",
    color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700,
  },
  spinning: { display: "inline-block", animation: "spin 0.6s linear infinite" },
  tableWrap: {
    width: "100%",
    overflowX: "auto",
    borderRadius: 10,
    border: "1px solid #e5e7eb",
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    WebkitOverflowScrolling: "touch",
  },
  table: { width: "100%", minWidth: 900, borderCollapse: "collapse" },
  thead: { background: "#f9fafb" },
  th: { padding: "12px 16px", textAlign: "center", fontSize: 12, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" },
  tr: { borderBottom: "1px solid #f3f4f6" },
  td: { padding: "11px 16px", textAlign: "center", fontSize: 13, color: "#374151", whiteSpace: "nowrap" },
  emptyState: { padding: "32px 16px", textAlign: "center", fontSize: 13, color: "#9ca3af" },
  actions: { display: "flex", gap: 8, alignItems: "center", justifyContent: "center" },
  editBtn: { padding: "5px 12px", borderRadius: 5, border: "none", background: "#e53935", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 },
  delBtn: { padding: "5px 9px", borderRadius: 5, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 13 },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 },
  modal: { background: "#fff", borderRadius: 12, padding: "32px", width: 420, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" },
  modalMobile: { background: "#fff", borderRadius: 12, padding: "24px 20px", width: "100%", maxWidth: 420, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" },
  modalTitle: { margin: "0 0 24px", fontSize: 18, fontWeight: 700, color: "#1a1a2e" },
  modalField: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 },
  modalLabel: { fontSize: 13, fontWeight: 600, color: "#374151" },
  modalInput: { padding: "10px 14px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 14, outline: "none", color: "#111" },
  modalActions: { display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 },
  cancelBtn: { padding: "9px 20px", borderRadius: 7, border: "1.5px solid #d1d5db", background: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600 },
  saveBtn: { padding: "9px 24px", borderRadius: 7, border: "none", background: "linear-gradient(135deg, #e53935, #c62828)", color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 700 },
};
