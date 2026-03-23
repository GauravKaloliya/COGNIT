import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UserDetailsPage from "../UserDetailsPage.jsx";
import { useUserDetailsPage, sanitizeUsername } from "../../hooks/useUserDetailsPage";

vi.mock("../../hooks/useUserDetailsPage", async () => {
  const actual = await vi.importActual("../../hooks/useUserDetailsPage");
  return {
    ...actual,
    sanitizeUsername: vi.fn((value) => value),
    useUserDetailsPage: vi.fn(),
  };
});

const baseHookState = {
  constants: {
    ageMin: 13,
    ageMax: 100,
    usernameMin: 2,
    locationMin: 2,
  },
  isOnline: true,
  genderOptions: [{ value: "m", label: "Male" }],
  languageOptions: [{ value: "en", label: "English" }],
  priorExperienceGroups: [{ label: "Technical Skills", options: [{ value: "programming", label: "Programming" }] }],
  optionsLoading: false,
  errors: {},
  submitting: false,
  checking: { username: false, email: false },
  locating: false,
  locationStatus: "",
  locationPermissionDenied: false,
  locationPermissionState: "granted",
  manualLocationAllowed: true,
  locationAutoSucceeded: true,
  userEditedLocationRef: { current: false },
  isFormComplete: true,
  detectLocation: vi.fn(),
  otpDigits: ["1", "2", "3", "4", "5", "6"],
  otpLength: 6,
  showOtpField: true,
  otpStatus: "sent",
  otpError: "",
  otpExpirySeconds: 120,
  resendSeconds: 0,
  emailInputDisabled: false,
  inputsLocked: false,
  setOtpDigit: vi.fn(),
  setOtpFromPaste: vi.fn(),
  handleResend: vi.fn(),
  handleSubmit: vi.fn(),
  handleFieldBlur: vi.fn(),
  updateField: vi.fn(),
  draftRestored: false,
  saveError: "",
  retryCountdown: 0,
};

describe("UserDetailsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sanitizeUsername.mockImplementation((value) => value);
  });

  it("renders the OTP verification state with expiry and resend controls", () => {
    useUserDetailsPage.mockReturnValue(baseHookState);

    render(
      <UserDetailsPage
        publicId="pub_123"
        demographics={{ username: "kap", email: "kap@example.com", age: "22", location: "Delhi" }}
        setDemographics={vi.fn()}
        onSubmit={vi.fn()}
        onEmailVerified={vi.fn()}
        addToast={vi.fn()}
        systemReady
      />
    );

    expect(screen.getByText("Verification code")).toBeInTheDocument();
    expect(screen.getByText("Code expires in 2:00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resend code" })).toBeInTheDocument();
    expect(screen.getAllByRole("textbox").length).toBeGreaterThanOrEqual(8);
  });
});
