import { STEPS } from "../data";
import "../styles/process.css";

export default function Process() {
  return (
    <section className="process">
      <div className="process-container">
        <div className="section-header">
          <span className="section-tag">Comment ça marche</span>
          <h2>6 étapes vers ton voyage de rêve</h2>
        </div>

        <div className="steps-grid">
          {STEPS.map((step, i) => (
            <div key={i} className="step-card">
              <div className="step-number">{String(i + 1).padStart(2, "0")}</div>
              <div className="step-icon">{step.icon}</div>
              <h3>{step.title}</h3>
              <p>{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
