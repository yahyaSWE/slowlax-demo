# Slowlax – medlemskap, grupper och abonnemang

Medlemskapssidan visar alltid **Bas medlemskap – Gratis** och alla publicerade betalmedlemskap med publicerat innehåll. Utkast visas bara i admin. Katalogen fungerar även när ny abonnemangsförsäljning är **avstängd**. Källsidans dollarpriser är inte verifierade som aktuella och har inte omvandlats: betalningsmotorn använder SEK. Ange verkliga priser och villkor i admin innan ett erbjudande publiceras.

## Bas – gratis medlemskap

Öppna **Admin → Medlemskap → Bas medlemskap**. Ändra beskrivningen och välj noll, en eller flera grupper. Bas är alltid gratis och synligt på `/medlemskap/bas`; det behöver ingen Stripe-anslutning. Namnet och adressen är reserverade för gratiserbjudandet. Du kan skapa gruppen senare och därefter koppla den här. Publicera gruppen och dess kurser innan den väljs.

Nya elevkonton ansluts automatiskt till Bas. Konto, Bas-medlemskap och eventuell KIT-inbjudan sparas tillsammans. Gruppinnehåll och kurser öppnas först när elevens e-postadress är verifierad. En befintlig elev kan välja **Bli medlem gratis** med sitt verifierade konto. Befintliga elever läggs inte till genom en vanlig inloggning.

Gruppvalen gäller alla Bas-medlemmar, även de som anslöt sig tidigare. En senare tillagd grupp blir därför tillgänglig direkt för verifierade Bas-medlemmar. Om en grupp tas bort försvinner just Bas-åtkomsten; manuella tilldelningar, kursköp och betalda abonnemang fortsätter ge sin egen åtkomst. Att avpublicera en grupp döljer dess innehåll tills den publiceras igen.

När **Admin → Nyhetsbrev** är korrekt konfigurerat köas en automatisk KIT-inbjudan vid anslutningen. Den skickas efter verifierat konto. Eleven bekräftar nyhetsbrevet i KIT:s mejl. Tidigare avregistrerade prenumeranter återaktiveras inte. Upprepade anslutningar skapar inga extra inbjudningar. Medlemskapet fungerar även om KIT är avstängt eller tillfälligt inte svarar. Se [KIT-guiden](kit-setup.md).

## Förbered innehållet i admin

1. Gå till **Admin → Grupper → Skapa grupp**. Skriv namn och beskrivning och välj kurserna som ska ingå. En grupp kan också innehålla enbart gruppmaterial. Spara som utkast tills du är klar.
2. Öppna gruppen och välj **Nytt inlägg**. Skriv exempelvis ”Månadsuppdatering för oktober”, välj en valfri månad och lägg till formaterad text, bilder och dokument. Den visuella editorn kan infoga bilder mellan textstycken. Bildbeskrivningen hjälper elever som använder skärmläsare; bildtexten är valfri.
3. Spara och **Förhandsgranska inlägg** eller **Förhandsgranska grupp**. Admin kan granska utkast. Publicera sedan kurserna, gruppen och de inlägg som ska visas.
4. Under **Tilldela en elev → Välj elev** öppnar du listan över registrerade elever. Sök på namn eller e-postadress och välj eleven. Elever som inte har verifierat sin e-postadress visas men kan inte väljas ännu. Ett slutdatum är valfritt och gäller till slutet av dagen i svensk tid. Tomt slutdatum ger obegränsad manuell gruppåtkomst. En elev kan tillhöra flera grupper.
5. Under **Admin → Medlemskap → Skapa medlemskap** kopplar du ett månads- eller årspris till gruppen. Momssatsen ska motsvara den tjänst du säljer. Du kan skapa flera erbjudanden för samma grupp, exempelvis månads- och årsbetalning. Erbjudanden kan förberedas som utkast.

Eleven hittar innehållet under **Mina grupper** och betalningarna under **Mina abonnemang**. Gruppens publicerade kurser syns också under **Mina kurser**. Månadsväljaren hjälper eleven att hitta tidigare publicerat material. Alla aktiva medlemmar ser gruppens publicerade historik.

