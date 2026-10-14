# Kursköp och automatisk grupp efter köp

En kurs kan säljas med en **engångsbetalning via Stripe** och ge automatisk tillgång till en vald grupp. Försäljning börjar avstängd för varje kurs. Uppgraderingen öppnar inga köp, publicerar inget innehåll och ändrar inte befintliga manuella kurstilldelningar.

## Förbered kursen och gruppen

1. Skapa eller öppna kursen under **Admin → Kurser**. Ange det pris i svenska kronor som ska tas betalt, inklusive moms. För Hijama-kursen kan du exempelvis använda 4 990 kr. Kursens namn och pris hämtas från Tibb-admin; produkten som du redan skapat i Stripe behöver inte kopplas manuellt.
2. Skapa en grupp under **Admin → Grupper** och förbered gruppens inlägg, bilder, PDF- och Word-filer. Publicera bara det material som eleverna ska kunna läsa. Gruppen kan innehålla extra material utan att själva kursen ingår bland gruppens kurser.
3. I kursbyggarens köpinställningar väljer du **Grupp efter köp**. Ingen grupp innebär att enbart kursåtkomst ingår. Lämna gruppens antal dagar tomt för obegränsad gruppåtkomst, eller ange 1–3 650 dagar. Tiden räknas från köpets bekräftade betalningstid.
4. Välj momssats och fyll i kursens faktiska köp- och åtkomstvillkor. Ange vad som ingår, hur eleven kontaktar verksamheten och vilka ånger-/avbokningsvillkor som gäller för erbjudandet. Priset är ett totalpris med moms inkluderad. Ändringar gäller nya betalningsförsök; ett påbörjat köp behåller sina sparade avtalsuppgifter.
5. Publicera kursen och den valda gruppen när innehållet är klart. Aktivera kursens onlineförsäljning först när betalningen har kontrollerats i testmiljön.

En elev måste vara inloggad och ha verifierat sin e-postadress innan betalningen kan påbörjas. Eleven ser pris, köpvillkor och vilken eventuell gruppåtkomst som ingår och godkänner villkoren innan Stripe öppnas. Begäran om omedelbar kursåtkomst används inte som ett automatiskt avstående från ångerrätt. Operatören behöver ange erbjudandets faktiska villkor; funktionen avgör inte vilka rättsliga regler som gäller för en viss kurs.

## Åtkomst efter betalning

Betalningen kopplas till det inloggade elevkontot. Först när servern har verifierat betalningen får eleven permanent åtkomst till den köpta kursen och eventuell gruppåtkomst enligt uppgifterna som sparades när köpet påbörjades. Att öppna bekräftelsesidan ger aldrig åtkomst på egen hand.

Den köpta kursen finns under **Mina kurser**, gruppmaterial under **Mina grupper** och köpets betalningsstatus under **Mina köp**. Gruppens antal dagar räknas som hela dygn från betalningstidpunkten hos Stripe. Sena eller upprepade betalningshändelser startar inte om tidsgränsen. Om gruppåtkomsten löper ut behålls den köpta kursåtkomsten. En elev som bara tilldelas kursen manuellt läggs inte automatiskt i en grupp; använd gruppens elevväljare när du vill ge separat manuell gruppåtkomst.

Elevportalens huvudmeny samlar **Mina kurser**, **Grupper & material** och **Mitt konto**. Köphistorik och abonnemang finns under Mitt konto. Startsidan ger en direktväg till nästa omarkerade lektion och senaste publicerade gruppmaterialet. Lektionsmarkeringar och quiz-/uppgiftsresultat visas separat. Den valda kursen följer med genom registrering och e-postverifiering, även när verifieringslänken öppnas i en annan webbläsare.

Köpets kurs- och gruppåtkomst har en egen källa. Manuella kurs- och grupptilldelningar, andra kursköp och betalda abonnemang bevaras när en annan åtkomstkälla upphör. Historik och kursframsteg tas inte bort när åtkomsten stoppas. Opublicerat kurs- eller gruppinnehåll visas inte för elever.

Under **Mina köp** kan eleven se en påbörjad betalning och avbryta den om den fortfarande är obetald. En betalning som väntar på bekräftelse kan inte behandlas som ett avbrutet köp. Bekräftelsesidan och köphistoriken är privata och kräver rätt elevkonto.

## Stripe: samma anslutning som behandlingsbokningarna

Kursköpen använder den befintliga bokningsanslutningen. Ingen ny hemlig miljövariabel, produktkoppling eller abonnemangsportal behövs.

