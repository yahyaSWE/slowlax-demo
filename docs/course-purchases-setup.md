# Slowlax – kursköp och automatisk gruppåtkomst

En kurs kan säljas med engångsbetalning via Stripe och ge tillgång till en vald grupp. Försäljning börjar avstängd. Slowlax seedkurs är en offentlig presentation utan privata lektioner eller aktiverade köp. Det ärvda köpsystemet använder **SEK**, inte källsidans eventuella dollarpriser.

## Förbered i admin

1. Öppna **Admin → Kurser**. Lägg in behörigt kursinnehåll och bestäm det faktiska priset i kronor inklusive moms.
2. Förbered vid behov en grupp under **Admin → Grupper** med dess egna inlägg, bilder, PDF- och Word-filer. I kursens köpinställningar kan du välja **Grupp efter köp** och ett valfritt antal dagar.
3. Ange momssats och faktiska köp- och åtkomstvillkor. Publicera kurs och eventuell grupp när innehållet är klart. Aktivera onlineförsäljningen efter test av betalning och rättigheter.

Eleven måste vara inloggad och ha verifierat sin e-postadress. Betalningen ger åtkomst först efter att servern verifierat en signerad Stripe-händelse. Att öppna bekräftelsesidan ger inte åtkomst. Manuella tilldelningar, andra köp och grupp-/abonnemangsåtkomst hålls åtskilda.

## Anslut Stripe

| Servervariabel | Innehåll |
| --- | --- |
| `APP_URL` | Den här installationens exakta fungerande HTTPS-origin. |
| `STRIPE_SECRET_KEY` | Hemlig nyckel för rätt Stripe-konto och läge. |
| `STRIPE_WEBHOOK_SECRET` | Signeringshemligheten för `/api/kurser/webhook`. |

Kursköpens endpoint är **`https://din-fungerande-doman/api/kurser/webhook`**. Källprojektets `/api/stripe/webhook` för bokningar används inte längre. Använd samma servervariabelnamn `STRIPE_WEBHOOK_SECRET`, men hämta värdet från den nya kursendpointen. Abonnemang behåller sin separata endpoint och hemlighet.

Välj dessa Snapshot-händelser från det egna Stripe-kontot:

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

Nycklar läggs i servermiljön, aldrig i Git, adminfält eller `NEXT_PUBLIC_`-variabler. Starta om/publicera efter ändringar. Använd testnycklar och separat testdatabas först. Vid domänbyte behöver `APP_URL` och webhookadressen uppdateras.

## Åtkomst och uppföljning

Köpet ger permanent kursåtkomst och eventuell gruppåtkomst enligt villkoren som sparades när köpet startade. Separat tilldelad åtkomst och elevens framsteg bevaras när en annan åtkomstkälla upphör. Opublicerade kurser och grupper är privata.

Hantera återbetalningar och tvister i Stripe. Full återbetalning eller verifierad tvist spärrar åtkomsten från det berörda köpet; manuell tilldelning och andra köp påverkas inte. En delåterbetalning behåller köpåtkomsten. Granska en tvist innan åtkomst eventuellt tilldelas manuellt igen.

Kontrollera nytt köp, avbruten/utgången betalning, fördröjd bekräftelse, återbetalning och tvist i testmiljön. Prova rätt elev, annan elev, gruppfiler och tidigare manuell tillgång. Konfigurationsindikatorer visar att värden finns; de bekräftar inte att konto, nycklar och webhookleverans fungerar.
