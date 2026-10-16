import { BookOpen, ChartNoAxesCombined } from "lucide-react";
import { getArticles } from "@/lib/db";
import { createPageMetadata } from "@/lib/seo";
import { ArticleCard } from "@/components/learning/cards";

export const metadata = createPageMetadata({
  title: "Nyheter och artiklar om etiska investeringar",
  description:
    "Nyheter, utbildningar och perspektiv från Slowlax om etiska och halalinvesteringar.",
  path: "/artiklar",
});
export const dynamic = "force-dynamic";

export default async function ArticlesPage() {
  const articles = await getArticles({ publishedOnly: true });
  return (
    <>
      <section className="section container journal-heading">
        <p className="eyebrow">
          <span className="eyebrow-line" /> Slowlax nyheter
        </p>
        <h1 className="page-title">
          Kunskap för
          <br />
          <em>medvetna investeringar.</em>
        </h1>
        <p className="lead muted">
          Nyheter, perspektiv och reflektioner om aktiesparande, islamisk etik
          och långsiktiga investeringar.
        </p>
        <ChartNoAxesCombined
          className="journal-heading-sprout"
          size={110}
          strokeWidth={0.8}
          aria-hidden="true"
        />
      </section>
      <section className="section container journal-catalog">
        <div className="section-heading">
          <h2>Senaste artiklarna</h2>
          <span className="muted">
            {articles.length} {articles.length === 1 ? "artikel" : "artiklar"}
          </span>
        </div>
        {articles.length ? (
          <div className="card-grid">
            {articles.map((article, index) => (
              <ArticleCard key={article.id} article={article} index={index} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <BookOpen size={32} />
            <h3>Här växer vår journal fram</h3>
            <p className="muted">
              Nya artiklar visas här så snart de publicerats.
            </p>
          </div>
        )}
      </section>
    </>
  );
}
