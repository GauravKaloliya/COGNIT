import React, { useState, useEffect } from "react";

export default function ConsentPage({ 
  onConsentGiven, 
  systemReady 
}) {
  const [consentChecked, setConsentChecked] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = "Consent Form - C.O.G.N.I.T.";
  }, []);

  const getErrorMessage = (err) => {
    const message = err?.message || "";
    if (message.toLowerCase().includes("expected pattern")) {
      return "Unable to reach the server. Please check your connection and try again.";
    }
    return message || "Failed to record consent. Please try again.";
  };

  const handleSubmit = async () => {
    if (!systemReady) {
      setError("System is not ready. Please wait for the connection to be established.");
      return;
    }

    if (!consentChecked) {
      setError("You must consent to participate in this research");
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      await onConsentGiven();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="panel">
      <h2>C.O.G.N.I.T. Consent Form for Research Participation</h2>
      <p className="page-subtitle left">
        We sincerely appreciate you considering being part of this work.
      </p>
      
      <div className="welcome-info">
        <h3>Purpose of the Study</h3>
        <p>
          The C.O.G.N.I.T. (Cognitive Network for Image & Text Modeling) project investigates how humans interpret and verbally describe visual scenes. Your descriptions contribute to research on perceptual processes, linguistic expression of visual experience, and cognitive mechanisms of scene understanding.
        </p>
        <p>
          The findings support peer-reviewed cognitive science research and the responsible development of interpretable, multimodal AI systems.
        </p>

        <h3>What Participation Involves</h3>
        <p>If you choose to participate, you will:</p>
        <ul>
          <li>Create an account using a valid Indian mobile number and supported email provider</li>
          <li>Provide minimal demographic information (age group, gender, state/UT, primary language)</li>
          <li>Complete a brief practice trial</li>
          <li>View a sequence of everyday and abstract images</li>
          <li>Write detailed, natural descriptions for each image (minimum 60 words)</li>
          <li>Indicate perceived image complexity on a 1–10 scale</li>
          <li>Respond to a small number of instruction-verification items designed to ensure attentive participation</li>
        </ul>
        <p><strong>Estimated duration:</strong> 15–20 minutes.</p>
        <p>You may pause or discontinue at any time. If platform functionality allows, you may resume later.</p>

        <h3>Data Quality and Participation Integrity</h3>
        <p>To maintain scientific validity:</p>
        <ul>
          <li>The platform uses automated systems to evaluate response completeness, instruction compliance, timing consistency, and engagement patterns.</li>
          <li>Some trials are designed to verify that instructions are being carefully followed.</li>
          <li>Repeated failure to follow instructions or patterns indicating inattentive participation may result in temporary or permanent restriction from continuing the task.</li>
          <li>These quality assessments are conducted algorithmically and are applied uniformly to all participants.</li>
          <li>The exact validation thresholds are not disclosed in order to preserve research integrity.</li>
        </ul>

        <h3>Your Rights</h3>
        <p>Participation is entirely voluntary.</p>
        <p>You may:</p>
        <ul>
          <li>Decline to answer any question</li>
          <li>Withdraw at any time without penalty</li>
          <li>Request deletion of your data after participation</li>
        </ul>
        <p>To withdraw or request deletion, contact: <a href="mailto:research@cognit.org"><strong>research@cognit.org</strong></a></p>
        <p>We aim to respond within 48 hours.</p>
        <p>Early withdrawal before task completion means you will not be entered into the reward draw.</p>

        <h3>Compensation Structure</h3>
        <ul>
          <li><strong>Nominal platform access fee:</strong> ₹1 (non-refundable)</li>
          <li><strong>Reward draw:</strong> Randomly selected participants receive ₹10 via UPI (typically within 24–48 hours)</li>
        </ul>
        <p>
          Participants demonstrating consistent, attentive, and high-quality engagement may receive priority weighting in reward allocation. Quality is assessed using objective behavioral metrics such as response completeness, instruction compliance, and engagement consistency. Receipt of any reward is not guaranteed.
        </p>

        <h3>Data Protection and Confidentiality</h3>
        <p>We collect:</p>
        <ul>
          <li>Account identifiers (username, contact information)</li>
          <li>Basic demographics (age group, gender, Indian state/UT, primary language)</li>
          <li>Image descriptions and complexity ratings</li>
          <li>Limited behavioral metadata (response timing, instruction compliance indicators)</li>
        </ul>
        <p>Safeguards include:</p>
        <ul>
          <li>Separation of contact information from research data</li>
          <li>Irreversible cryptographic hashing of IP addresses</li>
          <li>Storage under randomized research identifiers</li>
          <li>Encryption in transit and at rest</li>
          <li>Access restricted to named principal investigators and authorized personnel under strict confidentiality agreements</li>
          <li>Publication only of fully anonymized, aggregated statistics or de-identified excerpts that cannot be traced to individuals</li>
        </ul>
        <p>
          Your data will be used exclusively for scientific research and ethical AI development. No commercial marketing, profiling, or resale will occur.
        </p>

        <h3>Foreseeable Risks and Burdens</h3>
        <p>The anticipated burdens are minimal:</p>
        <ul>
          <li>15–20 minutes of focused attention</li>
          <li>Possible mild cognitive fatigue from descriptive writing</li>
        </ul>
        <p>No physical, emotional, legal, or financial risks beyond ordinary internet usage are expected.</p>

        <h3>Eligibility Requirements</h3>
        <p>By proceeding, you confirm that you:</p>
        <ul>
          <li>Are currently located in India</li>
          <li>Are 13 years of age or older</li>
          <li>Possess a valid 10-digit Indian mobile number</li>
          <li>Have access to a supported email provider</li>
          <li>Are comfortable reading and writing in English</li>
          <li>Understand that the ₹1 access fee is non-refundable</li>
        </ul>

        <h3>Contact Information</h3>
        <p>For questions, concerns, complaints, or data deletion requests:</p>
        <p><strong>Email:</strong> <a href="mailto:research@cognit.org">research@cognit.org</a></p>

        <h3>Statement of Consent</h3>
        <p>By selecting "I Consent & Proceed", you confirm that you:</p>
        <ul>
          <li>Have carefully read and understood this information</li>
          <li>Freely and voluntarily agree to participate</li>
          <li>Understand that automated systems evaluate participation quality</li>
          <li>Acknowledge that participation may be limited if instruction-verification checks are repeatedly failed</li>
          <li>Understand that anonymized contributions may appear in scientific publications or conference presentations in aggregated or de-identified form</li>
          <li>Know you may stop at any time and later request deletion of your records</li>
        </ul>
        <p>
          Your thoughtful participation advances scientific understanding of human vision-language interaction and supports the development of more interpretable, equitable AI systems.
        </p>
      </div>
      
      {error && (
        <div className="banner warning spaced">
          {error}
        </div>
      )}
      
      <div className={`consent-checkbox ${error && !consentChecked ? 'error' : ''}`}>
        <input
          type="checkbox"
          checked={consentChecked}
          onChange={(e) => {
            setConsentChecked(e.target.checked);
            if (error) setError(null);
          }}
          id="consent-check"
        />
        <label htmlFor="consent-check">
          <strong>I consent to participate in this research</strong>
          <p className="consent-note">
            I confirm that I have read and understood the consent information above and voluntarily agree to participate.
          </p>
        </label>
      </div>
      
      <div className="page-actions">
        <button
          className="primary"
          onClick={handleSubmit}
          disabled={!systemReady || submitting || !consentChecked}
        >
          {submitting ? "Processing..." : "Continue"}
        </button>
      </div>
    </div>
  );
}