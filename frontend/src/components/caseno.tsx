// Case number for JSX: "<number>" and, for a case allocated through
// "Anything Urgent", a red bold "(Urgent)" right after it.
// (Plain-text places - Excel export, search, toasts - use utils/caseLabel.)
type Props = {
    c: { caseNumber?: string | null; isUrgent?: boolean };
    fallback?: string;
};

export default function CaseNo({ c, fallback = "" }: Props) {
    const n = c.caseNumber || fallback;
    return (
        <>
            {n}
            {c.isUrgent && n ? (
                <span style={{ color: "#DC2626", fontWeight: 700 }}> (Urgent)</span>
            ) : null}
        </>
    );
}
