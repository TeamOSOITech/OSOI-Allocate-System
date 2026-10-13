// Service worker: shows system notifications even when the app is closed /
// the employee is logged out. Served from the site root (/sw.js).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

function readPayload(event) {
    try {
        return event.data ? event.data.json() : {};
    } catch {
        return {};
    }
}

self.addEventListener("push", (event) => {
    const data = readPayload(event);
    event.waitUntil(
        self.registration.showNotification(data.title || "Alookate", {
            body: data.body || "You have a new notification.",
            icon: "/Logo2.png",
            data: { url: data.url || "/" },
        })
    );
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const url = (event.notification.data && event.notification.data.url) || "/";
    event.waitUntil(
        self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
            for (const c of list) {
                if ("focus" in c) return c.focus();
            }
            return self.clients.openWindow(url);
        })
    );
});
