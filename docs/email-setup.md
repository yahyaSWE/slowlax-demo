# E-post för Slowlax

Kontoverifiering och lösenordsåterställning använder Resends HTTPS-API. Ingen anslutning eller verklig leverans följer automatiskt med källkoden.

## Konfiguration

Verifiera en domän som verksamheten kontrollerar i Resend. Använd de DNS-poster tjänsten visar för den faktiska domänen. Kontrollera separat att kontaktadressen tar emot mejl; avsändarverifiering skapar inte en inkorg.

| Servervariabel | Innehåll |
| --- | --- |
| `RESEND_API_KEY` | Verksamhetens hemliga nyckel för utskick. |
| `EMAIL_FROM` | Verifierad avsändare, exempelvis `Slowlax <avsandare@din-verifierade-doman>`. |
| `APP_URL` | Den här installationens exakta HTTPS-origin, utan sökväg, query eller fragment. Lokal utveckling tillåter localhost/127.0.0.1 med HTTP. |

Variablerna får inte ha `NEXT_PUBLIC_`-prefix. Lägg dem i `.env.local` eller driftmiljön och starta om/publicera efter ändringar. Preview ska använda egna testnycklar och kontrollerade mottagare eller sakna utskickskonfiguration.

## Verifiering och återställning

Registrering skapar ett overifierat elevkonto. Eleven kan begära verifieringslänk från `/verifiera-epost`. Länken gäller 24 timmar och används tillsammans med det registrerade lösenordet. Den som inte skapade kontot använder **Glömt lösenord** för att återta ägarskapet till sin adress.

Lösenordsåterställningslänkar gäller 30 minuter och används en gång. Ett nytt lösenord bekräftar adressägarskap och avslutar gamla sessioner. Bara tokenhashar sparas i databasen. En vanlig sidvisning förbrukar inte länken.

Saknad serverkonfiguration visar ett tydligt fel och verifierar inga konton. Befintlig admininloggning och tidigare tilldelad kursåtkomst bevaras. API-acceptans betyder att Resend tagit emot ett anrop; kontrollera faktisk leverans, studs och skräppost hos tjänsten och en kontrollerad mottagare.

## Kontrollera före öppning

Prova registrering, verifieringslänk och lösenord, en använd/utgången länk och återställning av lösenord. Kontrollera att återställning avslutar en gammal session och bevarar konto och kurstillgång. Använd separata testkonton och håll privata länkar utanför supportloggar och Git.

Boknings- och butikens utskicksflöden används inte i Slowlax-versionen. Historiska outbox-tabeller lämnas kvar vid databasuppgradering; de är inte en anledning att ansluta gamla schemalagda utskicksjobb till en ny Slowlax-installation.
