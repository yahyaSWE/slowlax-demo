import { databaseConfigured } from "@/lib/database-config";
import { absoluteUrl, isIndexableDeployment, PUBLIC_PAGES } from "@/lib/seo";
import { getPublicSeoContent } from "@/lib/seo-data";
import { getShopSettings, getPublicShopProducts } from "@/lib/shop";
import { getPublicPlans } from "@/lib/memberships";

export const dynamic = "force-dynamic";

function label(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/[\\[\]]/g, "\\$&");
}

export async function GET(): Promise<Response> {
  const headers = {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex",
  };
  if (!isIndexableDeployment()) {
    return new Response("Ingen offentlig innehållskarta för denna miljö.\n", {
      status: 404,
      headers,
    });
  }
  if (!databaseConfigured()) {
    return new Response("Webbplatsens offentliga innehåll är inte tillgängligt ännu.\n", {
      status: 503,
      headers,
    });
  }

  const content = await getPublicSeoContent();
  if (content.installationRequired) {
    return new Response("Webbplatsens offentliga innehåll är inte tillgängligt ännu.\n", {
      status: 503,
      headers,
    });
  }
  const lines = [
    "# Tibb.nu",
    "",
    "> Klassisk kinesisk medicin i ljuset av den Profetiska vägledningen.",
    "",
    "Offentlig information om behandlingar, kurser, artiklar och självreflektion.",
    "",
    "## Offentliga sidor",
    "",
    ...PUBLIC_PAGES.map((page) =>
      `- [${label(page.title)}](${absoluteUrl(page.path)}): ${page.description}`,
    ),
  ];

  for (const [heading, prefix, records] of [
    ["Publicerade artiklar", "/artiklar/", content.articles],
    ["Publicerade kurser", "/kurser/", content.courses],
  ] as const) {
    const published = records.filter((record) => /^[a-z0-9][a-z0-9-]*$/.test(record.slug));
    if (!published.length) continue;
    lines.push("", `## ${heading}`, "");
    for (const record of published) {
      lines.push(`- [${label(record.title)}](${absoluteUrl(`${prefix}${record.slug}`)})`);
    }
  }

  lines.push(
    "",
    "## Om innehållet",
    "",
    "Kursöversikterna är offentliga. Lektioner och kursmaterial kräver inloggning och tilldelad kursåtkomst.",
    "Självtestet med fem faser är avsett för utbildning och självreflektion. Det är inte ett medicinskt diagnostiskt verktyg och ersätter inte individuell bedömning.",
    "Detta är en informationskarta över offentliga sidor. Filen ger ingen garanti om indexering, sökplacering eller synlighet i AI-sök.",
    "",
  );
  if ((await getShopSettings()).enabled) {
    lines.push("", "## Butik", "", `- [Butik](${absoluteUrl("/butik")})`);
    for (const product of await getPublicShopProducts()) if (/^[a-z0-9][a-z0-9-]*$/.test(product.slug)) lines.push(`- [${label(product.name)}](${absoluteUrl(`/butik/${product.slug}`)})`);
  }
  const plans=await getPublicPlans();
  if(plans.length){lines.push("","## Medlemskap","",`- [Medlemskap](${absoluteUrl("/medlemskap")})`);for(const plan of plans)if(/^[a-z0-9][a-z0-9-]*$/.test(plan.slug))lines.push(`- [${label(plan.name)}](${absoluteUrl(`/medlemskap/${plan.slug}`)})`);lines.push("","Gruppinlägg, dokument och elevuppgifter är privata och ingår inte i denna innehållskarta.");}
  return new Response(lines.join("\n"), { headers });
}
