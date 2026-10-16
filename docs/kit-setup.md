# Kit för elever och Bas-medlemskap

Nyhetsbrevsanslutningen är förberedd och avstängd från början. Den blir aktiv först när servern har en Kit V4 API-nyckel och en administratör aktiverar den under `/admin/nyhetsbrev`. Integrationen fungerar med både lokal och Supabase-baserad kontohantering.

## Konfigurera

1. Skapa en **V4 API-nyckel** i Kit under Settings → Developer. En gammal ConvertKit V3-nyckel fungerar inte.
2. Lägg nyckeln i serverns miljövariabel `KIT_API_KEY`. Använd ingen `NEXT_PUBLIC_`-variabel. Nyckeln ska aldrig läggas i Git, sparas i formulär eller klistras in i administrationen. Starta om servern efter miljöändringen.
3. Öppna önskat formulär i Kit. Slå på **Send confirmation email** och stäng av **Auto-confirm new subscribers** under dess bekräftelseinställningar. Kontrollera avsändare och innehåll i bekräftelsemejlet.
4. Öppna **Nyhetsbrev** i administrationen. Ange formulär-ID. `9288768` är ett förberett värde från Slowlax publika formulär; kontrollera att formuläret finns på samma Kit-konto som din API-nyckel.
5. Ange vid behov ett tagg-ID för segmentering. Kontrollera eventuella Kit-automationer kopplade till taggen innan du använder den.
6. Markera att formulärets bekräftelseinställningar är klara och aktivera automatisk inbjudan. Spara.

Administrationen visar endast om en nyckel finns. Den provar inte nyckeln eller ändrar någon prenumerant när inställningarna sparas.

## Vad som händer när en elev registrerar sig

- En ny registrering ansluter eleven till gratis Bas-medlemskap och skapar, när Kit är aktiverat, en lokal köpost i samma databastransaktion som kontot. Gruppåtkomst väntar på e-postverifieringen. Ett fel eller avbrott hos Kit kan inte blockera kontoregistreringen, eftersom inget externt anrop görs i transaktionen.
- Innan registreringen visas information om att en separat nyhetsbrevsinbjudan skickas efter verifieringen. Ett elevkonto i sig bekräftar ingen nyhetsbrevsprenumeration.
- Ingen Kit-kontakt sker före elevkontots e-postverifiering. Efter verifiering eller återställning av kontots lösenord försöker servern behandla just den elevens köpost.
- Arbetaren slår upp adressen med `status=all`. En befintlig adress kontrolleras sedan via Kits direkta ID-uppslagning, eftersom listresultat kan släpa efter en avregistrering. En ny Kit-prenumerant skapas uttryckligen med `state=inactive`; API:ets standardvärde `active` används aldrig.
- Därefter kopplas adressen till det valda formuläret. Formulärets bekräftelseflöde i Kit avgör när den nya prenumerationen blir aktiv. En redan aktiv Kit-prenumerant behåller sin status.
- En valfri tagg läggs till efter formulärkopplingen. Befintliga offentliga nyhetsbrevsformulär på webbplatsen fungerar separat som tidigare.
- `cancelled`, `bounced` och `complained` hoppas över. Inget återaktiveringsanrop finns. Eleven får själv välja att ansluta på nytt via Kit.

Aktivering importerar inga befintliga elever. En elev som registrerades medan anslutningen var avstängd köas inte automatiskt i efterhand. När en befintlig verifierad elev uttryckligen ansluter till Bas kan en saknad inbjudan köas med den aktuella konfigurationen. Samma sak gäller en upprepad uttrycklig Bas-anslutning efter att Kit har aktiverats. Det finns högst en köpost per elevkonto: en befintlig skickad, stoppad eller misslyckad post återställs aldrig av en Bas-anslutning. Tidigare avregistreringar respekteras även vid det första försöket för ett befintligt konto.

Supabase-koppling eller inloggning för en befintlig appelev ansluter inte eleven till Bas eller köar en inbjudan. Om en ny Supabase-registrering däremot hann skapa en verifierad identitet men avbröts innan appkontot kunde sparas, skapar nästa betrodda inloggning appkontot, Bas och inbjudan tillsammans. Varje köpost sparar formulär och tagg från köningstillfället. Ändrad konfiguration påverkar kommande nya köposter.

## Automatisk retry

Lägg en separat stark slumpmässig hemlighet i serverns `CRON_SECRET` och schemalägg följande anrop varje minut i din driftmiljö:

