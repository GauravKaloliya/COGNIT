import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import PaymentLinkPage from "../PaymentLinkPage.jsx";
import { usePaymentLinkPage } from "../../hooks/usePaymentLinkPage";
import { getErrorMessage } from "../../utils/errorRegistry.js";
import { PAYMENT_API_FIELDS } from "../../constants/fields";

vi.mock("../../hooks/usePaymentLinkPage", () => ({
  usePaymentLinkPage: vi.fn(),
}));

const baseHookState = {
  MAX_UPLOAD_MB: 10,
  PAYMENT_AMOUNT_LABEL: "₹1",
  paymentData: {
    [PAYMENT_API_FIELDS.id]: "pay_123",
    [PAYMENT_API_FIELDS.upiLink]: "upi://pay",
    [PAYMENT_API_FIELDS.qrBase64]: "abc123",
    [PAYMENT_API_FIELDS.expiresAt]: new Date(Date.now() + 60_000).toISOString(),
  },
  isLoading: false,
  paymentStatus: "pending",
  uploadFile: null,
  uploadPreviewUrl: "",
  verifying: false,
  error: null,
  failureReasons: [],
  refreshNotice: "",
  refreshNoticeVariant: "info",
  isOnline: true,
  fileInputRef: { current: null },
  timeRemaining: 45_000,
  isMobile: false,
  offlineDisabled: false,
  retryBlocked: false,
  retryButtonLabel: "Confirm Payment",
  retryInSeconds: 0,
  formatTime: vi.fn(() => "00:45"),
  getTimerColor: vi.fn(() => "#27ae60"),
  getButtonStyle: vi.fn(() => ({})),
  getQrContainerStyle: vi.fn(() => ({})),
  getVerificationErrorMessage: vi.fn(() => "Verification issue"),
  getPaymentRecoverySteps: vi.fn(() => ["Retry with a new screenshot."]),
  handleFileChange: vi.fn(),
  clearSelectedFile: vi.fn(),
  restartPayment: vi.fn(),
  handleUploadAndFinalize: vi.fn(),
  markQrVisible: vi.fn(),
};

describe("PaymentLinkPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the expired payment state with the shared error fallback", () => {
    usePaymentLinkPage.mockReturnValue({
      ...baseHookState,
      paymentStatus: "expired",
    });

    render(<PaymentLinkPage publicId="pub_123" sessionId="sess_1" />);

    expect(screen.getByText("Payment expired")).toBeInTheDocument();
    expect(screen.getByText(getErrorMessage("PAY_001_0001"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("renders the offline payment banner and lock overlay", () => {
    usePaymentLinkPage.mockReturnValue({
      ...baseHookState,
      isOnline: false,
      offlineDisabled: true,
    });

    render(<PaymentLinkPage publicId="pub_123" sessionId="sess_1" />);

    expect(screen.getAllByText("You're offline. Payment status may not update until you reconnect.").length).toBeGreaterThan(0);
    expect(screen.getByText("Scan with any UPI app to pay ₹1")).toBeInTheDocument();
  });
});