## Åtkomst och dokument

En elev har kursåtkomst genom en separat permanent kurstilldelning, en giltig manuell grupptilldelning eller ett betalt abonnemang. När en källa avslutas kan en annan fortfarande ge åtkomst. Att avsluta ett abonnemang tar aldrig bort en separat permanent kurstillgång eller elevens framsteg.

Gruppmaterial är separat från kursmaterial. En elev med enbart tillgång till den kopplade kursen får inte automatiskt läsa gruppens inlägg eller dokument. Grupp, inlägg, bildreferens och aktuell medlemsåtkomst kontrolleras på servern. Utkast är tillgängliga för admin. Opublicering av gruppen döljer även dess inlägg och gruppbaserade kursåtkomst; separat permanent kursåtkomst finns kvar.

Bilder: JPG, PNG eller WebP, högst 2 MB och 20 olika bilder per inlägg. Servern kontrollerar bildinnehållet, normaliserar till WebP och tar bort källans metadata. Dokument: PDF, DOC eller DOCX, högst 20 MB per fil och 20 bilagor per inlägg.

På Vercel används samma **privata Vercel Blob-lagring** som för kursmaterial: `BLOB_STORE_ID`, `BLOB_WEBHOOK_PUBLIC_KEY` och Vercels OIDC, alternativt en serverhemlig `BLOB_READ_WRITE_TOKEN`. Gruppfiler har en egen uppladdnings- och läsrutt, `/api/gruppfiler`, och ägs av den grupp där de laddades upp. De kan inte kopplas till en annan grupp. Lokalt används `TIBB_UPLOAD_DIR` på beständig disk.

Uppladdningsmetadata och bilagereferenser ingår i databasen; själva privata Blob-filerna behöver också ingå i din backup-/återställningsplan. Filer som har laddats upp men inte längre används kan ligga kvar i lagringen. Den befintliga kursmaterialrensningen rör inte prefixet `tibb/group-material`. Planera separat granskning och rensning av övergivna gruppfiler och utgångna förberedda uppladdningar. Ta aldrig bort en fil som fortfarande är kopplad till ett inlägg.

## Anslut Stripe för återkommande betalning

Manuell gruppåtkomst kräver ingen betalningsanslutning. Automatisk försäljning behöver följande servervariabler i Vercel Production:

| Variabel | Användning |
| --- | --- |
| `APP_URL` | Exakt betrodd HTTPS-origin, exempelvis `https://din-fungerande-doman` tills den egna domänen fungerar. |
| `STRIPE_SECRET_KEY` | Verksamhetens hemliga Stripe-nyckel. Samma konto kan användas för kursköp och medlemskap. |
| `MEMBERSHIP_STRIPE_WEBHOOK_SECRET` | Hemligheten för den separata endpointen `/api/medlemskap/webhook`. |
| `MEMBERSHIP_STRIPE_PORTAL_CONFIGURATION_ID` | ID för en begränsad Stripe Billing-kundportalkonfiguration enligt nedan. |

Använd en separat Stripe-testmiljö och separat previewdatabas först. Lägg aldrig nycklar i Git, adminfält, chatten eller `NEXT_PUBLIC_`-variabler. Publicera på nytt efter ändrade servervariabler.

Checkout skapar återkommande SEK-priser från det pris och intervall som är sparat i admin. Du behöver inte kopiera ett Stripe Price-ID till varje medlemskap. En elev måste vara inloggad och ha verifierat sin e-postadress. Eleven ser pris, intervall och villkor och godkänner den återkommande betalningen innan Checkout öppnas. Åtkomst ges först efter verifierad betalning, inte av att öppna bekräftelsesidan.

Stripe-fakturan använder en fast svensk momssats som du väljer i admin, med moms inkluderad i det visade totalpriset. Checkout samlar in faktureringsadress. Kopplingen bestämmer inte vilken momsregel som gäller för en viss kund eller tjänst och innehåller ingen automatisk internationell skatteberäkning. Kontrollera momssats och försäljningsområde för din verksamhet innan försäljning öppnas.

Skapa en separat webhook för `https://din-fungerande-doman/api/medlemskap/webhook`. Aktivera:

