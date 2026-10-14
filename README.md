# Tibb.nu

En Next.js-tjänst för behandlingar, bokning, artiklar, kurser, elevportal och en valfri produktbutik. Gränssnittet är på svenska, med olivgrönt och jordtoner. Data sparas lokalt i SQLite eller i en beständig Turso/libSQL-databas när appen körs på Vercel.

## Publicera på Vercel och skapa första admin

1. Importera GitHub-repot `yahyaSWE/tibb.nu` som ett nytt Vercel-projekt. Välj **Next.js** och **Node.js 24.x**. Behåll standardkommandona för installation och build.

   `vercel.json` anger Next.js, `npm run build` och `.next` även om projektet tidigare har identifierats som **Other**. Projektets **Root Directory** ska vara projektroten (`./`). Om en gammal deployment visar Vercels `404: NOT_FOUND`, publicera den senaste committen på `main`; kör inte bara om en äldre commit utan konfigurationsfilen.

2. Anslut **Turso** via Vercel Marketplace/Storage, eller skapa en libSQL-databas hos Turso och lägg in anslutningen själv. Välj gärna en europeisk databasregion. [Turso-integrationen](https://vercel.com/marketplace/tursocloud/database) använder miljövariablerna `TURSO_DATABASE_URL` och `TURSO_AUTH_TOKEN`.
3. Lägg in följande under projektets **Settings → Environment Variables**, för **Production**:

   | Variabel             | Värde                                                                         |
   | -------------------- | ----------------------------------------------------------------------------- |
   | `TURSO_DATABASE_URL` | Turso-databasens `libsql://…`-adress                                          |
   | `TURSO_AUTH_TOKEN`   | Databasens hemliga åtkomsttoken                                               |
   | `SETUP_TOKEN`        | En slumpmässig, hemlig token med minst 32 tecken                              |
   | `APP_URL`            | Din offentliga adress, till exempel `https://tibb.nu` eller din Vercel-adress |

4. Publicera eller kör **Redeploy** när miljövariablerna är sparade. Databastabellerna skapas automatiskt vid första användningen. `npm run db:init` kan också köras lokalt med databasens miljövariabler om du vill förbereda tabellerna före publicering.
5. Öppna `https://din-domän/setup`. Ange samma **SETUP_TOKEN** som du sparade i Vercel, ditt namn, din e-postadress och ett lösenord med minst 12 tecken. Skicka formuläret. Du blir inloggad som admin.
6. Ta bort `SETUP_TOKEN` från Vercels miljövariabler och kör **Redeploy**. Det redan skapade administratörskontot finns kvar i databasen. Logga hädanefter in via `/logga-in` och administrera sidan via `/admin`.

Du kan skapa en slumpmässig token i din egen terminal med:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Klistra in resultatet i Vercel och i setup-formuläret; lägg det inte i Git eller i chatten. Inga av dessa variabler ska ha prefixet `NEXT_PUBLIC_`. Se [Vercels miljövariabler](https://vercel.com/docs/environment-variables).

Vercel behöver en extern databas eftersom funktionernas lokala disk inte ger gemensam beständig lagring. Appen använder därför aldrig en lokal SQLite-fil på Vercel. Utan databasanslutning visas en tillfällig välkomstsida och bokningar hålls stängda. [Vercels förklaring](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel).

GitHub innehåller koden. Konton, artiklar, kurser och bokningar som du lagt in lokalt följer **inte** med en Git-push; de sparas i den lokala databasen. En ny Turso-databas får ett eget första adminkonto. Ändringar från admin i den publicerade tjänsten sparas i Turso och finns kvar efter nya driftsättningar.

Använd en **separat databas** för Vercel Preview om du vill prova ändringar; koppla inte oavsiktligt utvecklings-/previewmiljöer till din skarpa kunddatabas. Databasanslutning och skarpa Stripe-betalningar har inte testats mot ditt konto eftersom nycklarna inte har anslutits här.

## Starta lokalt

Du behöver **Node.js 24.x**.

```sh
npm install
npm run dev
```

Öppna http://localhost:3000. En `.env.local` med en slumpmässig konfigurationstoken finns redan i den här arbetsmappen och är undantagen från Git. Vid en ny installation kopierar du `.env.example` till `.env.local` och fyller i `APP_URL`.

## Fillagring för bilder och kursmaterial

På Vercel behöver uppladdningar **privat Vercel Blob-lagring** så att filerna finns kvar efter nya publiceringar. Under projektets **Storage → Create Storage → Blob** väljer du **Private**, ett namn och region, gärna Stockholm. Anslut lagringen till projektets Production och önskade Preview-miljöer. Kör sedan en ny publicering.

Anslutningen skapar `BLOB_STORE_ID` och `BLOB_WEBHOOK_PUBLIC_KEY`. Båda behövs för uppladdningar; Vercel tillhandahåller automatiskt den tillfälliga OIDC-åtkomsten. En separat read-write-token behöver inte skapas. Om appen körs utanför Vercel och ska använda Blob kan `BLOB_READ_WRITE_TOKEN` användas tillsammans med `BLOB_WEBHOOK_PUBLIC_KEY`. Dessa servervariabler ska aldrig ha prefixet `NEXT_PUBLIC_`. Se [privat Blob-lagring](https://vercel.com/docs/vercel-blob/private-storage) och [Blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk).

Lokalt sparas filerna på beständig disk i `data/uploads`, eller sökvägen i `TIBB_UPLOAD_DIR`. Säkerhetskopiera både filerna och databasen. Lokala filer följer inte med en Git-push till Vercel.

Behandlarbilder kan vara JPG, PNG eller WebP, högst **2 MB**. Appen skalar bilden till högst 600 × 600 pixlar och tar bort bildmetadata. Kursfiler kan vara **PDF, DOC eller DOCX**, högst **20 MB per fil** och 20 filer per lektion. Filen laddas upp när du väljer den; kopplingen till behandlaren eller lektionen sparas när du skickar formuläret. Borttagning i formuläret tar bort kopplingen när du sparar.

Kursfiler hämtas genom appen efter en behörighetskontroll. En elev måste ha tillgång till den publicerade kursen och filen måste fortfarande vara kopplad till en lektion. Indragen tillgång eller avpublicering stoppar nya nedladdningar. Aktiva behandlarbilder visas på bokningssidan.

## Skapa ditt administratörskonto

För **lokal utveckling**: kör följande i en separat terminal i projektmappen och ange ditt namn, din e-postadress och ett lösenord med minst 12 tecken. Lösenordet döljs när du skriver. På Vercel använder du webbsidan `/setup` enligt guiden ovan.

```sh
npm run setup
```

Logga sedan in på `/logga-in` och öppna `/admin`. Det finns inga förinställda konton eller lösenord. Det första kontot skapas bara en gång. Alternativt kan du använda `/setup` med en lång slumpmässig `SETUP_TOKEN` i servermiljön. Ta bort token ur miljön när kontot har skapats.

## Arbeta i admin

- **Behandlingar:** skapa och ändra namn, beskrivning, längd och pris. Aktivera en behandling för att visa den på bokningssidan. Startbehandlingarna är inaktiva exempel.
- **Behandlare:** lägg till namn, presentation och en valfri bild för varje behandlare. Bilden visas när kunden väljer behandlare; välj **Ta bort** och spara för att dölja den. Befintliga tider och bokningar kopplas vid uppgraderingen till behandlaren **Tibb.nu**, vars namn du kan ändra. Inaktiva behandlare visas inte för kunder; deras bokningar och historik behålls.
- **Tillgängliga tider:** välj behandling, behandlare, datumperiod, veckodagar och arbetstider. Tider skapas automatiskt utifrån behandlingens längd, med plats för återkommande raster. Du kan publicera upp till 90 dagar åt gången; nya perioder läggs till vid behov. Befintliga tider och bokningar dubbleras inte. Enstaka tider kan fortfarande läggas till separat. Varje behandlare har sitt eget schema och dubbelbokningsskydd.
- **Raster och ledighet:** spärra hela dagar eller ett sammanhängande tidsintervall för en behandlare eller för alla. Spärrade tider går inte att boka, även från ett äldre öppet bokningsformulär. Ta bort spärren för att återöppna de publicerade tiderna. En spärr som överlappar en befintlig bokning avvisas; hantera bokningen först. Att ta bort en publicerad period tar bara bort dess framtida lediga tider och bevarar bokningshistoriken. Alla tider hanteras i Europe/Stockholm, även vid sommartid.
- **Bokningar:** se kontaktuppgifter och betalningsstatus, hantera besöksstatus och avbokningar. Bokningens namn, längd och pris sparas separat så att senare prisändringar inte ändrar befintliga bokningar.
- **Artiklar:** skriv titel, ingress och brödtext. Spara utkast eller publicera. Publicerade artiklar visas direkt på webbplatsen.
- **Kurser:** skapa kursinformation och lägg till ordnade lektioner med text, video och material. Välj **Ladda upp PDF eller Word** för att bifoga filer direkt; externa materiallänkar fungerar också. En lektion kan bestå enbart av uppladdat material. Eleverna kan ladda ned filerna i elevportalen. Förhandsgranska där och publicera när kursen är klar. Startkursen och startartikeln är utkast.
- **Elever:** eleven skapar sitt konto på `/registrera`. Tilldela en kurs med elevens e-postadress. Återkallad tillgång stoppar åtkomst men bevarar framsteg om du senare tilldelar kursen igen.
- **Inställningar:** ändra namn, kontaktuppgifter, plats och betalningsalternativ.
- **Butik:** butiken är avstängd från början. Förbered frakt, hämtning, köpvillkor och förhandsvisning i admin. Öppna butiken först när du vill börja sälja.
- **Produkter:** skapa produktutkast med bild, kort beskrivning, pris inklusive moms och tillgängligt lager. Lägg vid behov till en fördjupad beskrivning med den visuella editorn: rubriker, formaterad text, listor, länkar och uppladdade bilder med alternativtext och bildtext. Förhandsgranska hela produkten från redigeringssidan även medan butiken är stängd. En produkt visas för kunder först när både produkten är publicerad och butiken är öppen.
- **Grupper och medlemskap:** koppla kurser, tilldela verifierade elever manuellt och publicera privat gruppmaterial med text, bilder, PDF och Word-filer. Förbered månads- och årsabonnemang som utkast och aktivera försäljningen när Stripe är anslutet. Elever hittar innehållet under Mina grupper och betalningarna under Mina abonnemang. Separat permanent kurstillgång bevaras när ett abonnemang avslutas. Läs [installationsguiden för medlemskap](docs/memberships-setup.md).
- **Beställningar:** se verifierad betalning, kunduppgifter och leveransval. Markera skickad/redo för hämtning/hämtad och ange ett valfritt spårningsnummer.

Kurser kan tilldelas av admin eller köpas med en engångsbetalning via Stripe; välj vid behov **Grupp efter köp** i kursbyggaren för automatisk gruppåtkomst med eller utan slutdatum. Läs [guiden för kursköp och automatisk grupptilldelning](docs/course-purchases-setup.md). Eleven ser tilldelade publicerade kurser och kan markera lektioner som slutförda. Text lagras och återges som vanlig text med stycken.

### Förbered produktbutiken

Butiken använder den befintliga databasen, admininloggningen och Stripe Checkout. Medusa behövs inte för denna version. Både frakt inom Sverige och hämtning kan erbjudas. Varukorg, kassa och beställningssida ingår; nya databasfält migreras automatiskt utan att publicera produkter eller öppna butiken.

Läs [butikens installationsguide](docs/shop-setup.md) innan du öppnar. Produktbetalningarna behöver en **separat** Stripe-webhook på `/api/shop/webhook` och `SHOP_STRIPE_WEBHOOK_SECRET`. Administratören kan förbereda produkter även innan Stripe är anslutet. Produktbilder är normaliserade WebP-bilder i databasen och ingår i databasens säkerhetskopiering.

### Quiz och skrivuppgifter

Öppna en sparad lektion i kursbyggaren och välj **Lägg till quiz eller skrivuppgift**. En lektion kan ha flera namngivna aktiviteter i valfri ordning.

- **Quiz:** bygg 1–30 flervalsfrågor med 2–6 alternativ och ett rätt svar per fråga. Välj gränsen för godkänt. Eleven får automatisk rättning, återkoppling per fråga och en historik över sina försök. Facit rättas på servern och visas först efter att svaren lämnats in.
- **Skrivuppgift:** ange instruktionen. Eleven kan spara ett utkast eller lämna in sin text (högst 20 000 tecken). Utkast är privata för eleven. Under kursens **Elevresultat och inlämningar** läser du inskickade uppgifter, ger återkoppling och väljer **Godkänd** eller **Behöver komplettering**. En ny inlämning bevarar den tidigare texten och bedömningen.

Inaktivera en aktivitet genom att avmarkera **Aktiv i elevportalen**. Historik bevaras. Innehållsändringar sparas som nya versioner, så tidigare försök behåller de frågor och instruktioner som eleven svarade på. Quizresultat och uppgifter ändrar inte automatiskt markeringen av en lektion som slutförd. De nya tabellerna skapas automatiskt genom den vanliga databasuppgraderingen; befintliga kurser, lektioner och framsteg bevaras.

Om en elev har en aktivitet öppen när innehållet ändras bevaras det gamla formuläret. Eleven får en varning, kan kopiera sina osparade svar och väljer själv när den nya versionen ska öppnas. Den gamla versionen kan inte lämnas in.

### Kursvideor

YouTube-lektioner börjar med en enkel startknapp och laddar den externa spelaren först när eleven väljer att spela. Spelaren använder `youtube-nocookie.com`, svenska kontroller, uppspelning direkt i sidan på mobil och rekommendationer från samma kanal. YouTube styr fortfarande logotyp, kanaluppgifter och utgående länkar: `modestbranding` och `showinfo` fungerar inte längre. Se [YouTubes spelardokumentation](https://developers.google.com/youtube/player_parameters).

En direkt HTTPS-länk till en MP4-, WebM- eller OGG-fil använder Tibb.nu:s egen videospelare utan YouTube-gränssnitt. Dessa filer behöver lagras hos en videotjänst eller i egen fillagring; dokumentuppladdningen i kursbyggaren är avsedd för PDF och Word.

På bokningssidan visas lediga dagar i en månadskalender för vald behandling och behandlare. Kunden väljer datum och ser sedan bara den dagens klockslag. Det går att bläddra mellan månader eller välja månad direkt. Vald behandlare visas även på bokningsbekräftelsen.

## Självtest med fem faser

`/sjalvtest` är ett kostnadsfritt konstitutionstest för utbildning och självreflektion, inspirerat av Five Phases/Wu Xing. Det kräver inget konto. Fyrtio frågor visas en i taget i blandad ordning. Frågedata, resultatbeskrivningar, poängberäkning och gränssnitt ligger separat i `src/lib/five-phases` och `src/components/five-phases`.

Varje fas har åtta frågor med svar från 1 till 5. Råpoängen 8–40 normaliseras med `Math.round(((rawScore - 8) / 32) * 100)`. Alla fem matchningspoäng visas på en skala 0–100, tillsammans med de två högsta faserna. Högst sex poängs skillnad lyfts fram som en blandkonstitution. Lika högsta poäng redovisas uttryckligen; ordningen för lika poäng är Trä, Eld, Jord, Metall, Vatten och innebär ingen ytterligare bedömning. Poängen är inte sannolikheter eller medicinska bedömningar.

Svar, frågeordning och resultat sparas bara i den aktuella webbläsarens `localStorage` under `tibb.five-phases.session.v1` och skickas inte till servern. Omladdning återställer pågående test eller resultat. **Gör om testet** ber om bekräftelse och rensar enbart testets egna svar. Om lokal lagring är blockerad fungerar testet under det aktuella besöket och visar ett meddelande om att svaren inte kan sparas.

Starta `npm run dev` och öppna `http://127.0.0.1:3000/sjalvtest` för att testa lokalt. De automatiserade kontrollerna körs med `npm test` och täcker bland annat poänggränser, primär och sekundär fas, lika resultat, ofullständiga svar och återställning av sparade test.

## Anslut Stripe

Bokning med **betalning vid besöket** fungerar utan en extern betaltjänst. Kortbetalning är en riktig Stripe Checkout-integration som blir tillgänglig först när den är korrekt konfigurerad.

Ange följande som serverhemligheter i `.env.local` lokalt eller hos din driftleverantör:

```dotenv
APP_URL=https://tibb.nu
STRIPE_SECRET_KEY=din_hemliga_stripe_nyckel
STRIPE_WEBHOOK_SECRET=din_webhook_hemlighet
```

Använd Stripes testnycklar först. Registrera webhookadressen `https://tibb.nu/api/stripe/webhook` med händelserna `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` och `charge.refunded`. När miljövariablerna är sparade kör du **Redeploy på Vercel**, eller startar om den lokala servern. Aktivera därefter kortbetalning under **Admin → Inställningar**.

Lokalt kan Stripe CLI vidarebefordra testhändelser till `localhost:3000/api/stripe/webhook`; använd den webhookhemlighet CLI:n ger. API-nycklar och webhookhemligheter skickas aldrig till webbläsaren. Betalningar bekräftas med signerade webhooks och kontrollerat belopp/valuta. Besökets pris tas från databasen. Att öppna bekräftelsesidan markerar aldrig en bokning som betald.

Kortbokningar reserveras i 35 minuter. Avbruten eller utgången betalning frigör tiden. Vid en betalning som kommer efter att reservationen har frigjorts återbetalas betalningen via Stripe. Återbetalningar för redan bekräftade besök hanteras i Stripe Dashboard; status uppdateras via webhook. API-anslutningen och betalningsflödet behöver verifieras med ditt Stripe-konto före skarp användning.

## Drift

```sh
npm run build
npm start
```

På **Vercel** följer du guiden ovan och använder Turso. Som alternativ kan du drifta en egen Node-server med **beständig disk**, HTTPS och en appinstans. Utan Turso-inställningar används `TIBB_DATABASE_PATH` (standard: `data/tibb.sqlite`) utanför Vercel. Dockerfiler finns för det alternativet med en beständig datavolym; sätt `APP_URL` till din offentliga HTTPS-adress.

`vercel.json` placerar serverfunktionerna i Dublin (`dub1`), nära projektets nuvarande Turso-databas i Irland. Anpassa regionen om databasen senare flyttas. Menyer förhämtar nästa sidas ram och laddningsvy; bokningstider och behörigheter hämtas och kontrolleras fortfarande på servern. Vanliga sparningar uppdaterar berörda sidor, medan ändrade webbplatsinställningar uppdaterar den gemensamma layouten.

Databasen kontrollerar sin schemaversion en gång per serverinstans. Komplett migrering och startdata körs bara när en uppgradering behövs. Vid framtida schemaändringar ska `SCHEMA_VERSION` i `src/lib/schema.ts` höjas och migreringen läggas i `src/lib/database.ts`; versionen sparas atomiskt när migreringen lyckas.

Starta Docker med `docker compose --env-file .env.local up --build -d` när miljövärden och en HTTPS-proxy är konfigurerade. Dockerkonfigurationen har förberetts, men har inte körts i den här miljön.

Säkerhetskopiera med SQLite backup API eller en konsekvent SQLite-snapshot; kopiera inte bara en aktiv databasfil och ignorera WAL-filen. Starta om utvecklingsservern om du kör CLI-konfiguration eller flyttar databasen under utveckling.

Sessionskakan är HttpOnly, SameSite=Lax och Secure i produktion. Roller och kursåtkomst kontrolleras även vid serveråtgärder. Lösenord skyddas med saltad scrypt. Bokningar och ändringar valideras på servern. Vercels betrodda besökaradress används för anropsgränser; `TRUST_PROXY=1` ska bara användas om din egen proxy ersätter inkommande `X-Forwarded-For`. Utan betrodd adress används konto-/bokningsgränser utan en gemensam spärr för alla besökare.

Innan du öppnar för kunder: fyll i fungerande kontaktuppgifter, besöksadress, korrekta priser och tider. Admin → Inställningar har redigerbara verksamhetsuppgifter, återbudsregel, kursåtkomst och integritetsbeslut. Standardvärden enligt ägaren: Joart Group AB, org.nr 559363-3893, återbud minst 24 timmar före besöket och kursåtkomst utan tidsgräns. Rättslig grund, lagringstider och leverantörsöverföringar behöver fyllas i efter verksamhetens faktiska bedömning.

Resend är förberett för elevverifiering, lösenordsåterställning och bokningsmejl men behöver anslutas och leveranstestas. Se [e-postguiden](docs/email-setup.md) och [drift-/återställningsguiden](docs/operations.md). Nya kursgrants kräver verifierad elevadress; befintlig kursåtkomst bevaras vid migrering. Bekräftelsesidan visar sanningsenlig utskicksstatus och admin kan behandla väntande jobb. Nya bokningar behåller sin återbudsregel även när allmänna villkor ändras.

## Sökoptimering och AI-sök

Offentliga sidor har unika titlar, beskrivningar och canonical-adresser samt delningsbilder för Open Graph och Twitter. Startsidan beskriver verksamheten i Jönköping, och `/om` presenterar Johan Yahya Blomdahls angivna utbildningar. `/vanliga-fragor` ger synliga svar om bokning, priser, behandlare, kursåtkomst och självtestet. Inga legitimationer, adresser, recensioner eller effektpåståenden har hittats på.

`/sitemap.xml` hämtar publicerade artiklar och kurser direkt från databasen. Utkast, privata lektioner, bokningsreferenser och filer listas inte. Ändringsdatum kommer från sparade uppdateringar; statiska sidor får inget påhittat datum. JSON-LD beskriver webbplatsen, verksamheten, behandlaren, artiklar, kurser och brödsmulor med fakta som även visas på sidorna. Artiklar märker skapandetid och uppdateringstid; en första publiceringstid finns inte i datamodellen och anges därför inte.

`robots.txt` tillåter offentligt innehåll för vanliga sökrobotar, OAI-SearchBot och PerplexityBot med samma privata undantag. Preview och lokal utveckling spärras. Privata sidor har även `noindex` i metadata/HTTP-header; befintlig inloggning och behörighetskontroll skyddar uppgifterna. `robots.txt` är inte ett åtkomstskydd. `llms.txt` är en kompletterande offentlig länkkarta och ger ingen garanterad förbättring i sökresultaten. Ingen särskild regel har lagts till för GPTBot, som har ett annat syfte än ChatGPT Search.

### Innan och efter egen domän

1. Lägg `SITE_URL=https://tibbnu.vercel.app` i Vercels **Production**-miljö och publicera ändringarna. Variabeln styr canonical, sitemap och schema utan att ändra betalningarnas `APP_URL`. Vercels automatiska `VERCEL_ENV` styr om miljön får indexeras. En ännu okonfigurerad installation får inte indexeras och svarar med tillfälligt HTTP 503.
2. Verifiera webbplatsen i [Google Search Console](https://search.google.com/search-console) och [Bing Webmaster Tools](https://www.bing.com/webmasters/). DNS-verifiering fungerar när du kontrollerar domänen. För verifiering med HTML-meta fyller du i **enbart innehållsvärdet** i `GOOGLE_SITE_VERIFICATION` respektive `BING_SITE_VERIFICATION` och publicerar på nytt. Dessa verifieringskoder är offentliga, men lägg inte in kontolösenord eller hemliga API-nycklar.
3. Skicka `https://tibbnu.vercel.app/sitemap.xml` i de båda verktygen. Inspektera startsidan, bokningssidan och publicerade artiklar. Kontrollera eventuella blockerade robotar i Vercels loggar/firewall; stäng inte av skydd generellt.
4. När **tibb.nu** är ansluten med fungerande HTTPS i Vercel: välj den som huvudadress och ändra `SITE_URL` och `APP_URL` till `https://tibb.nu`. Publicera på nytt. Ställ in permanent omdirigering från Vercel-adressen och eventuell `www`-adress till huvudadressen via domäninställningarna. Kontrollera särskilt Stripe-returadresser/webhook vid domänbytet.
5. Verifiera även tibb.nu i sökverktygen, skicka den nya sitemapen och använd Search Consoles adressändring om den gamla verifierade adressen stöder det. Canonical och samtliga schema-/sitemap-adresser ändras tillsammans med `SITE_URL`.

Fyll i korrekta kontaktuppgifter i admin. Fortsätt publicera egna, användbara texter med tydliga källor där medicinska sakuppgifter används. Indexering och synlighet i Google eller AI-sök avgörs av respektive tjänst och kan inte garanteras genom kodändringar. Se [Googles vägledning för AI-sök](https://developers.google.com/search/docs/appearance/ai-features) och [OpenAI:s dokumentation om sökrobotar](https://developers.openai.com/api/docs/bots).

## Kontroller av implementationen

```sh
npm run typecheck
npm test
npm run build
```

Tester använder separata tillfälliga databaser och täcker bland annat verklig konkurrens mellan bokningar, roller, skyddade kurslektioner, publicering, prisbevarande, betalningsstatus och svensk tidszon.

`scripts/e2e-navigation.ts` kontrollerar verkliga formulärsparningar, inloggning/utloggning och skyddade HTML- och RSC-svar vid förhämtning. Skapa först en ny databas med `npx tsx scripts/e2e-fixture.ts`, starta en separat lokal server med den utskrivna `TIBB_DATABASE_PATH` och kör `npx tsx scripts/e2e-navigation.ts "sökvägen till testdatabasen"`. Servern ska sakna Turso- och Vercel-miljövariabler. Testet accepterar bara den märkta lokala testdatabasen och skriver aldrig till produktionsdata.

`scripts/e2e-seo.ts` kontrollerar serverns HTML för elva offentliga testadresser, sidornas canonical/metadata/JSON-LD, privata sidors indexeringsheader, opublicerade artiklar/kurser och den genererade delningsbilden. Mot en separat lokal server med E2E-fixturen kör du `npm exec -- tsx scripts/e2e-seo.ts http://127.0.0.1:3001 https://tibbnu.vercel.app`. För att testa produktionsindexering på **samma isolerade lokala server** kan du sätta `VERCEL_ENV=production` (men inte `VERCEL` eller Turso-variabler) och lägga till `--indexable` i kontrollkommandot. Kontrollen gör inga databasändringar och avvisar andra värdar än localhost/127.0.0.1. Återställ den lokala servern efter simuleringen.

## Bild

`public/images/olive-still-life.png` är skapad med det inbyggda imagegen-verktyget för detta projekt. Den exakta prompten sparas i `public/images/olive-still-life.prompt.txt`. Prompten beskrev ett fotografiskt stilleben med olivkvistar i handgjord keramik på travertin, varm kalkstensvägg och naturligt solljus, i olivgrönt och jordtoner utan text eller personer. Det finns inga externa fotografier eller påhittade patientomdömen på webbplatsen.

Teknisk referens: [Next.js](https://nextjs.org/docs/app), [Turso/libSQL](https://docs.turso.tech/sdk/ts/reference), [Stripe Checkout](https://docs.stripe.com/payments/checkout).

## Transaktionell e-post och elevägarskap

Se även [åtgärder och återstående lanseringsinställningar](docs/launch-improvements-2026-10-08.md).

Resend-adaptern använder serverns `RESEND_API_KEY`, verifierade `EMAIL_FROM` och betrodda `APP_URL`. Se [konfiguration och kontroller](docs/email-setup.md). Saknad konfiguration lämnar elever overifierade och visar ett tydligt fel; befintlig admininloggning och redan tilldelade kurser fungerar. Nya kurstilldelningar kräver verifierad adress. Verifiering och lösenordsåterställning använder hashade engångstoken med utgångstid och revokerar gamla sessioner.

Bekräftade bokningar köar neutrala kund-/administratörsmejl i en beständig outbox. Första försöket sker automatiskt; admin kan behandla väntande jobb. Ett separat schemalagt återförsöksjobb kräver `CRON_SECRET` och konfigureras när tjänsten ansluts. Accepterat av Resend är ingen garanti om inkorgsleverans. Tester täcker bland annat osäkra svar efter acceptans, idempotenta parallella utskick, återförsöksgränser, tokenförbrukning och att gamla elevers åtkomst bevaras, utan verkliga e-postanrop.
