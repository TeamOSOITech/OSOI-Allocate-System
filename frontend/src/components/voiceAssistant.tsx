import { useState, useEffect, useRef } from "react";
import SpeechRecognition, { useSpeechRecognition } from "react-speech-recognition";
import { parseVoiceCommand } from "../utils/voiceCommandParser";
import { speak } from "../utils/speak";

interface VoiceAssistantProps {
    onFillForm: (data: any) => void;
    onRequestSubmit?: () => void;
}

const VoiceAssistant = ({ onFillForm, onRequestSubmit }: VoiceAssistantProps) => {
    const { transcript, listening, resetTranscript, browserSupportsSpeechRecognition } =
        useSpeechRecognition();

    const [language, setLanguage] = useState<"en-IN" | "hi-IN">("en-IN");
    const [isOpen, setIsOpen] = useState(false);

    // Speech recognition can stop listening on its own (e.g. after a pause
    // in speech) without the person ever pressing "Stop". These refs let us
    // detect that transition and still process whatever was said, instead
    // of silently leaving the transcript unfilled.
    const wasListeningRef = useRef(false);
    const lastProcessedRef = useRef("");

    const processTranscript = (rawTranscript: string) => {
        if (!rawTranscript.trim() || rawTranscript === lastProcessedRef.current) return;
        lastProcessedRef.current = rawTranscript;

        const result = parseVoiceCommand(rawTranscript);
        console.log("Transcript:", rawTranscript);
        console.log("Parsed Result:", result);

        if (result.intent === "SUBMIT_FORM") {
            speak("Submitting the form.");

            if (onRequestSubmit) {
                setTimeout(() => onRequestSubmit(), 300);
            }
        } else if (result.intent === "ADD_USER") {
            onFillForm(result.data);
            // Clear the transcript once it's been applied to the form so the
            // next command starts fresh instead of re-parsing this text too.
            resetTranscript();
            lastProcessedRef.current = "";

            if (result.wantsSubmit && onRequestSubmit) {
                speak(
                    language === "hi-IN"
                        ? "विवरण भर दिए गए हैं। अभी सबमिट कर रहा हूँ।"
                        : "Details filled in. Submitting now."
                );
                setTimeout(() => onRequestSubmit(), 300);
            } else {
                speak(
                    language === "hi-IN"
                        ? "मैंने विवरण भर दिया है। कृपया जाँच करें और सबमिट करें।"
                        : "I've filled in the details. Please review and submit."
                );
            }
        } else {
            speak(
                language === "hi-IN"
                    ? "माफ़ कीजिए, मैं समझ नहीं पाया। कृपया दोबारा कोशिश करें।"
                    : "Sorry, I didn't understand that. Please try again."
            );
        }
    };

    // Fires whenever listening flips from true -> false, whether that was
    // a manual "Stop" click or the browser ending recognition by itself.
    useEffect(() => {
        if (wasListeningRef.current && !listening) {
            processTranscript(transcript);
        }
        wasListeningRef.current = listening;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [listening]);

    if (!browserSupportsSpeechRecognition) {
        return null;
    }

    const handleStop = () => {
        SpeechRecognition.stopListening();
        // Processing itself happens in the effect above once `listening`
        // actually flips to false — this keeps manual-stop and auto-stop
        // going through the exact same code path.
    };

    // Collapsed state — just a small floating mic icon.
    // Closing the panel does NOT touch transcript/listening state,
    // so nothing entered is lost when reopened.
    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                aria-label="Open voice assistant"
                style={{
                    position: "fixed",
                    bottom: 25,
                    right: 25,
                    width: 56,
                    height: 56,
                    borderRadius: "50%",
                    border: "none",
                    background: "linear-gradient(135deg, #08A1CE, #204297)",
                    color: "#fff",
                    fontSize: 24,
                    cursor: "pointer",
                    boxShadow: "0 8px 20px rgba(32,66,151,0.4)",
                    zIndex: 9999,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                🎤
            </button>
        );
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
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 15,
                    gap: 8,
                }}
            >
                <h3 style={{ margin: 0, color: "#204297", fontSize: 16, flex: 1 }}>
                    🎤 AI Voice Assistant
                </h3>
                <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value as "en-IN" | "hi-IN")}
                    style={{
                        fontSize: 12,
                        padding: "4px 8px",
                        borderRadius: 6,
                        border: "1px solid #b6def0",
                        color: "#204297",
                        background: "#eef6fb",
                        cursor: "pointer",
                        flexShrink: 0,
                    }}
                >
                    <option value="en-IN">English</option>
                    <option value="hi-IN">हिंदी</option>
                </select>
                <button
                    onClick={() => setIsOpen(false)}
                    aria-label="Close voice assistant"
                    style={{
                        border: "none",
                        background: "#f3f4f6",
                        color: "#6b7280",
                        borderRadius: "50%",
                        width: 26,
                        height: 26,
                        fontSize: 13,
                        cursor: "pointer",
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    ✕
                </button>
            </div>

            <div
                style={{
                    minHeight: 90,
                    background: "#eef6fb",
                    borderRadius: 10,
                    padding: 12,
                    fontSize: 14,
                    marginBottom: 15,
                    wordBreak: "break-word",
                }}
            >
                {transcript || "Say something..."}
            </div>

            <p style={{ color: listening ? "#2EBBA8" : "gray", fontWeight: 600 }}>
                {listening ? "🎙 Listening..." : "Microphone Off"}
            </p>

            <div style={{ display: "flex", gap: 10 }}>
                <button
                    onClick={() =>
                        SpeechRecognition.startListening({
                            continuous: true,
                            language,
                        })
                    }
                    style={{
                        flex: 1,
                        padding: 12,
                        border: "none",
                        borderRadius: 10,
                        cursor: "pointer",
                        background: "#08A1CE",
                        color: "#fff",
                        fontWeight: 600,
                    }}
                >
                    Start
                </button>

                <button
                    onClick={handleStop}
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
