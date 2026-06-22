import { useState } from "react";
import { FAQ_ITEMS } from "../data";
import "../styles/faq.css";

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState(null);

  return (
    <section id="faq" className="faq">
      <div className="faq-container">
        <div className="section-header">
          <span className="section-tag">Questions fréquentes</span>
          <h2>Tout ce que tu veux savoir</h2>
        </div>

        <div className="faq-items">
          {FAQ_ITEMS.map((item, i) => (
            <div key={i} className={`faq-item ${openIndex === i ? "open" : ""}`}>
              <div
                className="faq-question"
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
              >
                <span>{item.q}</span>
                <span className="faq-toggle">+</span>
              </div>
              {openIndex === i && (
                <div className="faq-answer">
                  <p>{item.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