| Variabel | Användning |
| --- | --- |
| `APP_URL` | Exakt offentlig HTTPS-origin, exempelvis `https://tibbnu.vercel.app` tills den egna domänen fungerar. |
| `STRIPE_SECRET_KEY` | Hemlig Stripe-nyckel för samma konto och läge som webhooken. |
| `STRIPE_WEBHOOK_SECRET` | Signeringshemligheten för den befintliga endpointen `/api/stripe/webhook`. |

Hemligheter anges endast i Vercels servermiljö eller en lokal miljöfil, aldrig i Git, chatten, adminfält eller `NEXT_PUBLIC_`-variabler. Kör en ny publicering efter ändrade miljövariabler. Behandlingsbokningar, kursköp, butik och abonnemang kan använda samma Stripe-konto, men butikens och abonnemangens egna webhook-endpoints behålls.

Öppna den befintliga Stripe-webhooken för `https://din-fungerande-doman/api/stripe/webhook` och kontrollera att den tar emot **Snapshot**-händelser från **Your account** och att följande händelser är valda. Se [Stripes webhookguide](https://docs.stripe.com/webhooks).

```text
checkout.session.completed
checkout.session.expired
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
charge.refunded
charge.dispute.created
charge.dispute.updated
charge.dispute.closed
```

De fem första händelserna används redan för bokningar. Lägg till de tre tvist-händelserna på samma endpoint; ersätt inte bokningarnas befintliga händelser. Behåll den befintliga `STRIPE_WEBHOOK_SECRET` så länge endpointens signeringshemlighet är oförändrad. Vid domänbyte uppdaterar du både `APP_URL` och endpointens adress. Kontrollera leveransen i Stripe efter ändringen.

Checkout använder en fast momssats som du väljer i Tibb-admin, med moms inkluderad i det visade totalpriset. Faktureringsadress samlas in hos Stripe. Funktionen väljer inte momsregel efter kundens land och innehåller ingen automatisk internationell skatteberäkning. Kontrollera vald momssats och försäljningsområde för verksamheten före försäljning.

## Återbetalning och uppföljning

Hantera återbetalningar och tvister i Stripe. Köpstatus och åtkomst uppdateras genom verifierade händelser. En delåterbetalning behåller köpets åtkomst. En full återbetalning eller en verifierad tvist spärrar åtkomsten från det berörda köpet; separat manuell tilldelning och abonnemang påverkas inte. Tvistspärren återställs inte automatiskt när tvisten stängs, även om verksamheten vinner den. Granska rätt betalning innan du ger en eventuell ny manuell tilldelning.

Bekräftade köp visas i kursbyggaren under **Kursköp**. I gruppens adminvy visas de under **Gruppåtkomst från kursköp**, med elev, avtalad tidsgräns och betalningsspärrar. Köpt åtkomst hålls separat från tabellen med manuella tilldelningar.

Avstängd kursförsäljning stoppar nya köp och döljer köpknappen. Den tar inte bort tidigare betald åtkomst. Redan påbörjade betalningar kan fortfarande slutföras och behandlas utifrån de uppgifter som sparades när köpet startade. Gruppens innehåll kan därefter ändras i admin utan att gruppen i ett redan sparat köp byts ut.

## Kontrollera innan försäljning öppnas

Använd en separat Stripe-testmiljö, databas och Vercel Preview först. Kontrollera ett nytt köp, avbruten och utgången betalning, fördröjd betalningsbekräftelse, en full återbetalning och en tvist. Kontrollera även att:

- rätt elev får rätt kurs och grupp och kan läsa gruppens bilder och dokument;
- en annan elev saknar åtkomst och utkast förblir privata;
- permanent kursåtkomst finns kvar när köpets tidsbegränsade gruppåtkomst löper ut;
- en separat manuell kurstilldelning finns kvar efter återbetalning;
- behandlingsbokningarnas betalningar fortfarande fungerar via den delade webhooken;
- verksamhetens kontaktuppgifter och de villkor eleven accepterar är korrekta.

Konfigurationsindikatorer i admin visar om servervärden finns, inte att nyckeln eller webhookleveransen fungerar. Lokala automatiserade tester använder separata databaser och simulerade Stripe-svar. Skarpa betalningar behöver verifieras på verksamhetens Stripe-konto före försäljning. För gruppinnehåll och privat fillagring, se [medlemskapsguiden](memberships-setup.md); för backup och återställning, se [driftguiden](operations.md).
