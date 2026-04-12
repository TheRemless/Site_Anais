import { useEffect, useRef } from "react";

export default function MailerLiteForm({ formId = "Ew3n64" }) {
  const containerRef = useRef(null);

  useEffect(() => {
    // Re-trigger MailerLite to scan for embedded forms after React mounts this component
    if (window.ml) {
      window.ml("account", "2261194");
    }
  }, []);

  return <div ref={containerRef} className="ml-embedded" data-form={formId}></div>;
}