```text
GET https://din-domän.se/api/cron/kit-newsletter
Authorization: Bearer <värdet av CRON_SECRET>
```

`POST` stöds också. Nyckeln ska vara en HTTP-header, aldrig en queryparameter. Om du använder Vercel Cron kan schemat nedan läggas till i projektets `vercel.json`; Vercel använder den konfigurerade `CRON_SECRET` som Bearer-token. Kontrollera att ditt driftabonnemang stöder önskad frekvens.

```json
{
  "crons": [
    { "path": "/api/cron/kit-newsletter", "schedule": "* * * * *" }
  ]
}
```

Inget driftsschema skapas automatiskt av integrationen. Varje anrop behandlar högst en post för att hålla sig inom serverless-körningens tidsgräns. Anropet returnerar bara räknare och konfigurationsstatus, inga elevadresser eller hemligheter.

Vid timeout, HTTP 429 eller serverfel sparas säkra felmeddelanden och nästa försök sker tidigast efter 1, 2, 4 respektive 8 minuter. Efter fem försök krävs administratörens **Försök igen**. Fel som HTTP 401/404/422 behöver åtgärdas före manuell retry. Försöksräknaren återställs när administratören startar en ny omgång för en misslyckad post. En aktiv lease hindrar parallell behandling; efter 90 sekunder kan en kraschad arbetare ersättas.

**Överlämnad till Kit** betyder att Kit accepterat formulärkopplingen och eventuell tagg. Det betyder inte att mottagaren har bekräftat, att mejlet levererats eller att adressen är en aktiv prenumerant. Kontrollera detta i Kit. Samma prenumerant, formulär och tagg kan behandlas igen efter ett oklart nätverkssvar; Kit använder befintliga kopplingar i stället för att skapa dubbletter.

Om anslutningen stängs av eller API-nyckeln tas bort pausas befintliga köposter. De kan behandlas när anslutningen aktiveras igen. Ett redan pågående nätverksanrop kan slutföras. Ändrad elevroll eller e-postadress stoppar den ursprungliga inbjudan. När elevkontot tas bort raderas dess lokala köpost; eventuell prenumeration som redan finns i Kit hanteras i Kit.

## Kontrollera utan riktiga utskick

```powershell
node --import=tsx --test tests/kit-newsletter.test.ts
```

Testet använder en separat SQLite-databas i minnet och mockar alla HTTP-anrop. Det kontrollerar nyregistrering med Bas, atomisk rollback, uttrycklig Bas-anslutning för befintliga elever, verifieringsspärr, rollkontroll, avregistrerade adresser, idempotens, leasing, retry, hemlighetsskydd och cron-autentisering. Inga riktiga API-nycklar eller prenumerationer används.

För verifiering i drift behöver du därefter själv kontrollera det valda Kit-formulärets bekräftelseflöde med en adress du kontrollerar.

## API-källor

- [Kit API authentication](https://developers.kit.com/api-reference/authentication)
- [Create a subscriber](https://developers.kit.com/api-reference/subscribers/create-a-subscriber) — `state` måste anges uttryckligen; befintliga adresser ändrar inte status via skapande-endpointen.
- [List subscribers](https://developers.kit.com/api-reference/subscribers/list-subscribers) — exakt adressuppslagning med alla statusar.
- [Eventual consistency](https://developers.kit.com/api-reference/eventual-consistency) — direkt ID-uppslagning ger aktuell status även när listresultat släpar efter.
- [Add subscriber to form](https://developers.kit.com/api-reference/forms/add-subscriber-to-form) — existerande koppling ger HTTP 200; `referrer` anger registreringssidan.
- [Tag a subscriber](https://developers.kit.com/api-reference/tags/tag-a-subscriber) — existerande taggkoppling ger HTTP 200.
- [The Confirmation Email](https://help.kit.com/en/articles/2502655-the-confirmation-email) — inställningarna för bekräftelse och automatisk aktivering.
- [Bulk add subscribers to forms](https://developers.kit.com/api-reference/forms/bulk-add-subscribers-to-forms) — Kit beskriver att redan anslutna adresser inte får samma formulärs bekräftelsemejl på nytt.
- [Vercel: Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs) — skydda schemalagda anrop med `CRON_SECRET` och Authorization-header.

Kontrollerat mot Kits officiella dokumentation 2026-10-15.
