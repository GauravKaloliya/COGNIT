import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SurveyPage from "../SurveyPage.jsx";
import { useSurveyPage } from "../../hooks/useSurveyPage";

vi.mock("../../hooks/useSurveyPage", async () => {
  const actual = await vi.importActual("../../hooks/useSurveyPage");
  return {
    ...actual,
    useSurveyPage: vi.fn(),
  };
});

const baseHookState = {
  constants: {
    minWords: 60,
    priorityWordTarget: 80,
    minDescriptionLength: 60,
    maxDescriptionLength: 10000,
    minFeedbackLength: 5,
    maxFeedbackLength: 2000,
    priorityFeedbackTarget: 30,
    uiTotalSteps: 5,
    copyPasteDisabled: true,
  },
  description: "",
  setDescription: vi.fn(),
  rating: 0,
  setRating: vi.fn(),
  comments: "",
  setComments: vi.fn(),
  isZoomed: false,
  setIsZoomed: vi.fn(),
  submitting: false,
  submitError: "",
  showValidationErrors: false,
  elapsed: 12,
  imageLoaded: false,
  imageError: false,
  imageReady: false,
  retryDisabled: false,
  retryCountdown: 0,
  wordCount: 0,
  charCount: 0,
  feedbackCount: 0,
  canSubmit: false,
  wordProgress: 0,
  feedbackProgress: 0,
  wordShortfall: 80,
  feedbackShortfall: 30,
  descriptionPriorityReady: false,
  feedbackPriorityReady: false,
  descriptionNoteIndex: 0,
  feedbackNoteIndex: 0,
  currentStep: 1,
  minimumMet: false,
  priorityMet: false,
  isOnline: true,
  submitLocked: false,
  descriptionRef: { current: null },
  commentsRef: { current: null },
  imageSrc: "https://example.com/image.png",
  cacheBustedSrc: "https://example.com/image.png?v=1",
  hasUsableSurveyImage: true,
  handleSubmit: vi.fn(),
  handleImageLoad: vi.fn(),
  handleImageError: vi.fn(),
  getSubmitTooltip: vi.fn(() => "Submit your response"),
  preventCopyPaste: vi.fn(),
  preventClipboardShortcuts: vi.fn(),
  draftRestored: false,
  saveError: "",
};

describe("SurveyPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the retry countdown when the next survey image is blocked", () => {
    useSurveyPage.mockReturnValue({
      ...baseHookState,
      imageLoaded: true,
      imageError: true,
      retryCountdown: 9,
    });

    render(
      <SurveyPage
        survey={{ image_id: "img_1", url: "https://example.com/image.png" }}
        publicId="pub_123"
      />
    );

    expect(screen.getByText("Image failed to load.")).toBeInTheDocument();
    expect(screen.getByText("Try again in 9s.")).toBeInTheDocument();
  });

  it("shows the locked submit state and shared tooltip copy", () => {
    useSurveyPage.mockReturnValue({
      ...baseHookState,
      imageLoaded: true,
      imageReady: true,
      canSubmit: true,
      submitLocked: true,
      getSubmitTooltip: vi.fn(() => "Please wait for the current save to finish."),
    });

    render(
      <SurveyPage
        survey={{ image_id: "img_1", url: "https://example.com/image.png" }}
        publicId="pub_123"
      />
    );

    const button = screen.getByRole("button", { name: "Please wait..." });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Please wait for the current save to finish.");
  });
});
