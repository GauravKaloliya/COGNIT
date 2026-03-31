import { useEffect, useRef, useState } from "react";
import { endpoints } from "../../utils/api";
import { getErrorMessage } from "../../utils/errorRegistry";
import { getDisplayErrorMessage } from "../../utils/appError.js";
import { REQUEST_CODES } from "../../constants/request";
import { prioritizeEnglishOptions } from "../../utils/userDetailsHelpers";

export function useParticipantOptions({
  isOnline,
  priorExperienceValue,
  setDemographics,
  onGeneralError,
}) {
  const [optionLists, setOptionLists] = useState({
    genders: [],
    languages: [],
    priorExperiences: [],
  });
  const [optionsLoading, setOptionsLoading] = useState(true);
  const participantOptionsLoadedRef = useRef(false);

  useEffect(() => {
    if (participantOptionsLoadedRef.current) {
      setOptionsLoading(false);
      return;
    }
    if (!isOnline) {
      setOptionsLoading(false);
      return;
    }

    let cancelled = false;
    const loadParticipantOptions = async () => {
      setOptionsLoading(true);
      try {
        const data = await endpoints.getParticipantOptions();
        if (cancelled) return;
        setOptionLists({
          genders: Array.isArray(data?.genders) ? data.genders : [],
          languages: prioritizeEnglishOptions(Array.isArray(data?.languages) ? data.languages : []),
          priorExperiences: Array.isArray(data?.prior_experiences) ? data.prior_experiences : [],
        });
        participantOptionsLoadedRef.current = true;
        onGeneralError?.("");
      } catch (error) {
        if (cancelled || error?.code === REQUEST_CODES.aborted) return;
        onGeneralError?.(getDisplayErrorMessage(error, "SYS_001_0001"));
      } finally {
        if (!cancelled) setOptionsLoading(false);
      }
    };

    void loadParticipantOptions();
    return () => {
      cancelled = true;
    };
  }, [isOnline, onGeneralError]);

  useEffect(() => {
    if (!optionLists.priorExperiences.length) return;
    const currentValue = String(priorExperienceValue || "").trim();
    if (!currentValue) return;
    const flatOptions = optionLists.priorExperiences.flatMap((group) => (
      Array.isArray(group?.options) ? group.options : []
    ));
    const hasCodeMatch = flatOptions.some((option) => String(option?.value || "").trim() === currentValue);
    if (hasCodeMatch) return;
    const labelMatch = flatOptions.find((option) => String(option?.label || "").trim() === currentValue);
    if (!labelMatch?.value) return;
    setDemographics((prev) => ({ ...prev, prior_experience: String(labelMatch.value) }));
  }, [optionLists.priorExperiences, priorExperienceValue, setDemographics]);

  return {
    optionLists,
    optionsLoading,
  };
}
