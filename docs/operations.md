# Slowlax – drift och återställning

Den här guiden beskriver vad installationen behöver för beständig drift. Den innebär inte att produktionsbackup, extern e-post eller betalningar redan har anslutits eller provats.

## Konton och anslutningar

Admin och elever använder **Glömt lösenord** på inloggningssidan när Resend är konfigurerat. Återställningslänken gäller 30 minuter, används en gång och avslutar kontots tidigare sessioner. Roll, kursåtkomst och framsteg bevaras. En ny elev verifierar sin adress innan ny kurstillgång kan tilldelas.

Om e-post eller databasen är ur funktion återställs anslutningen först. `/setup` skapar bara den första administratören; den är ingen lösenordsåterställning. Förvara nycklar och miljöinställningar i en lösenordshanterare och i servermiljön.

Ny försäljning är avstängd från början. När medlemskap aktiverats följs betalningar, uppsägningar och webhookleveranser upp i Stripe och Slowlax admin. Att stänga nya köp avslutar inte ett befintligt Stripe-abonnemang. Se [medlemskap](memberships-setup.md) och [kursköp](course-purchases-setup.md).

## Säkerhetskopiering

En full backup behöver innehålla:

- Databasen med konton, artiklar, kurser, grupper, tilldelningar, framsteg, aktiviteter, svar, betalningshistorik, inställningar och filmetadata.
- Filerna från `TIBB_UPLOAD_DIR` eller den privata Blob-storen. Databasens metadata innehåller inte filinnehållet.
- Ett manifest med ursprunglig `storage_path`, storlek och kontrollsumma samt motsvarande kodversion och separat skyddad dokumentation om miljöinställningarna.

Utse en ansvarig och välj frekvens och lagringstid. Ta alltid backup före databasändringar, import och innehållsrensning. För lokal SQLite används backup API eller en konsekvent snapshot; kopiera inte bara en aktiv databasfil och ignorera WAL-filen. Exportera Turso med kontots tillgängliga backup-/exportverktyg och kontrollera att exporten kan läsas. Källprojektets databas kan innehålla historiska tabeller som fortfarande behöver ingå i en fullständig backup.

## Prova återställningen

Återställ databas och filer till en separat miljö. En ny Blob-store kan ge andra objektadresser; använd manifestet för att mappa `uploads.storage_path` och gruppfilernas sökvägar. Ändra inte produktionsmetadata under övningen.

Testkopian ska sakna skarpa Stripe- och Resend-nycklar och använda en egen `APP_URL`. Rensa sessioner och autentiseringstoken i kopian, och stoppa eventuella historiska utskicksjobb. Skydda testmiljön mot obehöriga besök och indexering.

Verifiera admininloggning, artikel, kurs, privata grupp- och kursfiler, quizhistorik, elevframsteg och rättighetskontroller. Jämför radantal och filkontrollsummor. Dokumentera vilken kodversion och backup som användes. Byt produktionsanslutning först när den separata kopian har kontrollerats.

## Övergivna uppladdningar

`scripts/uploads-cleanup.ts` har en skrivskyddad genomgång som standard. Börja med hjälptexten och granska kandidaterna:

```powershell
npx tsx scripts/uploads-cleanup.ts --help
npx tsx scripts/uploads-cleanup.ts --provider blob
```

Verktyget hanterar kursmaterial, inte en generell lagringsrensning. Gruppmaterial behöver granskas separat mot sina databasreferenser. Ta en verifierad backup innan `--apply` används. Rensning av övergivna filer är ingen automatisk policy för personuppgifternas lagringstid.

## Kompatibilitet och migrering

`TIBB_DATABASE_PATH`, `TIBB_UPLOAD_DIR` och äldre lagringsprefix behålls för kompatibilitet. Befintlig databas uppgraderas utan automatisk radering eller namnbyte av verkligt innehåll. Tibb-bokningarnas och butikens gamla tabeller kan finnas kvar även om gränssnitt och endpoints är borttagna.

Slowlax WordPress-konton och skyddade lektioner följer inte med Git-repot. En eventuell innehålls- eller användarimport är ett separat arbete med behörig export, backup och kontroll av tillgång och lösenordshantering.
