const success = (res, data, message = "Success", status = 200) =>
  res.status(status).json({ success: true, message, data });

const error = (res, message = "Error", status = 400) =>
  res.status(status).json({ success: false, message });

// Raw error text is only sent to the client outside production, or when
// EXPOSE_ERROR_DETAIL=true is set on the server (handy for debugging a
// deployed build). The frontend's authFetch prints it in the browser console.
const exposeDetail = () =>
  process.env.NODE_ENV !== "production" ||
  process.env.EXPOSE_ERROR_DETAIL === "true";

const errorDetail = (err) =>
  exposeDetail() && err?.message ? { detail: err.message } : {};

const GENERIC_MESSAGES = {
  400: "Request failed. Please check your input and try again.",
  401: "Authentication failed. Please log in again.",
  403: "You do not have permission to do this.",
  404: "Requested resource was not found.",
  500: "Something went wrong on our end. Please try again.",
};

// Always logs the full error server-side, sends the client a generic
// message. Set `err.expose = true` on an error to pass its message through
// (for intentional, user-facing validation errors).
const sendError = (res, err, status = 500, message) => {
  const req = res.req;
  console.error(`[${req?.method} ${req?.originalUrl}] ${status}:`, err);

  const finalMessage =
    err?.expose === true && err?.message
      ? err.message
      : message || GENERIC_MESSAGES[status] || GENERIC_MESSAGES[500];

  return res
    .status(status)
    .json({ success: false, message: finalMessage, ...errorDetail(err) });
};

module.exports = { success, error, sendError, errorDetail };
