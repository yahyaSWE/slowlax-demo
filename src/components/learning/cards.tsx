import Link from "next/link";
import { ArrowUpRight, BookOpen, ChartNoAxesCombined, Play, ShieldCheck } from "lucide-react";
import {
  contentBlocks,
  contentInlines,
  courseIntroduction,
} from "@/lib/content-text";
import "../content-accessibility.css";

type CourseCardProps = {
  course: {
    id: number;
    title: string;
    slug: string;
    description: string;
    priceOre: number;
  };
  index?: number;
  href?: string;
  progress?: number;
};

export function formatPrice(priceOre: number) {
  return priceOre > 0
    ? new Intl.NumberFormat("sv-SE", {
        style: "currency",
        currency: "SEK",
        minimumFractionDigits: priceOre % 100 === 0 ? 0 : 2,
        maximumFractionDigits: 2,
      }).format(priceOre / 100)
    : "Kontakta oss för information";
}

export function CourseCard({
  course,
  index = 0,
  href,
  progress,
}: CourseCardProps) {
  const illustrations = [ChartNoAxesCombined, ShieldCheck, BookOpen];
  const Illustration = illustrations[index % illustrations.length];
  return (
    <Link href={href || `/kurser/${course.slug}`} className="course-card">
      <div className={`course-art course-art-${index % 3}${course.slug === "bygg-din-egen-halal-pengamaskin" ? " slowlax-course-art" : ""}`}>
        {course.slug === "bygg-din-egen-halal-pengamaskin" ? <img src="/images/slowlax-course-pengamaskin.png" alt="" /> : <>
        <span className="course-art-ring" />
        <Illustration size={84} strokeWidth={1} aria-hidden="true" />
        <span className="course-art-label">SLOWLAX AKADEMI</span>
        </>}
        <span className="course-art-badge">
          <Play size={12} fill="currentColor" /> Onlinekurs
        </span>
      </div>
      <div className="course-card-body">
        <p className="eyebrow">Kunskap för livet</p>
        <h3>{course.title}</h3>
        <p className="muted course-card-intro">
          {courseIntroduction(course.description)}
        </p>
        {progress !== undefined ? (
          <div className="course-progress">
            <div className="progress-track">
              <span
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
            <div className="course-card-footer">
              <span>{progress}% av lektionerna markerade</span>
              <ArrowUpRight size={19} />
            </div>
          </div>
        ) : (
          <div className="course-card-footer">
            <span>{formatPrice(course.priceOre)}</span>
            <ArrowUpRight size={19} />
          </div>
        )}
      </div>
    </Link>
  );
}

type ArticleCardProps = {
  article: { title: string; slug: string; excerpt: string; createdAt: string };
  index?: number;
};

export function ArticleCard({ article, index = 0 }: ArticleCardProps) {
  const archiveImages: Record<string, string> = {
    "grundlaggande-aktieutbildning": "/images/slowlax-news-intro.jpg",
    "fordjupning-i-aktieanalys-med-fokus-pa-islamisk-etik": "/images/slowlax-news-analysis.jpg",
    "islamiska-investeringar": "/images/slowlax-news-islamic.png",
  };
  const image = archiveImages[article.slug];
  const styles = ["article-art-olive", "article-art-sand", "article-art-sage"];
  const icons = [ChartNoAxesCombined, ShieldCheck, BookOpen];
  const Illustration = icons[index % icons.length];
  return (
    <Link href={`/artiklar/${article.slug}`} className="article-card">
      <div className={`article-art ${styles[index % styles.length]}${image ? " slowlax-article-art" : ""}`}>
        {image ? <img src={image} alt="" /> : <>
        <Illustration size={64} strokeWidth={1} aria-hidden="true" />
        <span>SLOWLAX NYHETER</span>
        </>}
      </div>
      <div className="article-card-body">
        <p className="eyebrow">
          {new Date(article.createdAt).toLocaleDateString("sv-SE", {
            day: "numeric",
            month: "long",
            year: "numeric",
            timeZone: "Europe/Stockholm",
          })}
        </p>
        <h3>{article.title}</h3>
        <p className="muted clamp-three">{article.excerpt}</p>
        <span className="text-link">
          Läs artikeln <ArrowUpRight size={17} />
        </span>
      </div>
    </Link>
  );
}

export function TextContent({ text }: { text: string }) {
  const inlineContent = (value: string) =>
    contentInlines(value).map((part, index) =>
      part.href ? (
        <a key={index} href={part.href}>
          {part.text}
        </a>
      ) : (
        part.text
      ),
    );
  return (
    <div className="prose">
      {contentBlocks(text).map((block, index) =>
        block.kind === "heading" ? (
          <h2 key={index}>{inlineContent(block.text)}</h2>
        ) : (
          <p key={index} style={{ whiteSpace: "pre-line" }}>
            {inlineContent(block.text)}
          </p>
        ),
      )}
    </div>
  );
}
