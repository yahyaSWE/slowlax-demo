import { TrendingUp } from "lucide-react";
import { PRIVATE_METADATA } from "@/lib/seo";

export const metadata = {
  ...PRIVATE_METADATA,
  title: "Välkommen snart",
};
export default function InstallationPage() {
  return (
    <section className="section container narrow">
      <div className="empty-state">
        <TrendingUp size={35} strokeWidth={1.2} />
        <span className="eyebrow">SLOWLAX</span>
        <h1 style={{ fontSize: "clamp(38px,5vw,58px)", marginBlock: 20 }}>
          Vi förbereder
          <br />
          något fint.
        </h1>
        <p>
          Långsiktigt sparande och lärande med Slowlax.
          <br />
          Välkommen tillbaka när webbplatsen öppnar.
        </p>
      </div>
    </section>
  );
}
