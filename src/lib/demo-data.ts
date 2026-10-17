import publicArticles from "./slowlax-articles.json";
import type { Article, Course, Settings } from "./types";
import type { LessonOutline } from "./db";

// Presentation content only. Never populate this module from a database dump,
// account, local configuration, or any other private source.
export const DEMO_SETTINGS: Settings = {
  siteName: "Slowlax",
  email: "info@slowlax.se",
  phone: "",
  address: "",
  location: "",
  payOnSite: false,
  stripeEnabled: false,
};

export const DEMO_ARTICLES: Article[] = publicArticles.map((entry, index) => ({
  id: index + 1,
  title: entry.title,
  slug: entry.slug,
  excerpt: entry.excerpt,
  body: entry.body,
  published: true,
  createdAt: `${entry.publishedAt}Z`,
  updatedAt: `${entry.publishedAt}Z`,
}));

const publishedAt = "2026-10-01T00:00:00.000Z";

// Course descriptions, outlines and prices are examples for the presentation.
// The course name below comes from Slowlax's public website.
export const DEMO_COURSES: Course[] = [
  {
    id: 1,
    title: "Bygg din egen Halal-pengamaskin",
    slug: "bygg-din-egen-halal-pengamaskin",
    description: "Lär dig förstå börsen och bygga en långsiktig aktieportfölj med dina värderingar som grund. Vi går steg för steg igenom sparande, bolagsanalys och principerna bakom halal investeringar.",
    priceOre: 149900,
    published: true,
    createdAt: publishedAt,
    updatedAt: publishedAt,
  },
  {
    id: 2,
    title: "Introduktion till halal investering",
    slug: "introduktion-till-halal-investering",
    description: "Börja din kunskapsresa med grunderna i aktier, privatekonomi och etiskt sparande. En introduktion för dig som vill förstå hur du kan komma igång och göra medvetna val.",
    priceOre: 0,
    published: true,
    createdAt: publishedAt,
    updatedAt: publishedAt,
  },
  {
    id: 3,
    title: "Fördjupning i aktieanalys",
    slug: "fordjupning-i-aktieanalys",
    description: "Fördjupa dina kunskaper om att bedöma företag, förstå nyckeltal och granska en investering utifrån islamiska och etiska principer. Praktiska exempel hjälper dig att omsätta teorin i ditt lärande.",
    priceOre: 99900,
    published: true,
    createdAt: publishedAt,
    updatedAt: publishedAt,
  },
];

function outline(courseId: number, titles: string[]): LessonOutline[] {
  return titles.map((title, index) => ({
    id: courseId * 100 + index + 1,
    courseId,
    title,
    position: index + 1,
    hasVideo: true,
    hasText: true,
    hasMaterial: index === titles.length - 1,
  }));
}

export const DEMO_LESSON_OUTLINES: Record<number, LessonOutline[]> = {
  1: outline(1, [
    "Din plan för ett långsiktigt sparande",
    "Förstå börsen och aktier",
    "Halal och etiska principer",
    "Lär känna bolaget bakom aktien",
    "Bygg och följ upp din portfölj",
    "Sammanfattning och nästa steg",
  ]),
  2: outline(2, [
    "Välkommen till din kunskapsresa",
    "Grunderna i privatekonomi och sparande",
    "Vad innebär halal investering?",
    "Ditt första steg",
  ]),
  3: outline(3, [
    "En metod för att analysera företag",
    "Förstå företagets verksamhet",
    "Nyckeltal och ekonomiska samband",
    "Granskning utifrån etiska principer",
    "Praktiskt exempel och reflektion",
  ]),
};
