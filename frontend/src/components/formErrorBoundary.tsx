import React from "react";

interface Props {
    children: React.ReactNode;
}

interface State {
    error: Error | null;
    info: React.ErrorInfo | null;
}

class FormErrorBoundary extends React.Component<Props, State> {
    state: State = { error: null, info: null };

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error("FormErrorBoundary caught:", error, info);
        this.setState({ info });
    }

    handleReset = () => {
        this.setState({ error: null, info: null });
    };

    render() {
        if (this.state.error) {
            return (
                <div style={{ padding: 24, fontFamily: "monospace" }}>
                    <h2 style={{ color: "#DC2626" }}>Form crashed</h2>
                    <p style={{ color: "#374151" }}>
                        This is the real error that was causing the blank screen. Copy this and
                        share it to get the exact fix.
                    </p>
                    <pre
                        style={{
                            background: "#FEF2F2",
                            border: "1px solid #FCA5A5",
                            borderRadius: 8,
                            padding: 16,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            color: "#991B1B",
                        }}
                    >
                        {this.state.error.message}
                        {"\n\n"}
                        {this.state.error.stack}
                        {this.state.info?.componentStack}
                    </pre>
                    <button
                        onClick={this.handleReset}
                        style={{
                            marginTop: 12,
                            padding: "8px 16px",
                            background: "#8B5CF6",
                            color: "#fff",
                            border: "none",
                            borderRadius: 8,
                            cursor: "pointer",
                        }}
                    >
                        Try again
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

export default FormErrorBoundary;
