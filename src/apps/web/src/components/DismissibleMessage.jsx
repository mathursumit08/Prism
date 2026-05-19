export default function DismissibleMessage({ children, kind = "notice", onClose }) {
  // Shared by management pages so transient success/error states behave the same
  // way and can be dismissed without clearing the rest of the page state.
  const className = kind === "success" ? "page-success dismissible-message" : "page-notice dismissible-message";

  return (
    <div className={className}>
      <span>{children}</span>
      <button type="button" className="message-close-button" onClick={onClose} aria-label="Close message">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 4l8 8" />
          <path d="M12 4l-8 8" />
        </svg>
      </button>
    </div>
  );
}
