# Supabase Auth för Slowlax

Implementationen är förberedd. Lokal inloggning fortsätter användas tills databasflytten är kontrollerad och båda funktionerna aktiveras uttryckligen. Att fylla i projektets offentliga URL och nyckel byter inte inloggning eller databas.

## Miljövariabler och växling

Konfigurera följande på servern utan att lägga hemligheterna i Git:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://ditt-projekt.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
DATABASE_URL=postgresql://...
APP_URL=https://din-domän.se
SUPABASE_DATABASE_ENABLED=false
SUPABASE_AUTH_ENABLED=false
SUPABASE_ADMIN_USER_ID=
```

`SUPABASE_SECRET_KEY` är en serverhemlighet och får aldrig heta något med `NEXT_PUBLIC_`. Den visas inte i gränssnittet. Auth använder den offentliga nyckeln för användarens egna anrop; den hemliga nyckeln krävs som del av den uttryckliga serverkonfigurationen och kan användas av separat betrodd administration. Lägg inte en secret key i fältet för publishable key.

Genomför PostgreSQL-migrationen och flytten av den befintliga datan enligt databasguiden före växlingen. Kontrollera att elev-ID, kursåtkomst, framsteg, grupper, medlemskap, köp och KIT-kön följt med. Sätt sedan `SUPABASE_DATABASE_ENABLED=true`. När Auth-inställningar, e-postmallar och administratörskoppling är klara kan `SUPABASE_AUTH_ENABLED=true` sättas. Starta om eller gör en ny deployment efter ändringen.

Aktiverad Auth med saknad databas, saknade nycklar eller ogiltig APP_URL ger ett konfigurationsfel. Applikationen faller inte tillbaka till lokala lösenord i det läget.

För vanliga `<projektref>.supabase.co`-adresser kontrolleras att databasens direkta värd eller poolerns användarnamn innehåller samma projektref. Det hindrar att Auth från ett projekt kopplas till elevdata i ett annat genom ett kopieringsfel.

## Supabase Dashboard

Under Authentication behöver du:

1. Aktivera Email provider och **Confirm email**. Automatisk e-postbekräftelse ska vara avstängd. Servern kontrollerar detta via Supabases `/auth/v1/settings` före autentisering och kontokoppling.
2. Sätta **Site URL** till samma betrodda adress som `APP_URL`.
3. Tillåta redirect-adresserna för `/verifiera-epost` och `/aterstall-losenord` på din domän. Lägg även till rätt lokala förhandsvisningsadress om den ska testas. Undvik generella wildcard för produktionsdomäner du inte kontrollerar.
4. Konfigurera SMTP för riktiga mottagare och kontrollera avsändardomän, leveransgränser och giltighetstid för OTP/länkar. Supabase skickar verifiering och återställning när dess Auth används; applikationens lokala Resend-flöde används då inte för dessa kontomeddelanden.
5. Uppdatera e-postmallarna nedan. Ingen automatisk dashboard-ändring görs av appen.

Servern kräver obligatorisk e-postbekräftelse även om ett användarobjekt redan säger att adressen är verifierad. Det hindrar att en driftsinställning som automatiskt bekräftar adresser används för att ta över befintlig elevdata.

## Mallar för verifiering och återställning

Appen använder serverbehandlade `token_hash`-länkar. Det gör att länken kan öppnas på en annan enhet och att ett automatiskt GET-anrop från en e-postskanner inte förbrukar länken. Eleven skickar sedan ett formulär med POST för att bekräfta eller välja lösenord.

Använd följande länk i **Confirm signup**-mallen:

```html
<a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=email">Bekräfta din e-postadress hos Slowlax</a>
```

Använd följande länk i **Reset password**-mallen:

```html
<a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=recovery">Välj ett nytt lösenord hos Slowlax</a>
```

Applikationen sätter alltid `RedirectTo` till den betrodda sidan med en `returnTo`-queryparameter, därför används `&amp;` före `token_hash`. Standardmallar som enbart använder `ConfirmationURL` och skickar sessioner i URL-fragment stöds inte av dessa serverformulär. OAuth och magic-link-inloggning ingår inte i denna lösenordsbaserade integration.

Länkarna verifieras med ett fast ändamål: `email` för verifiering och `recovery` för lösenordsåterställning. Användarens kursretur tillåts endast genom appens befintliga lokala allowlist. Begärd returadress kan aldrig byta domän.

## Befintliga konton och administratörer

Befintliga lokala scrypt-lösenord flyttas inte till Supabase. Användaren behöver ha eller skapa ett Supabase-konto med samma e-postadress och bekräfta den adressen. Därefter kan samma heltals-ID i appen kopplas till Supabases UUID. Kursdata och relationer behåller sina ursprungliga app-ID.

Ett obekräftat Supabase-konto kan aldrig ta över en befintlig app-post. Vid koppling spärras det gamla lokala lösenordet och lokala sessioner och återställningslänkar raderas. En redan kopplad Supabase-UUID får inte ersättas av en annan identitet.

En gammal administratör kopplas **inte** automatiskt genom en matchande e-postadress. Den som ansvarar för driften ska:

1. Kontrollera att rätt administratör har ett verifierat konto i rätt Supabase-projekt.
2. Hämta kontots UUID från Supabase Dashboard.
3. Ange just det UUID:t som serverns `SUPABASE_ADMIN_USER_ID` inför första inloggningen. Det måste samtidigt matcha den befintliga administratörens e-postadress.
4. Efter lyckad koppling kan engångsbindningen tas bort. Den sparade UUID-kopplingen identifierar sedan kontot.

För en helt ny installation utan administratör används `/setup` med det befintliga `SETUP_TOKEN`, minst 32 tecken. I Supabase-läge registrerar formuläret en ny provideranvändare och förbereder första administratören i appen. E-postadressen måste bekräftas före inloggning. Kommandot `npm run setup` skapar inte något separat lokalt lösenordskonto när Supabase Auth är aktiverat.

Appens databasroll används alltid för behörighet. Varken Supabases vanliga JWT-roll `authenticated` eller redigerbar `user_metadata.role` ger administratörsbehörighet. Visningsnamn får hämtas från metadata vid nytt konto; behörigheter får det inte.

## Sessioner, profil och nyhetsbrev

- Varje request får en egen SSR-klient. Proxy uppdaterar token med `getClaims` och skickar förnyade cookies till både serverrenderingen och webbläsaren. Cookies är HttpOnly, SameSite=Lax och Secure i produktion.
- Serveråtkomst kräver verifierade claims och en aktuell användare från `getUser`. `getSession` används inte som behörighetskontroll. Auth-svar som kan innehålla sessionscookies cachas inte.
- Namn och lösenord kan ändras under Mitt konto. Lösenordsbyte kräver aktuellt lösenord; återställning kräver en giltig recovery-token. Efter lösenordsändring återkallas Supabases refresh-sessioner globalt och användaren loggar in igen. Redan utfärdade access-token kan vara giltiga tills deras korta livslängd löper ut enligt Supabases sessionsmodell.
- Varje nytt elevkonto som skapas i appens databas skapar en KIT-intention om KIT är aktiverat vid det tillfället. Detta gäller även om ett tidigare Supabase-svar avbröts eller en verifierad provideranvändare kommer till appen för första gången. Intentionen väntar vid behov på serververifierad e-post. KIT kan sedan försöka efter verifiering eller inloggning, och cron-arbetaren hanterar omförsök. Länkning av importerade och tidigare appelever köar inte någon ny inbjudan.
- Om Supabase-användaren skapades men appens skrivning avbröts kan användaren försöka registrering/verifiering igen. De två leverantörerna delar ingen databastransaktion. Ingen extern radering görs automatiskt som kompensation.

## Lokala tester och återstående kontroll

```powershell
node --import=tsx --test tests/supabase-auth-domain.test.ts tests/supabase-auth-provider.test.ts
```

Domäntester använder isolerad SQLite i minnet. Providertester mockar claims, aktuell användare och inställningsanrop. De kontrollerar bland annat verifieringsspärr, felaktig identitet, avstängd e-postbekräftelse, explicit adminbindning, gamla lokala sessioner, returadresser och KIT-kön. Inga riktiga konton, meddelanden eller externa mutationer skapas i testerna.

Slutlig kontroll mot ditt projekt kräver den verkliga databasanslutningen, genomförd datamigration och e-postmallarna ovan. Kontrollera sedan själv registrering, bekräftelse, återställning, utloggning och administratörsinloggning med konton du kontrollerar. En godkänd lokal typkontroll eller mockad testkörning bekräftar inte SMTP eller sessionsförnyelse i den publicerade miljön.

## Officiella referenser

- [Supabase SSR och Next.js](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs)
- [Supabase e-postmallar](https://supabase.com/docs/guides/auth/auth-email-templates)
- [verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp)
- [updateUser](https://supabase.com/docs/reference/javascript/auth-updateuser)
- [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Supabase Auth settings-källkod](https://github.com/supabase/auth/blob/master/internal/api/settings.go)

Kontrollerat mot officiell dokumentation 2026-10-15.
