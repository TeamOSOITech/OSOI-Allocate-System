import SpeechRecognition, { useSpeechRecognition } from "react-speech-recognition";

const VoiceAssistant = () => {
    const { transcript, listening, resetTranscript, browserSupportsSpeechRecognition } =
        useSpeechRecognition();

    if (!browserSupportsSpeechRecognition) {
        return <h2>Your browser doesn't support Speech Recognition.</h2>;
    }

    return (
        <div
            style={{
                position: "fixed",
                bottom: 25,
                right: 25,
                width: 340,
                background: "#fff",
                borderRadius: 18,
                boxShadow: "0 15px 35px rgba(0,0,0,.15)",
                padding: 20,
                zIndex: 9999,
                fontFamily: "Segoe UI",
            }}
        >
            <h3
                style={{
                    margin: 0,
                    color: "#6D28D9",
                    marginBottom: 15,
                }}
            >
                🎤 AI Voice Assistant
            </h3>

            <div
                style={{
                    minHeight: 90,
                    background: "#F5F3FF",
                    borderRadius: 10,
                    padding: 12,
                    fontSize: 14,
                    marginBottom: 15,
                    wordBreak: "break-word",
                }}
            >
                {transcript || "Say something..."}
            </div>

            <p
                style={{
                    color: listening ? "green" : "gray",
                    fontWeight: 600,
                }}
            >
                {listening ? "🎙 Listening..." : "Microphone Off"}
            </p>

            <div
                style={{
                    display: "flex",
                    gap: 10,
                }}
            >
                <button
                    onClick={() =>
                        SpeechRecognition.startListening({
                            continuous: true,
                            language: "en-IN",
                        })
                    }
                    style={{
                        flex: 1,
                        padding: 12,
                        border: "none",
                        borderRadius: 10,
                        cursor: "pointer",
                        background: "#8B5CF6",
                        color: "#fff",
                        fontWeight: 600,
                    }}
                >
                    Start
                </button>

                <button
                    onClick={() => SpeechRecognition.stopListening()}
                    style={{
                        flex: 1,
                        padding: 12,
                        border: "none",
                        borderRadius: 10,
                        cursor: "pointer",
                        background: "#DC2626",
                        color: "#fff",
                        fontWeight: 600,
                    }}
                >
                    Stop
                </button>

                <button
                    onClick={resetTranscript}
                    style={{
                        flex: 1,
                        padding: 12,
                        border: "none",
                        borderRadius: 10,
                        cursor: "pointer",
                        background: "#6B7280",
                        color: "#fff",
                        fontWeight: 600,
                    }}
                >
                    Clear
                </button>
            </div>
        </div>
    );
};

export default VoiceAssistant;
