import { useEffect, useRef } from "react";

/**
 * MailerLiteForm component for React SPAs.
 *
 * MailerLite's universal script scans the DOM once on load.
 * In a React SPA, we need to re-trigger the scan when the component mounts
 * and the placeholder div is available in the DOM.
 */
export default function MailerLiteForm({ formId = "Ew3n64" }) {
  const containerRef = useRef(null);

  useEffect(() => {
    // 1. If ml is already defined, we can just call it to re-scan
    if (window.ml) {
      window.ml("account", "2261194");
    }

    // 2. Also ensure the script is loaded if it's not already
    // Sometimes the script in index.html might fail or be blocked
    if (!document.querySelector('script[src*="assets.mailerlite.com/js/universal.js"]')) {
      const script = document.createElement("script");
      script.src = "https://assets.mailerlite.com/js/universal.js";
      script.async = true;
      script.onload = () => {
        if (window.ml) {
          window.ml("account", "2261194");
        }
      };
      document.head.appendChild(script);
    }

    // 3. Re-trigger after a short delay to ensure DOM is ready
    const timer = setTimeout(() => {
      if (window.ml) {
        window.ml("account", "2261194");
      }
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      ref={containerRef}
      className="ml-embedded"
      data-form={formId}
      style={{ minHeight: "150px" }} // Added min-height to avoid layout jump and ensure visibility
    ></div>
  );
}
