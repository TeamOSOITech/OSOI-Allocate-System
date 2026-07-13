// Simple text-to-speech helper using the browser's built-in Web Speech API.
// No external service/API key needed — works in Chrome/Edge out of the box.
export function speak(text: string) {
    if (!("speechSynthesis" in window)) {
        console.warn("Speech synthesis not supported in this browser.");
        return;
    }
    window.speechSynthesis.cancel(); // stop any currently playing speech first
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-IN";
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
}
