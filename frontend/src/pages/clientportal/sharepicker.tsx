// src/pages/clientportal/sharepicker.tsx
//
// Replaces the row of tabs on "Shared with me" / the Client Dashboard.
//   - up to `tabLimit` shares (default 1): the same pill tabs as before
//   - more than that (e.g. 50 clients): one dropdown with search, a "3 of 50"
//     counter and prev / next arrows, so the page never fills with 50 buttons.
import { useEffect, useMemo, useRef, useState } from "react";
import { fontFamily, fontSize, fontWeight, radius } from "../../styles/theme";

export type ShareItem = {
    id: string;
    title: string; // client name (or the page label if there is no client)
    subtitle?: string; // page label, e.g. "Production Reports"
    isNew?: boolean;
};

const INK = "#1B2150";
const MUTED = "#667094";
const LINE = "#E3E7F4";
const BRAND = "var(--brand-blue, #3B4AB8)";

const CSS = `
.shp-btn:focus-visible, .shp-arrow:focus-visible, .shp-opt:focus-visible, .shp-search:focus-visible { outline: 3px solid #A9B4F2; outline-offset: 2px; }
.shp-arrow { width: 40px; height: 40px; border-radius: 12px; border: 1px solid ${LINE}; background: #fff; color: ${INK}; cursor: pointer; font-size: 18px; flex-shrink: 0; }
.shp-arrow:hover:not([disabled]) { background: #F3F5FD; }
.shp-arrow[disabled] { opacity: .4; cursor: not-allowed; }
.shp-opt { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; padding: 10px 12px; border: 0; border-radius: 12px; background: transparent; cursor: pointer; font-family: inherit; color: ${INK}; }
.shp-opt[data-hi="true"] { background: #F3F5FD; }
.shp-opt[aria-selected="true"] { background: #ECEFFB; }
.shp-list::-webkit-scrollbar { width: 8px; }
.shp-list::-webkit-scrollbar-thumb { background: #CBD2EC; border-radius: 8px; }
`;

const tile = (size: number): React.CSSProperties => ({
    width: size,
    height: size,
    borderRadius: 12,
    background: "#ECEFFB",
    color: "#3B4AB8",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: size / 2,
    flexShrink: 0,
});

const NewBadge = () => (
    <span
        style={{
            background: "#E6E2FB",
            color: "#5B47C9",
            borderRadius: 999,
            padding: "1px 8px",
            fontSize: 11,
            fontWeight: 700,
        }}
    >
        New
    </span>
);

