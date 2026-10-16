# Rening – krediter och ärenden

Rening hanteras i elevportalen på `/elevportal/rening` och i administrationen under **Rening**. Tjänsten är en manuell granskning: eleven lämnar sitt innehav, en administratör handlägger ärendet och publicerar svaret i elevportalen.

## Vad en rening innebär

En rening gäller ett bolag. Antalet aktier eleven äger är separat underlag för granskningen. Ett ärende med tre olika innehav behöver därför tre reningar, även om eleven äger hundra aktier i varje bolag.

Eleven anger bolag, antal ägda aktier och vid behov ticker/ISIN, börs och aktieslag. Antal kan anges med decimaler. Inskickade uppgifter sparas som en historisk kopia. Administratörens interna anteckningar visas aldrig för eleven.

## Reningar som ingår

Kvoten förbereds separat på erbjudandet i admin:

- **Betalt medlemskap:** antal reningar per verifierad, betald medlemsperiod. Kvoten gäller den period som betalningen avser. Oanvända reningar förs inte över till nästa period.
- **Bas medlemskap:** en engångskvot under det kostnadsfria medlemskapet. Grundinställningen är noll. Första utnyttjandet låser den tilldelade kvoten för eleven; senare ändringar fyller inte automatiskt på en redan tilldelad kvot.
- **Kurspaket:** ett antal engångsreningar efter ett verifierat paketköp.
- **Separat köp:** ett antal engångsreningar enligt det köpta erbjudandet.

Kvoter i betalda erbjudanden sparas tillsammans med det påbörjade köpet. Ändringar gäller nya köp och skriver inte om redan godkända köpvillkor. Äldre köp som saknar en sparad reningskvot ger inga reningar automatiskt.

## Från inskickat innehav till svar

Eleven behöver ett verifierat elevkonto och tillräckligt saldo för att skicka ett ärende. Reningarna reserveras i samma databastransaktion som ärendet skapas. Upprepade anrop för samma inskick skapar inte dubbla ärenden eller dubbla reservationer.

Administratören öppnar ärendet, handlägger det och publicerar ett elevsynligt svar när granskningen är klar. Eleven ser status, inskickade uppgifter och det publicerade svaret på sin egen sida. Ärendet och svaret finns kvar även om medlemsperioden senare tar slut.

Ett avbrutet eller avvisat ärende återlämnar sin reservation en gång. Återlämnade reningar kan bara användas igen om den ursprungliga tilldelningen fortfarande gäller. En återbetalning eller tvist om ett köp spärrar fortsatt användning av reningar från just den betalningen. Andra köp och medlemskap har egna tilldelningar.

## Separata köp

Tre erbjudanden är förberedda utifrån [Slowlax reningstjänst](https://slowlax.se/rening/): 4 bolag för 199 kr, 9 för 299 kr och 14 för 399 kr. De börjar som utkast med försäljningen avstängd. Kontrollera pris, antal, momssats och villkor i administrationen och publicera de erbjudanden du vill använda.

Serverns miljö behöver:

```dotenv
APP_URL=https://din-webbplats.example
STRIPE_SECRET_KEY=...
RENING_STRIPE_WEBHOOK_SECRET=...
```

Anslut webhooken `/api/rening/webhook` i Stripe. Använd separata testnycklar och en separat testdatabas när du kontrollerar nya köp, osäker betalningsstatus, återbetalningar och tvister. En återkomst från Checkout ger inte i sig några reningar; servern måste först verifiera betalningen.

Webhooken behöver händelserna `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated` och `charge.dispute.closed`.

Medlemskap använder sin befintliga webhook `/api/medlemskap/webhook`. Kurspaket använder kursköpens befintliga webhook `/api/kurser/webhook`. De separata tilldelningarna kopplas till respektive verifierade betalning.

## Installation och åtkomst

SQLite uppgraderas med webbplatsens vanliga databasinitiering. En befintlig PostgreSQL-installation behöver den nya versionsstyrda migreringen före kodens aktivering. Följ [Supabase-guiden](supabase-setup.md) för kontroll, backup och explicit uppgradering.

Innehav och ärendesvar är privata. Elevens identitet hämtas från inloggningen och administratörsbehörighet kontrolleras vid varje läsning och ändring. Ärendesidorna ingår inte i den publika innehållskartan. Hemliga Stripe-nycklar och databasuppgifter ska bara finnas i serverns miljövariabler.
