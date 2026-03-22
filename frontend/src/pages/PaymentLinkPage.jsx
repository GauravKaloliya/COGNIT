import React from "react";
import { getErrorMessage } from "../utils/errorRegistry.js";
import { PAYMENT_API_FIELDS } from "../constants/fields";
import { uiText } from "../utils/uiText.js";
import PanelState from "../components/PanelState.jsx";
import PageSkeleton from "../components/PageSkeleton.jsx";
import SectionSkeleton from "../components/SectionSkeleton.jsx";
import { usePaymentLinkPage } from "../hooks/usePaymentLinkPage";
import DSButton from "../components/design/DSButton.jsx";

export default function PaymentLinkPage({
  onNext,
  publicId,
  sessionId,
  addToast,
  onParticipantNotFound,
}) {
  const {
    MAX_UPLOAD_MB,
    PAYMENT_AMOUNT_LABEL,
    paymentData,
    isLoading,
    paymentStatus,
    uploadFile,
    uploadPreviewUrl,
    verifying,
    error,
    failureReasons,
    refreshNotice,
    refreshNoticeVariant,
    lastServerStatus,
    restoreWarning,
    isOnline,
    fileInputRef,
    timeRemaining,
    isMobile,
    offlineDisabled,
    retryBlocked,
    retryInSeconds,
    retryButtonLabel,
    formatTime,
    getTimerColor,
    getButtonStyle,
    getQrContainerStyle,
    getVerificationErrorMessage,
    getPaymentRecoverySteps,
    createPayment,
    handleFileChange,
    clearSelectedFile,
    restartPayment,
    handleUploadAndFinalize,
    markQrVisible,
  } = usePaymentLinkPage({
    onNext,
    publicId,
    sessionId,
    addToast,
    onParticipantNotFound,
  });

  if (isLoading) {
    return (
      <PageSkeleton
        title={uiText("payment.creating")}
        subtitle={uiText("payment.pleaseWait")}
        variant="payment"
      />
    );
  }

  if (error && !paymentData) {
    return (
      <div className="panel payment-panel">
        <PanelState
          variant="error"
          title={uiText("payment.panelUnavailableTitle")}
          message={uiText("payment.panelUnavailableMessage", { error })}
          disabled={offlineDisabled}
        />
        <div className="payment-next-steps">
          <p><strong>{uiText("payment.nextStepsTitle")}</strong></p>
          <ul>
            {getPaymentRecoverySteps(failureReasons).map((step, idx) => (
              <li key={`err-step-${idx}`}>{step}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  if (paymentStatus === "expired") {
    return (
      <div className="panel payment-panel">
        <div className="payment-header">
          <div className="icon-badge" aria-hidden="true">⏳</div>
        </div>
        <div className="banner warning spaced">
          {error || getErrorMessage("PAY_001_0001")}
        </div>
        <div className="page-actions">
          <DSButton
            variant="primary"
            onClick={restartPayment}
            disabled={offlineDisabled}
          >
            {uiText("payment.startNewPayment")}
          </DSButton>
        </div>
      </div>
    );
  }

  if (paymentStatus === "rejected_fraud") {
    return (
      <div className="panel payment-panel">
        <div className="payment-header">
          <div className="icon-badge" aria-hidden="true">❌</div>
          <h2 className="payment-title">{uiText("payment.verifyTitle")}</h2>
          <p className="payment-subtitle">{uiText("payment.verifySubtitle")}</p>
        </div>
        <div className="banner warning spaced">
          {error || getErrorMessage("FRAUD_002_0009")}
        </div>
        {failureReasons.length > 0 && (
          <div className="payment-failure-details">
            <p><strong>{uiText("payment.verificationIssues")}</strong></p>
            <ul>
              {failureReasons.map((reason, index) => (
                <li key={index}>{getVerificationErrorMessage([reason])}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="payment-next-steps">
          <p><strong>{uiText("payment.howToFixTitle")}</strong></p>
          <ul>
            {getPaymentRecoverySteps(failureReasons).map((step, idx) => (
              <li key={`fraud-step-${idx}`}>{step}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="panel payment-panel">
      {offlineDisabled && (
        <div className="payment-locked-overlay" aria-hidden="true">
          <div className="payment-locked-card">
            <div className="payment-locked-icon">🔒</div>
            <p>{uiText("payment.offlineBanner")}</p>
          </div>
        </div>
      )}
      {!isOnline && (
        <div className="banner warning">
          <span>{uiText("payment.offlineBanner")}</span>
        </div>
      )}
      {refreshNotice && (
        <div className={`banner ${refreshNoticeVariant}`}>
          <span>{refreshNotice}</span>
        </div>
      )}
      {restoreWarning && (
        <div className="banner warning">
          <span>{restoreWarning}</span>
        </div>
      )}
      {lastServerStatus && (
        <div className="banner info">
          <span>Server status: {lastServerStatus}</span>
        </div>
      )}

      <div className="payment-header">
        <div className="icon-badge" aria-hidden="true">💳</div>
        <h2 className="payment-title">{isMobile ? uiText("payment.payWithUpi") : uiText("payment.scanVerify")}</h2>
        <p className="payment-subtitle">
          {timeRemaining > 0
            ? uiText("payment.timeRemaining", { time: formatTime(timeRemaining) })
            : uiText("payment.completeAndUpload")}
        </p>
      </div>

      <div className="payment-content">
        {paymentStatus === "pending" && (
          <div className="payment-qr-instructions-grid">
            {paymentData && (
              <section className="payment-card payment-card-qr card">
                <div className="card-header">
                  <h3>
                    <span className="icon-badge" aria-hidden="true">🔳</span>
                    {isMobile ? uiText("payment.payWithUpi") : uiText("payment.scanQr")}
                  </h3>
                </div>
                <div className="card-body">
                  <div className="payment-qr-container" style={!isMobile ? getQrContainerStyle() : undefined}>
                  {isMobile ? (
                    <a
                      href={paymentData[PAYMENT_API_FIELDS.upiLink]}
                      className="payment-upi-button"
                      onClick={(event) => {
                        if (offlineDisabled) {
                          event.preventDefault();
                          return;
                        }
                        event.preventDefault();
                        window.location.href = paymentData[PAYMENT_API_FIELDS.upiLink];
                      }}
                      aria-disabled={offlineDisabled}
                      tabIndex={offlineDisabled ? -1 : 0}
                      style={getButtonStyle()}
                    >
                      <span className="icon-badge" aria-hidden="true">📲</span>
                      <span>{uiText("payment.payWithApp", { amount: PAYMENT_AMOUNT_LABEL })}</span>
                      <span className="payment-upi-timer">
                        {paymentStatus === "expired" ? uiText("payment.expiredShort") : formatTime(timeRemaining)}
                      </span>
                    </a>
                  ) : (
                    <>
                      {paymentData[PAYMENT_API_FIELDS.qrBase64] ? (
                        <img
                          src={`data:image/png;base64,${paymentData[PAYMENT_API_FIELDS.qrBase64]}`}
                          alt={uiText("payment.qrAlt")}
                          className="payment-qr-code"
                          onLoad={markQrVisible}
                        />
                      ) : (
                        <div className="payment-qr-code" style={{ display: "grid", placeItems: "center" }}>
                          <SectionSkeleton
                            title={uiText("payment.loadingQrTitle")}
                            subtitle={uiText("payment.loadingQrSubtitle")}
                          />
                        </div>
                      )}
                      <p className="payment-note">{uiText("payment.scanAnyApp", { amount: PAYMENT_AMOUNT_LABEL })}</p>
                      <p className="payment-note" style={{ fontWeight: 600, color: getTimerColor() }}>
                        {paymentStatus === "expired" ? uiText("payment.expiredShort") : formatTime(timeRemaining)}
                      </p>
                    </>
                  )}
                  </div>

                  <div className="payment-status-badge pending two-col">
                    <span>⏱️</span>
                    {uiText("payment.pendingBadge")}
                  </div>
                </div>
              </section>
            )}

            <section className="payment-card highlight payment-card-instructions card">
              <div className="card-header">
                <h3>
                  <span className="icon-badge" aria-hidden="true">ℹ️</span>
                  {uiText("payment.instructionsTitle")}
                </h3>
              </div>
              <div className="card-body">
                <ul className="payment-steps compact">
                  <li>{uiText("payment.instructionsUseAmount", { amount: PAYMENT_AMOUNT_LABEL })}</li>
                  <li><strong>{uiText("payment.instructionsSupportedApps")}</strong></li>
                  <li>{uiText("payment.instructionsTakeScreenshot")}</li>
                  <li>{uiText("payment.instructionsUpload")}</li>
                  <li>
                    {timeRemaining > 0
                      ? uiText("payment.instructionsExpiresIn", { time: formatTime(timeRemaining) })
                      : uiText("payment.previousExpired")}
                  </li>
                </ul>
              </div>
            </section>
          </div>
        )}

        {error && (
          <div className="banner warning spaced">
            {error}
          </div>
        )}
        {error && (
          <div className="payment-next-steps">
            <p><strong>{uiText("payment.nextStepsTitle")}</strong></p>
            <ul>
              {getPaymentRecoverySteps(failureReasons).map((step, idx) => (
                <li key={`live-step-${idx}`}>{step}</li>
              ))}
            </ul>
          </div>
        )}

        {paymentStatus === "pending" && (
          <section className="payment-card card">
            <div className="card-header">
              <h3>
                <span className="icon-badge" aria-hidden="true">📤</span>
                {uiText("payment.uploadTitle")}
              </h3>
            </div>
            <div className="card-body">
              <p>{uiText("payment.uploadIntro")}</p>
            {verifying && (
              <div className="payment-verifying-text">
                {uiText("payment.verifyingText")}
              </div>
            )}
            <div className={`payment-upload-stack${verifying ? " is-verifying" : ""}`}>
              <div
                className="payment-upload-preview-box"
                onClick={() => {
                  if (!verifying && !offlineDisabled) {
                    fileInputRef.current?.click();
                  }
                }}
                role="button"
                tabIndex={verifying || offlineDisabled ? -1 : 0}
                aria-disabled={verifying || offlineDisabled}
                onKeyDown={(event) => {
                  if (verifying || offlineDisabled) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
              >
                {uploadPreviewUrl ? (
                  <img src={uploadPreviewUrl} alt="Payment screenshot preview" className="payment-upload-preview" />
                ) : (
                  <div className="payment-upload-placeholder">
                    <p>📷</p>
                    <p>{uiText("payment.clickToUpload")}</p>
                  </div>
                )}
              </div>

              <div className="payment-upload-meta-box">
                <div className="payment-upload-meta-head">
                  <p className="payment-upload-file-name">
                    {uploadFile ? `✅ ${uploadFile.name}` : uiText("payment.noImageSelected")}
                  </p>
                  <p className="payment-upload-file-meta">
                    {uploadFile ? (
                      <>
                        <span className="payment-upload-meta-line">
                          <strong>{uiText("payment.sizeLabel")}</strong> {(uploadFile.size / (1024 * 1024)).toFixed(2)}MB | Max: {MAX_UPLOAD_MB}MB
                        </span>
                        <span className="payment-upload-meta-line">
                          <strong>{uiText("payment.typeLabel")}</strong> {uploadFile.type || uiText("payment.typeUnknown")}
                        </span>
                      </>
                    ) : uiText("payment.allowedFormats", { size: MAX_UPLOAD_MB })}
                  </p>
                </div>

                <div className="payment-upload-guidance">
                  <p className="payment-upload-guidance-title">{uiText("payment.checklistTitle")}</p>
                  <ul>
                    <li>{uiText("payment.checklistStatus")}</li>
                    <li>{uiText("payment.checklistRecipient")}</li>
                    <li>{uiText("payment.checklistAmount", { amount: PAYMENT_AMOUNT_LABEL })}</li>
                    <li>{uiText("payment.checklistDateTime")}</li>
                  </ul>
                </div>

                <div className="payment-upload-verification-note">
                  {uiText("payment.keepTabOpen")}
                </div>

                <div className="page-actions sticky-mobile-actions payment-upload-actions">
                  <DSButton
                    variant="ghost"
                    className={uploadFile ? "danger" : ""}
                    type="button"
                    disabled={verifying || offlineDisabled}
                    onClick={() => {
                      if (offlineDisabled) return;
                      if (uploadFile) {
                        clearSelectedFile();
                        return;
                      }
                      fileInputRef.current?.click();
                    }}
                  >
                    {uploadFile ? uiText("payment.clearScreenshot") : uiText("payment.selectImage")}
                  </DSButton>
                  <DSButton
                    variant="primary"
                    onClick={handleUploadAndFinalize}
                    disabled={!uploadFile || verifying || offlineDisabled || retryBlocked}
                  >
                    {verifying
                      ? uiText("payment.verifyingAction")
                      : retryBlocked
                        ? retryButtonLabel
                        : uiText("payment.confirmPayment")}
                  </DSButton>
                </div>

              </div>

              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                onChange={handleFileChange}
                style={{ display: "none" }}
              />
            </div>
            </div>
          </section>
        )}

      </div>
    </div>
  );
}