export default function SharePicker({
    items,
    activeId,
    onPick,
    tabLimit = 1,
    compact = false,
}: {
    items: ShareItem[];
    activeId: string;
    onPick: (id: string) => void;
    tabLimit?: number;
    /** inside the report hero: full-width of its column, no bottom margin */
    compact?: boolean;
}) {
    const useTabs = !compact && items.length <= tabLimit;

    // picker mode: new shares first, then A-Z (prev/next follow this order)
    const list = useMemo(
        () =>
            useTabs
                ? items
                : [...items].sort(
                      (a, b) =>
                          Number(!!b.isNew) - Number(!!a.isNew) || a.title.localeCompare(b.title)
                  ),
        [items, useTabs]
    );

    const [open, setOpen] = useState(false);
    const [q, setQ] = useState("");
    const [hi, setHi] = useState(0);
    const wrap = useRef<HTMLDivElement>(null);
    const btn = useRef<HTMLButtonElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const idx = list.findIndex((i) => i.id === activeId);
    const cur = list[idx];
    const shown = useMemo(() => {
        const s = q.trim().toLowerCase();
        return s
            ? list.filter((i) => `${i.title} ${i.subtitle || ""}`.toLowerCase().includes(s))
            : list;
    }, [list, q]);

    const close = () => {
        setOpen(false);
        setQ("");
    };
    const choose = (id: string) => {
        onPick(id);
        close();
        btn.current?.focus();
    };

    useEffect(() => {
        if (!open) return;
        const on = (e: MouseEvent) => {
            if (!wrap.current?.contains(e.target as Node)) close();
        };
        document.addEventListener("mousedown", on);
        return () => document.removeEventListener("mousedown", on);
    }, [open]);
    useEffect(() => setHi(0), [q]);
    useEffect(() => {
        if (open)
            (listRef.current?.children[hi] as HTMLElement | undefined)?.scrollIntoView({
                block: "nearest",
            });
    }, [hi, open]);

    // compact (hero) mode with a single share: the hero already names the client
    if (compact && items.length <= 1) return null;

    /* ---------- few shares: the familiar tabs ---------- */
    if (useTabs) {
        return (
            <div
                role="tablist"
                style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}
            >
                {items.map((p) => {
                    const on = p.id === activeId;
                    return (
                        <button
                            key={p.id}
                            role="tab"
                            aria-selected={on}
                            onClick={() => onPick(p.id)}
                            style={{
                                padding: "9px 18px",
                                borderRadius: radius.lg,
                                border: on ? `1px solid ${BRAND}` : "1px solid #D9DEEE",
                                background: on ? BRAND : "#fff",
                                color: on ? "#fff" : "#2b2a3a",
                                fontSize: fontSize.base,
                                fontWeight: fontWeight.semibold,
                                fontFamily: fontFamily.base,
                                cursor: "pointer",
                            }}
                        >
                            <i
                                className="ti ti-file-text"
                                aria-hidden="true"
                                style={{ marginRight: 8 }}
                            />
                            {p.subtitle ? `${p.subtitle} — ${p.title}` : p.title}
                        </button>
                    );
                })}
            </div>
        );
    }

    /* ---------- many shares: one searchable dropdown ---------- */
    return (
        <div
            ref={wrap}
            style={{
                position: "relative",
                marginBottom: compact ? 0 : 18,
                fontFamily: fontFamily.base,
                maxWidth: compact ? 420 : 560,
                width: compact ? "100%" : undefined,
            }}
        >
            <style>{CSS}</style>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                    className="shp-arrow"
                    aria-label="Previous client"
                    disabled={idx <= 0}
                    onClick={() => onPick(list[idx - 1].id)}
                >
                    <i className="ti ti-chevron-left" aria-hidden="true" />
                </button>

                <button
                    ref={btn}
                    className="shp-btn"
                    aria-haspopup="listbox"
                    aria-expanded={open}
                    onClick={() => {
                        setQ("");
                        setHi(Math.max(0, idx));
                        setOpen((o) => !o);
                    }}
                    style={{
                        flex: 1,
                        minWidth: 0,
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "8px 14px 8px 8px",
                        background: "#fff",
                        border: `1px solid ${open ? "#8F9CE8" : LINE}`,
                        borderRadius: 14,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        color: INK,
                        textAlign: "left",
                        boxShadow: open ? "0 0 0 3px rgba(59,74,184,.12)" : "none",
                    }}
                >
                    <span style={tile(40)}>
                        <i className="ti ti-building" aria-hidden="true" />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                        <span
                            style={{
                                display: "block",
                                fontSize: 14.5,
                                fontWeight: 700,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                            }}
                        >
                            {cur?.title || "Choose a client"}
                        </span>
                        {cur?.subtitle && (
                            <span style={{ display: "block", fontSize: 12, color: MUTED }}>
                                {cur.subtitle}
                            </span>
                        )}
                    </span>
                    <span
                        style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: MUTED,
                            whiteSpace: "nowrap",
                        }}
                    >
                        {idx + 1} of {list.length}
                    </span>
                    <i
                        className="ti ti-selector"
                        aria-hidden="true"
                        style={{ color: MUTED, fontSize: 18 }}
                    />
                </button>

                <button
                    className="shp-arrow"
                    aria-label="Next client"
                    disabled={idx < 0 || idx >= list.length - 1}
                    onClick={() => onPick(list[idx + 1].id)}
                >
                    <i className="ti ti-chevron-right" aria-hidden="true" />
                </button>
            </div>

            {open && (
                <div
                    style={{
                        position: "absolute",
                        zIndex: 20,
                        top: "calc(100% + 8px)",
                        left: compact ? 0 : 48,
                        right: compact ? 0 : 48,
                        background: "#fff",
                        border: `1px solid ${LINE}`,
                        borderRadius: 16,
                        boxShadow: "0 16px 40px rgba(27,33,80,.16)",
                        padding: 10,
                    }}
                >
                    <div style={{ position: "relative", marginBottom: 8 }}>
                        <i
                            className="ti ti-search"
                            aria-hidden="true"
                            style={{
                                position: "absolute",
                                left: 12,
                                top: 11,
                                color: MUTED,
                                fontSize: 16,
                            }}
                        />
                        <input
                            autoFocus
                            className="shp-search"
                            type="search"
                            value={q}
                            placeholder={`Search ${list.length} clients`}
                            aria-label="Search clients"
                            onChange={(e) => setQ(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "ArrowDown") {
                                    e.preventDefault();
                                    setHi((h) => Math.min(shown.length - 1, h + 1));
                                } else if (e.key === "ArrowUp") {
                                    e.preventDefault();
                                    setHi((h) => Math.max(0, h - 1));
                                } else if (e.key === "Enter") {
                                    e.preventDefault();
                                    if (shown[hi]) choose(shown[hi].id);
                                } else if (e.key === "Escape") {
                                    close();
                                    btn.current?.focus();
                                }
                            }}
                            style={{
                                width: "100%",
                                height: 40,
                                padding: "0 12px 0 34px",
                                border: `1px solid ${LINE}`,
                                borderRadius: 12,
                                font: `500 14px ${fontFamily.base}`,
                                color: INK,
                                background: "#fff",
                                boxSizing: "border-box",
                            }}
                        />
                    </div>

                    <div
                        ref={listRef}
                        className="shp-list"
                        role="listbox"
                        aria-label="Clients"
                        style={{ maxHeight: 320, overflowY: "auto" }}
                    >
                        {shown.map((it, i) => (
                            <button
                                key={it.id}
                                role="option"
                                aria-selected={it.id === activeId}
                                data-hi={i === hi}
                                className="shp-opt"
                                onMouseEnter={() => setHi(i)}
                                onClick={() => choose(it.id)}
                            >
                                <span style={tile(34)}>
                                    <i className="ti ti-building" aria-hidden="true" />
                                </span>
                                <span style={{ flex: 1, minWidth: 0 }}>
                                    <span
                                        style={{
                                            display: "block",
                                            fontSize: 14,
                                            fontWeight: 700,
                                            whiteSpace: "nowrap",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                        }}
                                    >
                                        {it.title}
                                    </span>
                                    {it.subtitle && (
                                        <span
                                            style={{ display: "block", fontSize: 12, color: MUTED }}
                                        >
                                            {it.subtitle}
                                        </span>
                                    )}
                                </span>
                                {it.isNew && <NewBadge />}
                                {it.id === activeId && (
                                    <i
                                        className="ti ti-check"
                                        aria-hidden="true"
                                        style={{ color: "#3B4AB8", fontSize: 18 }}
                                    />
                                )}
                            </button>
                        ))}
                        {shown.length === 0 && (
                            <div
                                style={{
                                    padding: "22px 12px",
                                    textAlign: "center",
                                    color: MUTED,
                                    fontSize: 13.5,
                                }}
                            >
                                No client matches “{q}”.
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
