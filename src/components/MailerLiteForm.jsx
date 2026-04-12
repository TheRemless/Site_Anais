import { useEffect, useRef } from "react";

export default function MailerLiteForm({ formId = "Ew3n64" }) {
  const containerRef = useRef(null);

  useEffect(() => {
    // MailerLite only scans the DOM once on initial page load.
    // In a React SPA, navigating to a new page doesn't reload the page,
    // so we need to re-trigger MailerLite to find the new form div.
    const timer = setTimeout(() => {
      // If MailerLite already rendered the form inside our div, skip
      if (containerRef.current && containerRef.current.childNodes.length > 0) {
        return;
      }
      // Re-inject the MailerLite universal script to force a fresh scan
      const existingScript = document.querySelector('script[src="https://assets.mailerlite.com/js/universal.js"]');
      if (existingScript) {
        existingScript.remove();
      }
      // Reset the ml function so it re-initializes
      if (window.ml) {
        window.ml = undefined;
      }
      const script = document.createElement("script");
      script.src = "https://assets.mailerlite.com/js/universal.js";
      script.async = true;
      script.onload = () => {
        if (window.ml) {
          window.ml("account", "2261194");
        }
      };
      document.head.appendChild(script);
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  return <div ref={containerRef} className="ml-embedded" data-form={formId}></div>;
}
