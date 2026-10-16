# Supabase: databas och konton

Koden kan använda Supabase PostgreSQL och Supabase Auth. De två växlingarna är avstängda från början. En ifylld projektadress eller nyckel ändrar inte webbplatsens nuvarande databas eller inloggning.

## Uppgifter i `.env.local`

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://ditt-projekt.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
DATABASE_URL=postgresql://...
SUPABASE_DATABASE_ENABLED=false
SUPABASE_AUTH_ENABLED=false
```

Projektadressen och publishable key finns i projektets **Connect**-dialog. Serverns secret key finns under **Settings → API Keys**. Databasens anslutningssträng finns under **Connect**. Kopiera strängen för **Session pooler** när den lokala miljön använder IPv4 och fyll i databaslösenordet. `[YOUR-PASSWORD]` är en platshållare och fungerar inte som lösenord. Specialtecken i lösenordet behöver URL-kodas.

Hemliga värden hör bara hemma i serverns miljövariabler. `DATABASE_URL` och `SUPABASE_SECRET_KEY` får aldrig ha prefixet `NEXT_PUBLIC_`, hamna i Git eller skrivas i loggar. `.env.local` är undantagen från Git.

Anslutningen verifierar databasens TLS-certifikat. Om certifikatkedjan inte betros av datorn kan serverns CA-certifikat hämtas från Supabases databasinställningar och läggas i `SUPABASE_DB_CA_CERT` som PEM-text. Bokstavliga `\n` stöds. Certifikatkontrollen ska vara kvar.

## Kontrollera utan att ändra Supabase

```powershell
npm run supabase:check
```

Kontrollen visar bara vilka värden som är ifyllda och om anslutningarna fungerar. Den gör ett publikt Auth-uppslag, provar serverns användaradministration utan att ändra konton och läser databasens schemastatus. Den skriver aldrig ut nycklar, lösenord eller elevadresser. Ett saknat schema ger resultatet **behöver installeras**. Inga tabeller eller elever skapas av kontrollen.

## Flytta befintligt lokalt innehåll

Låt de båda växlingarna vara `false` tills flytten och kontoflödet är kontrollerade. Förhandsgranska först den nuvarande SQLite-databasen:

```powershell
npm run supabase:import
```

Förhandsgranskningen läser bara SQLite och visar radantal samt ett kontrollvärde. Den kontaktar inte Supabase. En annan källa kan väljas med `--sqlite=C:\sökväg\databas.sqlite`.

När förhandsgranskningen är granskad behöver registrering och redigering pausas under själva flytten. Kör sedan:

```powershell
npm run supabase:import -- --apply
```

Importen tar först en konsekvent SQLite-säkerhetskopia i den Git-undantagna mappen `backups`. Den använder sedan just den kopian som källa. Den skapar ett nytt privat `slowlax`-schema och kopierar innehåll, elevrelationer, aktiviteter, paket, grupper, Bas-medlemskap, köphistorik, utfärdade diplom och sparade inställningar i en PostgreSQL-transaktion. ID-värden och historiska köp behålls. Radantal, relationer och ID-sekvenser verifieras. Vid fel rullas hela transaktionen tillbaka.

Importen vägrar att skriva över ett befintligt `slowlax`-schema. Andra scheman i Supabase ändras inte. Vanliga webbplatsanrop skapar aldrig fjärrschema. Kör inte `db:init` före importen: det kommandot är avsett för en ny installation utan befintligt innehåll och lägger in startinnehåll.

Lokala inloggningssessioner, återställningslänkar och tillfälliga uppladdningar/arbetslås följer inte med. Filer som ligger på disk eller i Vercel Blob stannar i sin nuvarande lagring; denna integration flyttar databas och kontohantering, inte filernas bytes. Säkerhetskopian innehåller privata kontouppgifter och ska förvaras som övriga databasbackuper.

## Databas med tidigare schemaversion

Nya installationer och importer får schemaversion 4 med kursdiplom, Bas-medlemskap och Rening. Om `slowlax` redan installerats med version 1, 2 eller 3: säkerhetskopiera databasen och kör `npm run db:init` i den konfigurerade PostgreSQL-miljön under ett underhållsfönster. Kommandot tillämpar de saknade separata migreringarna i ordning. Befintliga kurser får diplom avstängt, befintliga elever ansluts inte till Bas automatiskt och äldre köp ger inga reningskrediter automatiskt. Vanliga webbplatsanrop vägrar använda en äldre schemaversion och utför ingen automatisk fjärrmigrering.

Rening läggs till med `202610160004_purification.sql`. Importen bevarar kvoter, ärenden, privata innehav, svar och kreditbokföring tillsammans med köpens accepterade villkor. Tabellerna ligger i det privata schemat och är stängda för webbläsarens databasroller. Separat reningsförsäljning börjar avstängd. Se [reningsguiden](rening-setup.md).

Adressen `/medlemskap/bas` är reserverad för det kostnadsfria medlemskapet. Om en äldre betalplan redan använder adressnamnet `bas` får just den planen ett unikt adressnamn som börjar med `bas-betalt-` vid migrering eller import. Planens ID, namn, pris, abonnemang och historiska köp ändras inte.

## Förbered Supabase Auth

Konfigurera e-postinloggning, obligatorisk e-postbekräftelse, webbplatsadress, tillåtna återadresser och mejlmallar i Supabase enligt [auth-guiden](supabase-auth-setup.md). Supabase sköter Auth-mejlen när dess inloggning är aktiverad. KIT används separat för nyhetsbrevet.

Befintliga appkontons kursåtkomst och framsteg kopplas till samma interna ID efter att Supabase har verifierat identiteten. Gamla lokala lösenord flyttas inte automatiskt till Supabase Auth. En administratör måste kopplas uttryckligen till rätt verifierade Supabase-UUID enligt auth-guiden. En vanlig nyregistrering kan inte göra sig till administratör via profiluppgifter.

## Aktivera efter verifiering

När databasinnehåll, administratörskonto och Auth-inställningar är klara:

```dotenv
SUPABASE_DATABASE_ENABLED=true
SUPABASE_AUTH_ENABLED=true
```

Starta om servern och kontrollera registrering, e-postbekräftelse, inloggning, återställning och elevens åtkomst med konton du kontrollerar. En aktiverad men felaktig Supabase-konfiguration ger ett fel; applikationen går inte tyst över till en annan databas eller inloggningsmetod.

Den gamla SQLite-filen lämnas kvar som återställningsunderlag. Efter att skarpa ändringar har gjorts i Supabase räcker det inte att växla tillbaka till en gammal SQLite-kopia: nya konton, köp och ändringar behöver då föras tillbaka genom en planerad återställning.

## Lokala tester

```powershell
node --import=tsx --test tests/postgres-database.test.ts tests/postgres-bundle-domain.test.ts tests/postgres-import.test.ts
```

Tester kör PostgreSQL-motorn lokalt med PGlite och använder isolerade data. De kontaktar inte ditt Supabase-projekt. Supabase Auth testas separat med mockade API-svar enligt auth-guiden.

Referenser: [databasanslutningar](https://supabase.com/docs/guides/database/connecting-to-postgres), [API-nycklar](https://supabase.com/docs/guides/getting-started/api-keys) och [Auth med Next.js](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs).
