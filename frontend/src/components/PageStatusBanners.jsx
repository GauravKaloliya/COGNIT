import React from "react";

function PageStatusBanners({
  saveError,
  compact = false,
}) {
  const bannerClass = compact ? "banner warning compact" : "banner warning";

  return (
    <>
      {saveError && (
        <div className={bannerClass}>
          <span>{saveError}</span>
        </div>
      )}
    </>
  );
}

export default React.memo(PageStatusBanners);
