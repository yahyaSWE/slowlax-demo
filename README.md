# Slowlax – visningsversion

Frontend för presentation av Slowlax för ledningen. Versionen visar startsida, kurser, kurspaket, medlemskap, rening, artiklar, filosofi och kontakt med statiskt offentligt innehåll och tydligt märkta exempelpriser.

## Ingen databas eller inloggning

Inga miljövariabler eller hemliga nycklar behövs. Inloggning, registrering, elevportal, admin, köp, reningsärenden och nyhetsbrevsanmälan är avstängda. API-anrop och alla skrivande HTTP-metoder blockeras; databasåtkomst spärras även om någon fyller i integrationsnycklar.

Den fullständiga webbplatsen finns i [slowlax-it/slowlax-web](https://github.com/slowlax-it/slowlax-web). Endast detta demo-repo har presentationsanpassningarna. För inte över demoändringarna till den ordinarie webbplatsen.

## Kör lokalt

Node.js 24 och npm behövs.

```powershell
npm ci
npm run dev
```

## Kontroll och bygg

```powershell
npm test
npm run typecheck
npm run build
```

Deploya på Vercel med Next.js och standardkommandot npm run build. Ingen Supabase-, Turso-, Stripe- eller KIT-konfiguration behövs. Demot är markerat noindex och använder inte riktiga elevkonton, innehav eller köphistorik.

Offentliga texter och bilder utgår från [slowlax.se](https://slowlax.se). Ursprunglig applikationsgrund: [yahyaSWE/tibb.nu](https://github.com/yahyaSWE/tibb.nu).
