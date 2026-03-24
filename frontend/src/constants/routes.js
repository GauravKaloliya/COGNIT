export const APP_ROUTES = {
  home: "/",
  apiProxy: "/api",
};

export const API_ROUTES = {
  health: "/health",
  participants: "/participants",
  participantOptions: "/participant-options",
  participantSession: "/participants/session",
  participantPaymentStatus: (publicId) => `/participants/${publicId}/payment-status`,
  consent: "/consent",
  emailOtpRequest: "/email-otp/request",
  emailOtpVerify: "/email-otp/verify",
  submit: "/submit",
  createPayment: "/payments/create",
  refreshPaymentUpi: (paymentId) => `/payments/${paymentId}/refresh-upi`,
  paymentQr: (paymentId) => `/payments/${paymentId}/qr`,
  paymentStatus: (paymentId) => `/payments/${paymentId}/status`,
  paymentToken: (paymentId) => `/payments/${paymentId}/token`,
  paymentVerifyUpload: (paymentId) => `/payments/${paymentId}/verify-upload`,
  clientError: "/client-errors",
  checkUsername: (username) => `/check-username?username=${encodeURIComponent(username)}`,
  checkEmail: (email) => `/check-email?email=${encodeURIComponent(email)}`,
  randomImage: (queryString = "") => `/images/random${queryString ? `?${queryString}` : ""}`,
};
