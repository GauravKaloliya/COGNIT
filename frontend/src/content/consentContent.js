export const CONSENT_CONTENT = {
  title: "C.O.G.N.I.T. Consent Form for Research Participation",
  subtitle: "We sincerely appreciate you considering being part of this work.",
  sections: [
    {
      heading: "Purpose of the Study",
      paragraphs: [
        "The C.O.G.N.I.T. (Cognitive Network for Image & Text Modeling) project investigates how humans interpret and verbally describe visual scenes. Your descriptions contribute to research on perceptual processes, linguistic expression of visual experience, and cognitive mechanisms of scene understanding.",
        "The findings support peer-reviewed cognitive science research and the responsible development of interpretable, multimodal AI systems.",
      ],
    },
    {
      heading: "What Participation Involves",
      intro: "If you choose to participate, you will:",
      items: [
        "Create an account using a supported email provider",
        "Provide minimal demographic information (age group, gender, state/UT, primary language)",
        "Complete a brief practice survey",
        "View a sequence of everyday and abstract images",
        "Write detailed, natural descriptions for each image (minimum 60 words)",
        "Indicate perceived image complexity on a 1-10 scale",
        "Respond to a small number of instruction-verification items designed to ensure attentive participation",
      ],
      paragraphs: [
        "Estimated duration: 5-10 minutes.",
        "You may pause or discontinue at any time. If platform functionality allows, you may resume later.",
      ],
    },
    {
      heading: "Data Quality and Participation Integrity",
      intro: "To maintain scientific validity:",
      items: [
        "The platform uses automated systems to evaluate response completeness, instruction compliance, timing consistency, and response-behavior patterns.",
        "Some surveys are designed to verify that instructions are being carefully followed.",
        "Repeated failure to follow instructions or patterns indicating inattentive participation may result in temporary or permanent restriction from continuing the task.",
        "These quality assessments are conducted algorithmically and are applied uniformly to all participants.",
        "The exact validation thresholds are not disclosed in order to preserve research integrity.",
      ],
    },
    {
      heading: "Your Rights",
      paragraphs: [
        "Participation is entirely voluntary.",
        "You may:",
      ],
      items: ["Withdraw at any time without penalty"],
      outro: "Early withdrawal before task completion means you will not be entered into the reward draw.",
    },
    {
      heading: "Compensation Structure",
      dynamicList: true,
      paragraphs: [
        "Participants demonstrating consistent, attentive, and high-quality responses may receive priority in reward allocation. Quality is assessed using objective behavioral metrics such as response completeness, instruction compliance, and response consistency. Receipt of any reward is not guaranteed.",
      ],
    },
    {
      heading: "Data Protection and Confidentiality",
      intro: "We collect:",
      items: [
        "Account identifiers (username, contact information)",
        "Basic demographics (age group, gender, Indian state/UT, primary language)",
        "Image descriptions and complexity ratings",
        "Limited behavioral metadata (response timing, instruction compliance indicators)",
      ],
      secondaryIntro: "Safeguards include:",
      secondaryItems: [
        "Separation of contact information from research data",
        "Irreversible cryptographic hashing of IP addresses",
        "Storage under randomized research identifiers",
        "Encryption in transit and at rest",
        "Access restricted to named principal investigators and authorized personnel under strict confidentiality agreements",
        "Publication only of fully anonymized, aggregated statistics or de-identified excerpts that cannot be traced to individuals",
      ],
      outro: "Your data will be used exclusively for scientific research and ethical AI development. No commercial marketing, profiling, or resale will occur.",
    },
    {
      heading: "Eligibility Requirements",
      intro: "By proceeding, you confirm that you:",
      items: [
        "Are currently located in India",
        "Are 13 years of age or older",
        "Have access to a supported email provider",
        "Are comfortable reading and writing in English",
      ],
    },
    {
      heading: "Contact Information",
      paragraphs: [
        "For questions, concerns, or complaints:",
      ],
      contactEmail: "research@cognit.online",
    },
    {
      heading: "Statement of Consent",
      intro: "By selecting \"I Consent & Proceed\", you confirm that you:",
      items: [
        "Have carefully read and understood this information",
        "Freely and voluntarily agree to participate",
        "Understand that automated systems evaluate participation quality",
        "Acknowledge that participation may be limited if instruction-verification checks are repeatedly failed",
        "Understand that anonymized contributions may appear in scientific publications or conference presentations in aggregated or de-identified form",
        "Know you may stop at any time",
      ],
      outro: "Your thoughtful participation advances scientific understanding of human vision-language interaction and supports the development of more interpretable, equitable AI systems.",
    },
  ],
  actionRequiredTitle: "Action required",
  checkboxTitle: "I consent to participate in this research",
  checkboxNote: "I confirm that I have read and understood the consent information above and voluntarily agree to participate.",
};
