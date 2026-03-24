import { uiText } from "../utils/uiText";

export const CONSENT_CONTENT = {
  title: uiText("consent.contentTitle"),
  subtitle: uiText("consent.contentSubtitle"),
  sections: [
    {
      heading: uiText("consent.sectionPurpose"),
      paragraphs: [
        uiText("consent.sectionPurposeP1"),
        uiText("consent.sectionPurposeP2"),
      ],
    },
    {
      heading: uiText("consent.sectionParticipation"),
      intro: uiText("consent.sectionParticipationIntro"),
      items: [
        uiText("consent.sectionParticipationItem1"),
        uiText("consent.sectionParticipationItem2"),
        uiText("consent.sectionParticipationItem3"),
        uiText("consent.sectionParticipationItem4"),
        uiText("consent.sectionParticipationItem5"),
        uiText("consent.sectionParticipationItem6"),
        uiText("consent.sectionParticipationItem7"),
      ],
      paragraphs: [
        uiText("consent.sectionParticipationP1"),
        uiText("consent.sectionParticipationP2"),
      ],
    },
    {
      heading: uiText("consent.sectionIntegrity"),
      intro: uiText("consent.sectionIntegrityIntro"),
      items: [
        uiText("consent.sectionIntegrityItem1"),
        uiText("consent.sectionIntegrityItem2"),
        uiText("consent.sectionIntegrityItem3"),
        uiText("consent.sectionIntegrityItem4"),
        uiText("consent.sectionIntegrityItem5"),
      ],
    },
    {
      heading: uiText("consent.sectionRights"),
      paragraphs: [
        uiText("consent.sectionRightsP1"),
        uiText("consent.sectionRightsP2"),
      ],
      items: [uiText("consent.sectionRightsItem1")],
      outro: uiText("consent.sectionRightsOutro"),
    },
    {
      heading: uiText("consent.sectionCompensation"),
      paragraphs: [
        uiText("consent.sectionCompensationP1"),
      ],
    },
    {
      heading: uiText("consent.sectionProtection"),
      intro: uiText("consent.sectionProtectionIntro"),
      items: [
        uiText("consent.sectionProtectionItem1"),
        uiText("consent.sectionProtectionItem2"),
        uiText("consent.sectionProtectionItem3"),
        uiText("consent.sectionProtectionItem4"),
      ],
      secondaryIntro: uiText("consent.sectionProtectionSecondaryIntro"),
      secondaryItems: [
        uiText("consent.sectionProtectionSecondaryItem1"),
        uiText("consent.sectionProtectionSecondaryItem2"),
        uiText("consent.sectionProtectionSecondaryItem3"),
        uiText("consent.sectionProtectionSecondaryItem4"),
        uiText("consent.sectionProtectionSecondaryItem5"),
        uiText("consent.sectionProtectionSecondaryItem6"),
      ],
      outro: uiText("consent.sectionProtectionOutro"),
    },
    {
      heading: uiText("consent.sectionEligibility"),
      intro: uiText("consent.sectionEligibilityIntro"),
      items: [
        uiText("consent.sectionEligibilityItem1"),
        uiText("consent.sectionEligibilityItem2"),
        uiText("consent.sectionEligibilityItem3"),
        uiText("consent.sectionEligibilityItem4"),
      ],
    },
    {
      heading: uiText("consent.sectionContact"),
      paragraphs: [
        uiText("consent.sectionContactP1"),
      ],
      contactEmail: uiText("consent.contactEmailValue"),
    },
    {
      heading: uiText("consent.sectionConsent"),
      intro: uiText("consent.sectionConsentIntro"),
      items: [
        uiText("consent.sectionConsentItem1"),
        uiText("consent.sectionConsentItem2"),
        uiText("consent.sectionConsentItem3"),
        uiText("consent.sectionConsentItem4"),
        uiText("consent.sectionConsentItem5"),
        uiText("consent.sectionConsentItem6"),
      ],
      outro: uiText("consent.sectionConsentOutro"),
    },
  ],
  actionRequiredTitle: uiText("consent.actionRequiredTitle"),
  checkboxTitle: uiText("consent.checkboxTitle"),
  checkboxNote: uiText("consent.checkboxNote"),
};
