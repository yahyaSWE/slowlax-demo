import Link from "next/link";
import Image from "next/image";
import { ArrowRight, ArrowUpRight, BookOpen, Check, ChartNoAxesCombined, ShieldCheck, Users, Sparkles } from "lucide-react";
import { getArticles, getCourses } from "@/lib/db";
import { getSiteSettings } from "@/lib/site-data";
import { JsonLd } from "@/components/seo/json-ld";
import { CourseCard, ArticleCard } from "@/components/learning/cards";
import { NewsletterSignup } from "@/components/newsletter-signup";
import { absoluteUrl, buildOrganizationSchema, createPageMetadata, organizationId, websiteId } from "@/lib/seo";
import "./home.css";

export const metadata = createPageMetadata({
  title: "Slowlax | Investera med dina värderingar", path: "/",
  description: "Lär dig hur du bygger en halal aktieportfölj, filtrerar bort icke tillåtna bolag och investerar långsiktigt – steg för steg.",
});

export default async function HomePage() {
  const [courses, articles, settings] = await Promise.all([
    getCourses({ publishedOnly: true }), getArticles({ publishedOnly: true }), getSiteSettings(),
  ]);
  return (
    <div className="home-page slowlax-home">
      <JsonLd id="website-data" data={[
        buildOrganizationSchema(settings),
        { "@context": "https://schema.org", "@type": "WebSite", "@id": websiteId(), name: "Slowlax", url: absoluteUrl("/"), inLanguage: "sv-SE", publisher: { "@id": organizationId() } },
      ]} />
      <section className="home-hero-section">
        <Image src="/images/slowlax-hero-lecture.jpeg" alt="" fill priority sizes="100vw" className="slowlax-hero-image" />
        <div className="container slowlax-hero-content">
          <span className="slowlax-kicker"><span /> KUNSKAP FÖR EN MEDVETEN FRAMTID</span>
          <h1>Investera i aktier –<br />utan att kompromissa<br />med <em>dina värderingar.</em></h1>
          <p>Lär dig hur du bygger en halal aktieportfölj, filtrerar bort icke tillåtna bolag och investerar långsiktigt – steg för steg.</p>
          <div className="hero-actions">
            <Link href="/kurser" className="button button-primary">Utforska våra kurser <ArrowUpRight size={18} /></Link>
            <Link href="/om" className="text-link">Lär känna Slowlax <ArrowRight size={17} /></Link>
          </div>
          <div className="hero-assurances"><span><Check size={15} /> Inga förkunskaper krävs</span><span><Check size={15} /> Lär i din egen takt</span></div>
        </div>
      </section>
      <section id="varfor" className="section container paths-section">
        <div className="slowlax-section-heading"><div><p className="eyebrow">DINA PENGAR. DINA PRINCIPER.</p><h2>Varför välja halal och<br /><em>etiska investeringar?</em></h2></div></div>
        <div className="paths-grid">
          {[
            { Icon: ChartNoAxesCombined, title: "Värderingar som grund", text: "Investera i företag som är i linje med islamiska och etiska principer.", href: "/investeringsfilosofi", label: "Vår investeringsfilosofi" },
            { Icon: ShieldCheck, title: "Medvetna val", text: "Lär dig att filtrera bort icke tillåtna bolag och förstå principerna bakom en halal aktieportfölj.", href: "/kurser", label: "Bygg din kunskap" },
            { Icon: Users, title: "Positiv social påverkan", text: "Låt dina värderingar vägleda vilka företag du stödjer. Vi tror på samarbete, utbildning och kunskapsdelning.", href: "/om", label: "Upptäck vår gemenskap" },
          ].map(({ Icon, title, text, href, label }, index) => <Link href={href} className="path-card" key={title}><span className="path-number">0{index + 1}</span><span className="path-icon"><Icon size={27} strokeWidth={1.5} /></span><h3>{title}</h3><p>{text}</p><span className="path-card-bottom">{label}<ArrowUpRight size={18} /></span></Link>)}
        </div>
      </section>
      <section className="section container home-learning-section" id="kurser">
        <div className="section-heading"><div><p className="eyebrow">ETT STEG I TAGET</p><h2>Kunskap som tar<br /><em>dig framåt.</em></h2></div><Link href="/kurser" className="text-link">Se alla kurser <ArrowRight size={18} /></Link></div>
        <p className="slowlax-section-intro">Oavsett om du precis har börjat eller vill förbättra dina färdigheter, utforska våra kurser i etiska och halalinvesteringar.</p>
        {courses.length ? <div className="card-grid">{courses.slice(0, 3).map((course, index) => <CourseCard key={course.id} course={course} index={index} />)}</div> : <div className="empty-state"><BookOpen /><h3>Våra kurser</h3><p>Kurserna visas här när de publicerats.</p></div>}
      </section>
      <section className="slowlax-community"><div className="container slowlax-community-inner"><div className="slowlax-community-mark" aria-hidden="true"><ChartNoAxesCombined size={110} strokeWidth={0.8} /><span>SLOW THINKING.<br />LONG TERM.</span></div><div><p className="eyebrow">VÅR GEMENSKAP</p><h2>Mer än siffror<br /><em>på en skärm.</em></h2><p>Vi tror att investeringar är mer än bara siffror på en skärm – det handlar om att förbättra liv och bygga starka ekonomiska grunder.</p><p>Genom samarbete, utbildning och kunskapsdelning strävar vi efter att skapa en inkluderande gemenskap av ansvarsfulla investerare.</p><Link href="/registrera" className="button button-primary">Gå med i gemenskapen <ArrowUpRight size={18} /></Link></div></div></section>
      <section className="section container slowlax-memberships"><div className="section-heading"><div><p className="eyebrow">LÄR OCH UTVECKLAS TILLSAMMANS</p><h2>Välj din väg.</h2></div><Link href="/medlemskap" className="text-link">Om medlemskap <ArrowRight size={18} /></Link></div><div className="slowlax-membership-grid"><div className="slowlax-plan"><Users size={25} /><h3>Bas medlemskap</h3><p>En första kontakt med vår gemenskap.</p><ul><li><Check size={17} /> Gratis medlemskap</li><li><Check size={17} /> Communityuppdateringar</li></ul><Link href="/registrera" className="button button-secondary">Skapa ditt konto <ArrowUpRight size={17} /></Link></div><div className="slowlax-plan featured"><span className="badge"><Sparkles size={13} /> FÖRDJUPA DITT LÄRANDE</span><h3>Premium medlemskap</h3><p>För dig som vill fortsätta utveckla dina kunskaper.</p><ul><li><Check size={17} /> Tillgång till tillgängliga kurser enligt medlemskapet</li><li><Check size={17} /> Exklusiva uppdateringar</li></ul><Link href="/medlemskap" className="button button-primary">Utforska Premium <ArrowUpRight size={17} /></Link></div></div></section>
      {articles.length > 0 && <section className="articles-section section"><div className="container"><div className="section-heading"><div><p className="eyebrow">NYHETER & INSPIRATION</p><h2>Från vår kunskapsbank.</h2></div><Link href="/artiklar" className="text-link">Alla artiklar <ArrowRight size={18} /></Link></div><div className="card-grid">{articles.slice(0, 3).map((article, index) => <ArticleCard key={article.id} article={article} index={index} />)}</div></div></section>}
      <NewsletterSignup />
      <section className="visit-cta container"><div><span className="eyebrow">DIN VÄG TILL ETISKA INVESTERINGAR</span><h2>Börja med kunskap.</h2><p>Lär dig principerna för halalfinansiering, i din egen takt.</p></div><Link href="/kurser" className="button button-primary">Hitta din kurs <ArrowUpRight size={18} /></Link></section>
    </div>
  );
}
