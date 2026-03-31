export const APP_ROUTES = {
  home: "/",
  apiProxy: "/api",
};

export const API_ROUTES = {
  health: "/health",
  participants: "/participants",
  participantOptions: "/participant-options",
  participantSession: "/participants/session",
  participantSessionPresence: "/participants/session/presence",
  participantSessionClose: "/participants/session/close",
  consent: "/consent",
  emailOtpRequest: "/email-otp/request",
  emailOtpVerify: "/email-otp/verify",
  submit: "/submit",
  clientError: "/client-errors",
  renewImageReservation: "/images/reservation/renew",
  checkUsername: (username) => `/check-username?username=${encodeURIComponent(username)}`,
  checkEmail: (email) => `/check-email?email=${encodeURIComponent(email)}`,
  randomImage: (queryString = "") => `/images/random${queryString ? `?${queryString}` : ""}`,
};
