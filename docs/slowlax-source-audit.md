# Slowlax: källgranskning

Granskad 2026-10-15. Källan är den publika sajten på [slowlax.se](https://slowlax.se/). Uppgifterna nedan beskriver vad sajten faktiskt publicerar; påståenden om aktuella priser, framtida kurstillfällen, kundantal eller finansiella effekter har inte verifierats oberoende. AGENTS.md i projektroten är läst. Inga app- eller UI-filer har ändrats i denna deluppgift.

## Identitet och färger

Sajten har en svart, vit och guldfärgad profil. De relevanta anpassade Elementor-färgerna är:

| Färg | Faktiskt värde | Användning i källan |
| --- | --- | --- |
| Guld | `#DD9933` | Knappar, ikoner, hovring, prisdekorationer |
| Svart | `#000000` | Header, footer, mörka sektioner och text |
| Vit | `#FFFFFF` | Logotyp, text på svart, ljusa ytor |
| Ljus yta | `#F7F9FA` | Anpassad global färg |
| Grå | `#A5A1A1` | Anpassad global färg |
| Grön | `#3A934B` | Bockar i den aktuella hero-sektionen |

De automatiska Elementor-standarderna `#6EC1E4`, `#54595F`, `#7A7A7A` och `#61CE70` förekommer också i globala CSS-variabler, men ska inte misstas för den huvudsakliga anpassade varumärkesprofilen. Sidans individuella regler använder främst guld/svart/vitt. Footer har också `#F4F5F6` för sociala ikonbakgrunder.

Rubriker använder **Poppins**, ofta 40–44 px, fet stil, cirka 1.2 i radavstånd. Brödtext använder **Inter**. Roboto finns i vissa Elementor- och formulärdelar. Hero-fotot använder `background-position: center center`, `background-size: cover` och en svart-till-transparent toning från vänster (`linear-gradient(90deg, #000000 0%, #00000000 50%)`).

Källor: [globala profilvariabler](https://slowlax.se/wp-content/uploads/elementor/css/post-7412.css), [startsida](https://slowlax.se/wp-content/uploads/elementor/css/post-17.css), [header](https://slowlax.se/wp-content/uploads/elementor/css/post-7416.css), [footer](https://slowlax.se/wp-content/uploads/elementor/css/post-7447.css).

## Hämtade originalbilder

På föräldraagentens begäran har följande faktiska resurser hämtats till `public/images`. De är inte nygenererade. Logo, hero och om-illustration är också öppnade för visuell granskning.

| Lokal fil | Källa / användning |
| --- | --- |
| `slowlax-logo-white.png` | [Vit logotyp, 3709 × 696](https://slowlax.se/wp-content/uploads/2024/09/SLOWLAX_logo_white-1.png). Avsedd för mörk bakgrund. |
| `slowlax-hero-lecture.jpeg` | [Aktuell hero, 2000 × 924](https://slowlax.se/wp-content/uploads/2026/04/slowlax-halal-investering-forelasning-hero.jpeg). Verkligt föreläsningsfoto med talare, mikrofon och börsgraf. |
| `slowlax-about.png` | [Om oss-illustration](https://slowlax.se/wp-content/uploads/2024/10/Untitled-design-2024-10-10T192408.750.png), 860 × 760. Guld, grått, svart och vitt; människor med mynt och stigande pil. |
| `slowlax-course-pengamaskin.png` | [Aktuell kursbild](https://slowlax.se/wp-content/uploads/2026/09/Pengamaskin-1-768x768.png), 768 × 768. |
| `slowlax-rening.png` | [Rening-tjänstens huvudbild](https://slowlax.se/wp-content/uploads/2026/03/Slowlax-rening.png), 1536 × 1024. |
| `slowlax-news-intro.jpg` | [Grundläggande aktieutbildning](https://slowlax.se/wp-content/uploads/2024/10/SlowlaxKurs1-scaled-1-724x1024.jpg). |
| `slowlax-news-analysis.jpg` | [Fördjupning i aktieanalys](https://slowlax.se/wp-content/uploads/2024/10/kurs2-scaled-1-724x1024.jpg). |
| `slowlax-news-islamic.png` | [Islamiska investeringar](https://slowlax.se/wp-content/uploads/2024/10/Monem-2023-01-10-235325.png), 825 × 825. |

Ytterligare ursprungliga startsidesresurser, ännu ej hämtade:

- [Finansillustration 420 × 571](https://slowlax.se/wp-content/uploads/2024/10/Add-a-little-bit-of-body-text-61.png).
- [Värdegrundad tillväxt](https://slowlax.se/wp-content/uploads/2024/09/Untitled-design-2024-09-25T131555.042.png).
- [Etiska filter](https://slowlax.se/wp-content/uploads/2024/09/Untitled-design-2024-09-26T092106.220.png).
- [Social påverkan](https://slowlax.se/wp-content/uploads/2024/09/Untitled-design-2024-09-26T092203.993.png).

## Verifierat innehåll och kontakt

Startsidan presenterar lärande om långsiktigt aktiesparande som följer islamiska och etiska principer. Hero-rubriken är **Investera i aktier – utan att kompromissa med dina värderingar**. Den publika kursen heter **Bygg din egen Halal-pengamaskin**. Vid granskning leder [kursens adress](https://slowlax.se/courses/aktieinvestering/) till inloggning, så lektionsinnehåll, kurslängd, antal avsnitt, lärare och pris är inte verifierade.

[Om oss](https://slowlax.se/about-us/) beskriver åtta personer från olika utbildningsområden, en aktieklubb som startade 2018 och en placeringshorisont på minst fem år. Namnet kombinerar Slow och Lax som motsats till snabba pengar. De lyfter utbildning, kunskapsdelning, ansvarsfulla investeringar och en inkluderande gemenskap. Sidan innehåller först svensk presentation och därefter engelska avsnitt som upprepar historik, vision, arbetssätt och gemenskap.

Den korrekta offentliga e-postadressen är **info@slowlax.se**. Den bekräftas av flera [blogginlägg](https://slowlax.se/grundlaggande-aktieutbildning/), [rening-sidan](https://slowlax.se/rening/) och de [befintliga villkoren](https://slowlax.se/terms-and-conditions/). Footer visar rätt adress men har en felaktig `href` som pekar på `http://churchsupport@gmail.com`; den länken ska rättas till `mailto:info@slowlax.se`.

Publika sociala länkar från footer:

- [Instagram](https://www.instagram.com/slowlax.se/)
- [Facebook](https://web.facebook.com/profile.php?id=100065558227119)
- [X / Twitter](https://twitter.com/slowlaxs)

Ingen svensk besöksadress, organisationsnummer, telefon, bemanningstid eller namngiven företrädare har verifierats. [Kontakt-sidan](https://slowlax.se/contact/) innehåller tydligt mallinnehåll: en New York-adress, två amerikanska telefonnummer, generiska `info@mail.com`/`support@mail.com` och påståendet 24/7. Dessa ska inte kopieras som Slowlax-fakta.

## Innehållssidor och navigering

Aktuell huvudmeny i startsidans HTML:

| Meny | Källa | Anmärkning |
| --- | --- | --- |
| Hem | [/](https://slowlax.se/) | Aktuell startsida |
| Nyheter | [/news/](https://slowlax.se/news/) | Tre publicerade historiska artiklar |
| Investeringfilosofi → Halal Investering | [/halal-investering/](https://slowlax.se/halal-investering/) | Saktext om aktiescreening |
| Tjänster → Rening tjänst | [/rening/](https://slowlax.se/rening/) | Sakinfo samt butik/prisköp; köpdelen bör uteslutas i denna kopia |
| Om oss | [/about-us/](https://slowlax.se/about-us/) | Verifierad svensk presentation |

[Vanliga frågor](https://slowlax.se/faqs/) är publicerad men saknas i den aktuella huvudmenyn. Den förklarar att kommande föreläsningar annonseras i sociala medier/maillista; något aktuellt datum anges inte. Den beskriver affärsscreening och finansiella kriterier samt anger att Slowlax inte förvaltar besökarnas pengar. Där finns också en [publik intresseanmälan](https://docs.google.com/forms/d/e/1FAIpQLSctyfln0wZbi52RWzD-gzQ2bxW4QlSDrE0Ts9HHfTpXY6roBQ/viewform), vars fortsatta aktualitet inte har kontrollerats.

[Halal-investering](https://slowlax.se/halal-investering/) hänvisar till AAOIFI:s sharia-standard nr 21. Källan anger affärsscreening, mindre än 5 procent otillåten omsättning samt två finansiella nyckeltal med 30-procentsgränser. Originaltexten har en historisk del om fonder och en hänvisning till AAOIFI samt en bok från 2012. Det är källsidans beskrivning, inte en ny granskning av aktuella standarder eller en utfästelse om en viss akties halalstatus.

Övriga publicerade URL:er inkluderar `/contact/`, `/our-courses/`, `/philosophy/`, `/investments/`, `/membership-pricing/`, `/terms-and-conditions/`, `/privacy-policy-2/`, `/blog/` och flera konto-/LMS-/butikssidor. Vid granskning var `our-courses`, `philosophy` och `investments` tomma på saktext; `membership-pricing` visar en rå WordPress-shortcode. Den fullständiga publicerade sidlistan kan läsas via [WordPress REST](https://slowlax.se/wp-json/wp/v2/pages?per_page=100&_fields=id,slug,link,title) eller [sitemap](https://slowlax.se/wp-sitemap.xml).

## Historiska nyheter

Samtliga tre nyheter listas som publicerade **6 oktober 2024**. De ska visas som arkivmaterial, utan att påstå att de beskriver nya eller kommande tillfällen 2026.

| Titel och original | Innehåll |
| --- | --- |
| [Grundläggande aktieutbildning](https://slowlax.se/grundlaggande-aktieutbildning/) | Kostnadsfri digital introduktion till aktier, sparande, privatekonomi och halal/etisk investering. Texten återger Slowlax bakgrund från 2018. En gammal kursanmälan förekommer och bör inte förvandlas till en aktuell bokning. |
| [Fördjupning i aktieanalys – Med fokus på Islamisk etik](https://slowlax.se/fordjupning-i-aktieanalys-med-fokus-pa-islamisk-etik/) | Fortsättningskurs med teori och praktik, analysmetoder, strategier och screening av två bolag. Historisk digital utbildning, utan verifierat kommande datum. |
| [Islamiska Investeringar](https://slowlax.se/islamiska-investeringar/) | Historisk föreläsning i samarbete med Muslim Aid och föreläsaren Monem Salam. Koppla inte ett nytt framtida tillfälle till de äldre talaruppgifterna. |

Maskinläsbara källor för originaltitlar, datum och texter: [WordPress inlägg](https://slowlax.se/wp-json/wp/v2/posts?per_page=100&_fields=id,slug,link,date,title,excerpt,content).

## Rening: ursprunglig avgränsning 2026-10-15

[Rening-sidan](https://slowlax.se/rening/) beskriver granskning av portföljens bolag och beräkning av det belopp som enligt deras metod behöver skänkas bort. Resultatet skickas med e-post. Det befintliga flödet är: skicka aktieinnehav, låt Slowlax analysera, få en sammanställning. Sidan hänvisar till AAOIFI och anger årlig rening.

Den innehåller även tre produktpaket (199/299/399 kr), köpknappar, pengarna-tillbaka-utfästelser och kapacitetsmarknadsföring. Eftersom användaren uttryckligen vill ta bort butiksfunktioner bör den nya kopian visa tjänstens information och kontaktväg, medan produktköp, kundvagn och kassa utesluts. Leveransinformationen är dessutom motstridig: hero anger fem arbetsdagar medan FAQ säger normalt 24–72 timmar och ibland längre. Inga nya leveranslöften bör uppfinnas.

**Ändrad beställning 2026-10-16:** Ägaren har uttryckligen beställt Rening som separat tjänsteköp samt som förmån i medlemskap och kurspaket. Tjänsten får därför ett eget betalnings- och ärendeflöde. Den tidigare avgränsningen ovan gäller fortfarande den fysiska produktbutiken. Vid den nya kontrollen visade den publika Rening-sidan 4 bolag för 199 kr, 5–9 för 299 kr och 10–14 för 399 kr. De tre erbjudandena förbereds som 4, 9 respektive 14 reningar med försäljning avstängd. Eleven har bekräftat att en rening räknas per bolag/aktieslag och att medlemskvoten förnyas per betald medlemsperiod. Svar levereras i elevportalen enligt den nya beställningen. Inga automatiska finansiella bedömningar, nya leveranslöften eller nöjdhetsgarantier införs genom denna ändring.

## Nyhetsbrev och kontofunktioner

Startsidan innehåller ett faktiskt **Kit**-formulär:

- HTTP POST: `https://app.kit.com/forms/9288768/subscriptions`
- E-postfält: `email_address` (`type=email`, obligatoriskt).
- `data-uid`: `6d937d648e`.
- Källans lyckade svar ber besökaren kontrollera e-post och bekräfta prenumerationen.

Inga uppgifter skickades in under granskningen. Befintlig leverantör kan bevaras utan att uppfinna en ny mottagarlista, men en verklig registrering måste implementeras med korrekt bekräftelsehantering.

Källans inloggning, studentregistrering, community-CTA och flera medlemsknappar pekar fortfarande på **test.slowlax.se**. Kopiera inte dessa testlänkar till produktion; använd motsvarande fungerande lokala funktion när den finns.

Startsidan listar Bas och Premium. Bas innebär gratis medlemskap och communityuppdateringar; Premium uppges ge alla tillgängliga kurser och exklusiva uppdateringar. Den gamla sidan visar både 19.99 USD per månad och 99.99 USD per år, redigeringsetiketter och produktlänkar på testdomänen. Dessa belopp är inte verifierade som aktuellt erbjudande och ska inte få nya svenska priser eller automatiska köpflöden genom gissning.

## Uppgifter som inte bör förstärkas eller uppfinnas

- Siffran +795 prenumeranter står i startsidans marknadsföring men har inte verifierats mot ett abonnentregister.
- Kundomdömen med personnamn ligger tillsammans med bildlänkar till testdomänen. Källan bevisar inte att de är aktuella eller autentiska; skapa inga nya betyg eller omdömen.
- Fördelstexten om att etiska filter minskar volatilitet är marknadsföring, inte en verifierad garanti om risk eller avkastning.
- Åtta personer och grundande 2018 är verifierat **publicerade uppgifter**, men inga nya namn, utbildningstitlar eller meriter ska hittas på.
- Aktuella kurstider, nästa föreläsning, kurslängd, medlemspriser, antal elever och långsiktiga avkastningssiffror saknar tillräcklig publik verifiering.
- De publicerade [villkoren](https://slowlax.se/terms-and-conditions/) och [integritetstexten](https://slowlax.se/privacy-policy-2/) är engelska och daterade 8 oktober 2024. De beskriver köp, betalningar och leveransadresser som inte fullt ut motsvarar en kopia utan butik; kopiera inte nya juridiska påståenden från den gamla Tibb-verksamheten.

Den nya sajten kan alltså återanvända den verifierade berättelsen, utbildningsinriktningen, kontaktvägen, nyheterna, finansbilderna och färgprofilen samtidigt som den skalar bort bokning, produktförsäljning och kvarvarande test-/mallinnehåll.
