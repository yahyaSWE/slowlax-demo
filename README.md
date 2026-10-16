# Slowlax

Slowlax webbplats byggd med Next.js och grunden från [yahyaSWE/tibb.nu](https://github.com/yahyaSWE/tibb.nu). Publik information och färger utgår från [slowlax.se](https://slowlax.se). Bokning, behandlingar, behandlare, fysisk produktbutik, varukorg och orderhantering ingår inte i Slowlax gränssnitt eller publika API:er.

Artiklar, kurser, medlemsportal, grupper, medlemskap, quiz, skrivuppgifter, kursframsteg, privat material och administration finns kvar. Konton har serverkontrollerade behörigheter, e-postverifiering och lösenordsåterställning. Kursköp och abonnemang kan anslutas till Stripe separat.

Rening kan ingå per betald medlemsperiod, ges som engångskrediter i Bas eller kurspaket och köpas separat. Elever lämnar bolag och antal aktier i elevportalen, och admin publicerar svaret i det privata ärendet. Se [reningsguiden](docs/rening-setup.md) för kvoter, erbjudanden och betalningskonfiguration.

## Kör lokalt

Du behöver Node.js **24.x** och npm.

```powershell
npm install
Copy-Item .env.example .env.local
npm run db:init
npm run setup
npm run dev
```

Öppna [http://127.0.0.1:3000](http://127.0.0.1:3000). `npm run setup` skapar första administratören och frågar efter namn, e-post och ett lösenord med minst 12 tecken. Logga sedan in på `/logga-in` och öppna `/admin`. Vid lokal CLI-installation behövs ingen `SETUP_TOKEN`. För obevakad CLI-installation kan lösenordet tillfälligt anges i `SLOWLAX_ADMIN_PASSWORD`; det gamla namnet `TIBB_ADMIN_PASSWORD` accepteras också.

Med `.env.example` sparas databasen i `data/slowlax.sqlite` och filer i `data/uploads`. Variabelnamnen `TIBB_DATABASE_PATH` och `TIBB_UPLOAD_DIR` är kvar för kompatibilitet. Utan en angiven databassökväg används fortfarande källprojektets `data/tibb.sqlite`, så att en befintlig installation inte tyst byter databas. På en dator med befintlig data: behåll den faktiska sökvägen i din miljöfil.

## Innehåll och vad som kopieras

Nyinstallationer får Slowlax namn, verifierad offentlig kontaktadress `info@slowlax.se`, de tre offentliga nyhetsartiklarna med originaltexter och datum från 6 oktober 2024 samt en publik presentation av kursen **Bygg din egen Halal-pengamaskin**. Bas och Premium förbereds som opublicerade grupper. Kurslektioner och betalda erbjudanden skapas inte. Kontaktmallens amerikanska telefonnummer, adresser och exempeladresser används inte; juridiskt namn och organisationsnummer lämnas tomma tills ägaren fyller i dem.

Källsidans kursmaterial kräver WordPress-inloggning. Git-repot innehåller inte den datan. **Databas, WordPress-användare, lösenord, köphistorik, privata kurser, videor och medlemsmaterial migreras inte automatiskt.** De behöver exporteras och tillföras med behörig åtkomst. Inga inloggningsskydd har kringgåtts. Se [källgranskningen](docs/slowlax-source-audit.md).

Startdata läggs bara in i en ny databas. Befintliga konton, innehåll, framsteg och inställningar skrivs inte över. Äldre tabeller och lagringsnamn kan ligga kvar för databas- och kodkompatibilitet; avstängda boknings- och butiksfunktioner öppnas inte av detta. Befintliga filer eller historiska data raderas inte.

Källsidan visar Bas som gratis och listar Premium med dollarpriser. Dessa belopp har inte omvandlats till kronor eller lagts in som säljbara planer. Den ärvda betalningsmotorn använder **SEK**. Fyll i faktiska priser, tillgång, villkor och momssats innan du öppnar köp. Bas är ett eget gratis medlemskap med konfigurerbara grupper under Admin → Medlemskap. Nya elever ansluts automatiskt och befintliga elever kan gå med själva. Den publika sidan visar Bas och publicerade betalmedlemskap även när betalning är avstängd. [Medlemskapsguiden](docs/memberships-setup.md) och [kursköpsguiden](docs/course-purchases-setup.md) beskriver anslutningarna.

## Vercel och Turso

1. Importera detta projekts Git-repo i Vercel. Välj Next.js, projektroten som Root Directory och Node.js 24.x. `vercel.json` anger bygginställningarna.
2. Anslut en **egen Turso-databas** för Slowlax. Ange `TURSO_DATABASE_URL` och `TURSO_AUTH_TOKEN` som servervariabler. På Vercel används ingen lokal SQLite-fil.
3. Ange `APP_URL` till installationens fungerande HTTPS-adress och `SITE_URL` till dess publika huvudadress. Använd Vercel-adressen tills den egna domänen är ansluten. Variablerna ska beskriva den här installationen, inte en annan befintlig webbplats.
4. Skapa en hemlig `SETUP_TOKEN` med minst 32 slumpmässiga tecken. Publicera och öppna `/setup`. Ange token, namn, e-post och lösenord för den första administratören.
5. Ta bort `SETUP_TOKEN` och publicera igen. Fortsätt via `/logga-in` och `/admin`.

Token kan genereras i din egen terminal:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Databasen initieras vid första användningen. Konton och innehåll sparas i Turso och ligger kvar vid nya kodpubliceringar. En Git-push flyttar inte en lokal databas. Använd en separat databas och separata tjänstnycklar för Preview. Serverhemligheter ska finnas i `.env.local` eller driftmiljön och ska inte ha prefixet `NEXT_PUBLIC_`.

För privata kurs- och gruppfiler ansluter du en **privat Vercel Blob-store**, `BLOB_STORE_ID` och `BLOB_WEBHOOK_PUBLIC_KEY`. Vercel använder OIDC; utanför Vercel kan `BLOB_READ_WRITE_TOKEN` användas. Databasen lagrar filmetadata, själva filerna måste också säkerhetskopieras.

## E-post och betalningar

E-postverifiering och lösenordsåterställning använder Resend. Ange `RESEND_API_KEY`, en verifierad `EMAIL_FROM` och rätt `APP_URL`. Utan anslutning skickas inga verifieringsmejl och nya elever förblir overifierade; befintlig admininloggning fungerar. Se [e-postguiden](docs/email-setup.md).

Kursköp använder `STRIPE_SECRET_KEY` och `STRIPE_WEBHOOK_SECRET` på `/api/kurser/webhook`. Abonnemang använder `/api/medlemskap/webhook`, `MEMBERSHIP_STRIPE_WEBHOOK_SECRET` och en begränsad kundportalkonfiguration i `MEMBERSHIP_STRIPE_PORTAL_CONFIGURATION_ID`. Försäljning är avstängd från början. Testa betalning och åtkomst med testnycklar innan försäljning aktiveras i admin. Ingen extern tjänst eller skarp betalning har anslutits genom att koden kopierats.

## Drift och kontroller

```powershell
npm run typecheck
npm test
npm run build
npm start
```

En egen Node-server behöver HTTPS och beständig disk för SQLite och filer. Vercel behöver Turso och privat Blob-lagring för uppladdningar. Läs [drift- och återställningsguiden](docs/operations.md) för säkerhetskopiering, kontoåterställning och verifiering av en återställd kopia.

Tester använder separata tillfälliga databaser. De kontrollerar bland annat åtkomst, publicering, aktiviteter, innehåll, migrationer och betalningsstatus. Historiska databas-/modultester kan fortfarande använda källprojektets interna namn och tabeller. De aktiverar inga borttagna publika funktioner.

Den kopierade koden har inte publicerats externt automatiskt. Domänanslutning, privata innehållsexporter, verksamhetens juridiska uppgifter, externa tjänster och skarpa betalningar görs i den faktiska driftmiljön.

## Kurspaket och flera grupper

Skapa paket under **Admin → Kurspaket → Skapa kurspaket**. Ett paket innehåller minst två befintliga kurser. Ange exempelvis namnet **Bas-kit**, välj kurser, beskriv innehållet och ange paketpriset. Alla ingående kurser behöver vara publicerade innan paketet publiceras. Paketen presenteras separat på `/paket`.

I paketets köpinställningar väljer du vilka grupper som ska ingå efter ett verifierat köp och eventuell tidsgräns för gruppåtkomsten. Även en enskild kurs kan kopplas till flera grupper under sina köpinställningar. Kursköp och paket använder samma Stripe-integration och webhook `/api/kurser/webhook`.

Ett medlemskap kan kopplas till flera grupper i medlemskapsformuläret. De grupper som ingår visas före köpet. Alla grupper följer abonnemangets betalda period. Överlappande abonnemang hanteras för att undvika dubbla återkommande betalningar för samma grupp.

Köpens kurs- och gruppinnehåll sparas när köpet inleds. Senare ändringar i ett paket eller erbjudande flyttar inte en tidigare köpares tillgång till andra kurser eller grupper. Återbetalningar och tvister hanteras för det berörda köpet; separat åtkomst från andra köp eller manuella tilldelningar finns kvar.

## Automatisk nyhetsbrevsinbjudan med Kit

Öppna **Admin → Nyhetsbrev**. Lägg servernyckeln i `KIT_API_KEY`, välj formulär-ID och vid behov tagg-ID, kontrollera formulärets bekräftelseflöde i Kit och aktivera anslutningen. Nyckeln visas aldrig i admin. Det valda formuläret används också av de publika nyhetsbrevsformulären.

Nya elever får information vid registreringen. Deras inbjudan köas tillsammans med elevkontot och skickas efter att elevens e-postadress har verifierats. Eleven bekräftar därefter prenumerationen i Kits eget mejl. Tidigare avregistrerade adresser återaktiveras inte automatiskt. Ett Kit-fel hindrar inte registreringen och väntande försök finns kvar i kön.

Ange `CRON_SECRET` och schemalägg den skyddade endpointen `/api/cron/kit-newsletter` för automatiska omförsök. Misslyckade försök kan även startas om från administrationen. Befintliga elever importeras inte i efterhand. Se [Kit-guiden](docs/kit-setup.md) för inställningar och teststeg.

## Supabase

PostgreSQL-adapter, databasflytt och Supabase Auth är förberedda. Aktivering kräver fungerande projektuppgifter, verifierad databasflytt och färdiga Auth-inställningar. Webbplatsen använder fortsatt SQLite/Turso och den lokala kontohanteringen medan `SUPABASE_DATABASE_ENABLED` och `SUPABASE_AUTH_ENABLED` är avstängda. Se [Supabase-guiden](docs/supabase-setup.md) för säkra kontroller, import, e-postmallar och aktivering. Äldre anteckningar i `docs/drafts` används inte av applikationen.

## Valfria kursdiplom

Under **Admin → Kurser → välj kurs → Diplom efter genomförd kurs** väljer du om kursen ska erbjuda diplom. Det är avstängt från början och sparas separat från kursens övriga inställningar. I ett kurspaket styr varje ingående kurs sitt eget diplom.

En verifierad elev med kursåtkomst kan skapa sitt diplom när alla lektioner är markerade som genomförda och alla aktiva quiz och skrivuppgifter är godkända i sina aktuella versioner. Eleven ser vad som återstår på kurssidan. Kursen behöver innehålla minst en lektion.

Diplomet hämtas som PDF från kurssidan eller **Elevportal → Mina diplom**. Det innehåller elevens namn, kursens titel, Slowlax som utfärdare, genomförandedatum, utfärdandedatum och ett unikt diplom-ID. Uppgifterna sparas vid utfärdningen; senare namn- eller kursändringar skriver inte om historiken. Upprepade anrop ger samma diplom. Utfärdade diplom finns kvar när kursåtkomsten upphör, kursen raderas eller nya diplom stängs av. När ett elevkonto raderas tas även elevens diplom bort.

PDF-filerna skapas vid hämtning med lokala typsnitt. Nedladdning kräver inloggning som diplomets ägare eller administratör. Funktionen skickar inga mejl och kräver ingen extern PDF-tjänst. Samma funktion stöds av SQLite/Turso och PostgreSQL.