- `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`
- `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, `invoice.marked_uncollectible`, `invoice.voided`, `invoice.finalization_failed`
- `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`
- `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`

Kursköp har en separat webhook på `/api/kurser/webhook`. Följ [Stripes guide för abonnemangshändelser](https://docs.stripe.com/billing/subscriptions/webhooks).

## Kundportal och uppsägning

Skapa en aktiv Stripe Billing-portalkonfiguration för medlemskap. Aktivera **uppdatering av betalningsmetod** och **uppsägning vid periodens slut**. Inaktivera **ändring av abonnemang/produkter**, **ändring av kunduppgifter** och **inloggning via publik portallänk**. Webbplatsen kontrollerar konfigurationen när den öppnar en personlig portal åt den inloggade eleven. Den generella publicerade portalens e-postinloggning används inte för att identifiera eleven.

Eleven kan öppna portalen från **Mina abonnemang** och hantera sitt betalkort eller säga upp ett abonnemang. Vid uppsägning till periodens slut behålls den redan betalda åtkomsten. Betalningsfel förlänger inte åtkomsten automatiskt. Återbetalningar och tvister kan spärra den betalda åtkomsten; manuella grupptilldelningar och separata kursgrants bevaras.

**En åtkomstspärr efter återbetalning eller tvist stoppar inte Stripes återkommande debitering.** Admin visar både betalningsstatus och spärren, med länken **Granska i Stripe**. Granska rätt abonnemang och avsluta fortsatt debitering i Stripe om medlemskapet ska avslutas. Kontrollera att uppsägningshändelsen har nått hemsidan. Ett spärrat historiskt abonnemang ligger kvar för uppföljning. Om åtkomst ska återställas efter manuell granskning kan du ge en separat manuell grupptilldelning med ett tydligt slutdatum. Spärrade abonnemang öppnas inte automatiskt av en senare betalningshändelse.

Under **Mina abonnemang → Påbörjade betalningar** kan eleven välja **Avbryt påbörjad betalning** innan ett annat erbjudande eller betalningsintervall väljs. Checkout leder också tillbaka hit när eleven avbryter. Kontrollen finns kvar även när erbjudandet är opublicerat eller ny försäljning har stängts. Det avslutar endast elevens väntande betalningsförsök; ett redan tecknat abonnemang avslutas via kundportalen. En slutförd betalning som väntar på bekräftelse visas som under behandling och kan inte avbrytas här.

Se [Stripes kundportalguide](https://docs.stripe.com/customer-management/integrate-customer-portal). Ändrade priser och intervall i Slowlax admin gäller **nya** abonnemang; befintliga abonnemang behåller sina avtalade uppgifter. Efter att en betalning har påbörjats kan erbjudandets grupp inte bytas. Skapa ett nytt erbjudande om en annan grupp ska ingå.

## Öppna och kontrollera försäljningen

Fyll i verksamhetens kontaktadress, abonnemangsvillkor, publicerad grupp och publicerat erbjudande. Under **Admin → Medlemskap** aktiverar du **Öppna för nya abonnemang på hemsidan**. Admin kontrollerar konfigurationsvärden; det bevisar inte att nycklar, portalinställningar och webhooks fungerar.

Testa i Stripe-testmiljön: ett nytt köp, förnyelse, betalningsfel, uppsägning, betald period som löper ut och en återbetalning. Kontrollera att rätt elev får rätt grupp, kurs, quiz och dokument; att en annan elev saknar åtkomst; att utkast är privata; och att en permanent kurstilldelning finns kvar efter avslutat abonnemang.

Avstängd försäljning stoppar nya köp; de publicerade erbjudandena fortsätter visas. Bas fungerar som vanligt. Växlingen **stoppar inte befintliga återkommande betalningar** och tar inte bort giltig medlemsåtkomst. Hantera redan tecknade abonnemang via Stripe även när nya köp är avstängda.

Implementeringen har verifierats med isolerade lokala databaser och simulerade Stripe/Blob-svar. Skarpa anslutningar behöver konfigureras och leveranstestas på verksamhetens konton innan lansering.
