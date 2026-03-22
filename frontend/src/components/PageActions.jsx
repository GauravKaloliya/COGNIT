import React from "react";

function PageActions({
  children,
  className = "",
  sticky = false,
  inline = false,
}) {
  const classes = [
    "page-actions",
    sticky ? "sticky-mobile-actions" : "",
    inline ? "inline-actions" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return <div className={classes}>{children}</div>;
}

export default React.memo(PageActions);
