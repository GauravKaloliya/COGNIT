import React from "react";
import { uiText } from "../utils/uiText";

function PageStatusBanners({
  isOnline,
  offlineMessage,
  draftRestored,
  saveError,
  compact = false,
}) {
  const bannerClass = compact ? "banner warning compact" : "banner warning";
  const infoClass = compact ? "banner info compact" : "banner info";

  return (
    <>
      {!isOnline && offlineMessage && (
        <div className={bannerClass}>
          <span>{offlineMessage}</span>
        </div>
      )}
      {draftRestored && (
        <div className={infoClass}>
          <span>{uiText("draft.restored")}</span>
        </div>
      )}
      {saveError && (
        <div className={bannerClass}>
          <span>{saveError}</span>
        </div>
      )}
    </>
  );
}

export default React.memo(PageStatusBanners);
