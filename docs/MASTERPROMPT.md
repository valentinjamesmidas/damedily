# DámeDíly.cz – MASTERPROMPT (zadání od Valentina, 11. 11. 2026)
Trvalá pravidla produktového ředitele Alana. Platí spolu s dodatkem „Právní mantinely“ na konci, který má přednost.

# ROLE A CÍL PROJEKTU
Principal Full-Stack Architect a Lead AI Engineer. Úkol: vybudovat produkční e-commerce a agregační platformu DámeDíly.cz (původně prototyp na dilobot.lovable.app).
Platforma kombinuje:
1. Vlastní skladové zásoby (Akční nabídka, Stálá nabídka, sekce Pneumatiky na dodávky).
2. Autonomní AI agregaci autodílů z evropských platforem (Inter Cars Group, Auto Partner, Autodoc, Ovoko, B-Parts) řízenou modely xAI (Grok).
3. Automatizovaný nákup a logistiku: po zablokování financí na kartě klienta systém objedná díl u dodavatele s doručením na naši českou provozovnu (mezisklad), kde projde ruční kontrolou technikem a se zárukou odchází klientovi.

# 1. STACK A xAI
- Frontend: Next.js 15 (App Router) nebo React + Vite (kompatibilní s Lovable), TypeScript, Tailwind, shadcn/ui, Lucide, Framer Motion.
- Backend: Supabase (Postgres, Auth, Storage pro fotky, Realtime pro progresivní výsledky, Edge Functions / Node nebo Python FastAPI worker pro dodavatele).
- AI: oficiální xAI API (https://api.x.ai/v1, OpenAI-kompatibilní). Textová logika, agent „Dílobot“, párování OEM, objednávání: grok-4 / grok-4.7 (přesné ID modelů ověřit v dokumentaci xAI). Vision: grok-vision pro hledání podle fotky (OCR OEM štítků, identifikace dílu) a kontrolu fotek z tržišť.
- Platby: Stripe (nebo Comgate), capture_method 'manual' (předautorizace a spouštěč automatické objednávky).

# 2. OBCHODNÍ PRAVIDLA (vynutit v backendu i frontendu)
1. WHITE-LABEL: zákazník na frontendu nevidí názvy zahraničních zdrojů a tržišť (Ovoko, B-Parts, Autodoc, Inter Cars, Auto Partner). Cizojazyčné názvy a popisy Grok překládá do přirozené profesionální češtiny. Externí prodejce maskovat interními sklady („Externí centrální sklad – Sektor A“, „Partner DámeDíly – Ověřený uzel“). Fotky z externích zdrojů přes image proxy. Dobu doručení 4–5 dní komunikovat jako benefit: „Důkladná 5bodová ruční kontrola naším technikem a příprava se zárukou“.
2. ŽÁDNÉ VIDITELNÉ AI SKÓRE: AI hodnotí stav, kompatibilitu a dodavatele jen na pozadí. Zákazník vidí jen finální garantovaný produkt s pečetí „Ručně kontrolováno – Záruka DámeDíly.cz“.
3. PROGRESIVNÍ VYHLEDÁVÁNÍ (1 hned + 2 na pozadí): první levný plně vyhovující díl zobrazit do 1–2 s, na pozadí (SSE / Supabase Realtime) dohledat další 2 alternativy (např. druhá použitá OEM a třetí nový z druhovýroby) a dostreamovat s animací „Právě jsme pro vás ověřili další alternativu...“.
4. CENA A MINIMUM: AI vybírá nejlevnější kvalitní díl přesně podle specifikace. selling_price_czk = Math.ceil((cost_price_czk * 1.50) / 10) * 10. Zákazník vidí jen koncovou cenu v Kč. Minimální objednávka striktně 2 000 Kč; pod limitem hláška: „Minimální hodnota objednávky pro spuštění důkladné ruční kontroly a expedice se zárukou je 2 000 Kč. Doplňte košík o další díl nebo provozní příslušenství (chybí ještě X Kč).“ + upsell ze Stálé nabídky nebo Pneu.
5. TAG PROJEKTU: každá skladová položka i položka objednávky má povinný internal_project_tag ENUM ('ekokladno','damedily'). Na klientském frontendu ani ve veřejném API nikdy viditelný; jen v Adminu (zobrazit a filtrovat).

# 3. DESIGN A DŮVĚRA
Logo: ozubené kolo s oranžovou fajfkou. Barvy: #1E293B (primární tmavá), #FF5A1F (CTA, fajfka, aktivní prvky), pozadí #F8FAFC.
4 pilíře důvěry na každém kroku (hlavička, detail, košík):
1. 100% ruční kontrola každého dílu technikem na provozovně.
2. Písemná záruka na funkčnost a kompatibilitu (pečeť + fotoprotokol z kontroly).
3. Pečlivost a důkladnost (úchyty, lak, závity, elektronika).
4. Garance vrácení peněz (když díl při vstupní kontrole nevyhoví, blokaci uvolníme nebo zajistíme jiný kus).

# 4. HLAVNÍ STRÁNKA
A. Hero: 3-v-1 vyhledávač.
  - Tab 1 (výchozí): chat „Dílobot“ (grok-4.7), běžná řeč, doptá se, převede na OEM, spustí progresivní hledání.
  - Tab 2: katalog ve stylu AutoKelly: Značka → Model → Rok a motorizace (kW / kód motoru) → Kategorie (Brzdy, Karoserie, Motor, Elektro, Podvozek…) + pole VIN nebo OEM.
  - Tab 3: hledání podle fotky (grok-vision), drag-and-drop / foto mobilem, přečte OEM, určí díl a stav, ukáže náhradu.
B. Akční nabídka: karusel/mřížka se štítkem „AKČNÍ NABÍDKA – IHNED K ODBĚRU“, fyzicky skladem.
C. Stálá nabídka: katalog trvale skladem k okamžité expedici.
D. PNEU: „Pneu pro dodávky – Skladem“ v menu i na homepage. Vozy: Fiat Ducato, Peugeot Boxer, Citroën Jumper, Mercedes Sprinter, VW Crafter, VW Transporter, Ford Transit, Renault Master, Iveco Daily. Filtr: šířka / profil / průměr (R15C, R16C, R17C), zátěžový index C, období Letní / Zimní / Celoroční.

# 5. DODAVATELÉ A AUTONOMNÍ NÁKUP
SupplierAggregatorService s jednotným rozhraním:
- Nová druhovýroba (B2B REST/SOAP): InterCarsConnector (e-Cat API), AutoPartnerConnector, AutodocConnector.
- Použité OEM: OvokoConnector (Ovoko / RRR.lt API), BPartsConnector.
Pipeline po potvrzení objednávky (košík >= 2 000 Kč):
1. Blokace: předautorizace na kartě (payment_status = 'authorized_hold').
2. Webhook po blokaci spustí AutomatedProcurementAgent (Grok s tool-callingem). Vlastní sklad (Akční, Stálá, Pneu): rezervace + notifikace skladu podle tagu. Externí platforma: B2B objednávka přes API. Doručovací adresa u dodavatele VŽDY naše provozovna (kontrolní mezisklad), nikdy klient.
3. Příjem a kontrola: technik v Adminu odklikne 5bodový protokol (shoda OEM, vizuální stav, úchyty, čistota, záruční plomba), systém provede capture a vytiskne přepravní štítek ke klientovi.

# 6. KLIENTSKÁ ZÓNA
Supabase Auth (e-mail + heslo, Magic Link, Google). /ucet/objednavky: aktivní i historické objednávky, „Moje Garáž“ (vozidla podle VIN), faktury. Timeline objednávky:
1. Objednávka přijata & Finance zabezpečeny
2. Naskladňování na kontrolní pracoviště DámeDíly.cz
3. Důkladná ruční kontrola technikem & Výstupní test (reálné fotky dílu z provozovny + jméno technika)
4. Odesláno se záručním listem k vám (sledovací číslo)

# 7. ADMIN (/admin, role admin)
1. Skladový manažer: formulář (Název, OEM, Kategorie, Nákupní/Prodejní cena, Počet, Fotky – grok-vision předvyplní název a OEM). Umístění: [ ] Akční nabídka [ ] Stálá nabídka [ ] Pneu (Dodávky). Povinný přepínač [ EKOKLADNO ] / [ DAMEDILY ]. Filtr skladu i tržeb podle tagu jedním klikem.
2. QC Hub: fronta automatických objednávek mířících na provozovnu; u každé skutečný dodavatel, nákupní cena, 50% marže, tag a tlačítko [Potvrdit ruční kontrolu & Expedovat klientovi].

# 8. SCHÉMA (supabase/migrations/001_initial_schema.sql)
- profiles: id, email, full_name, phone, company_ico, company_dic, role ('customer','admin').
- inventory_items: id, title_cs, oem_number, part_category, vehicle_compatibility JSONB, tire_specs JSONB (width, profile, diameter, load_index, season), cost_price_czk, selling_price_czk, stock_quantity, placement_type ('action_offer','permanent_offer','van_tires'), internal_project_tag ('ekokladno'|'damedily') – RLS a API view tak, aby se sloupec nikdy nevrátil nepřihlášenému ani zákazníkovi; images text[], created_at.
- search_sessions: id, user_id, query_type ('chat','catalog','photo'), raw_query, resolved_oem, status ('first_found','searching_alternatives','completed'), results JSONB (1 okamžitý + 2 dobíhající).
- orders: id, order_number, user_id, total_amount_czk CHECK (>= 2000), payment_intent_id, payment_status ('authorized_hold','captured','cancelled'), order_status ('ordered_to_facility','in_manual_inspection','shipped_with_warranty','delivered'), inspection_photos text[], inspector_notes, created_at.
- order_items: id, order_id, item_title_cs, oem_number, source_platform (skryté klientovi: 'internal_stock','inter_cars','auto_partner','autodoc','ovoko','b_parts'), supplier_order_ref, internal_project_tag, cost_price_czk, selling_price_czk, quantity.

# 9. POSTUP V CURSORU
1. Struktura projektu, Tailwind s barvami #1E293B a #FF5A1F, schéma v Supabase včetně zabezpečení internal_project_tag.
2. lib/xai-grok.ts (grok-4.7, grok-vision), systémové prompty pro Dílobota, překladač/maskovač zahraničních inzerátů, kalkulačka +50 % marže.
3. /api/search/stream: hned 1. levný díl, na pozadí 2 další varianty, bez AI skóre.
4. app/page.tsx: 3-v-1 vyhledávač, Akční nabídka, Stálá nabídka, Pneu na dodávky, prvky důvěry.
5. Košík s tvrdou validací 2 000 Kč, blokací karty a spouštěčem automatické objednávky na provozovnu.
6. Klientská zóna (/ucet) se sledováním kontroly a Admin (/admin) s tagy a správou skladu.

---
# DODATEK: PRÁVNÍ A TECHNICKÉ MANTINELY (mají přednost před výše uvedeným)
Doplnil ELON, aby white-label obstál vůči českému a EU spotřebitelskému právu. Změny jen s Valentinovým výslovným souhlasem a po ověření u právníka.
1. Prodávajícím je vždy DámeDíly.cz (identifikace firmy, IČO, sídlo v obchodních podmínkách a na fakturách). Zdroje se aktivně nezmiňují, ale na přímý dotaz zákazníka se o původu nikdy nelže. Hlášky typu „ověřený uzel“ nesmí tvrdit nic nepravdivého, například že díl už leží v ČR.
2. Doba doručení se uvádí pravdivě a celá (4–5 pracovních dní). Ruční kontrola se smí prezentovat jako benefit, jen když opravdu probíhá.
3. Každá nabídka jasně říká, zda je díl použitý, nebo nový (OEM, nebo druhovýroba), a uvádí jeho stav. Zachovat zákonnou záruku a 14denní odstoupení pro spotřebitele.
4. Fotky: žádné ořezávání ani odstraňování vodoznaků a copyrightu z cizích fotek. Přednost mají vlastní fotky z kontroly, cizí fotky jen s licencí nebo souhlasem dodavatele. Pro nákup a scraping tržišť používat jen oficiální B2B API nebo partnerské dohody v souladu s jejich podmínkami.
5. Dílobot se na dotaz představí jako AI asistent (povinnost transparentnosti chatbotů podle AI Actu). Skrytí AI skóre je v pořádku.
6. Stripe manual capture: autorizace na kartě obvykle vyprší zhruba po 7 dnech. Kontrolu a capture proto stihnout dřív, nebo včas obnovit autorizaci, a před ostrým provozem to ověřit.
7. AutomatedProcurementAgent objednává jen v rámci limitů (cena, dodavatel, limit na objednávku). Pokud nákupní cena vzroste nad zaplacenou cenu nebo díl chybí, eskaluje na člověka. Ostré nákupy, ostré platby a nasazení do produkce jen po Valentinově ano.
8. internal_project_tag, source_platform a cost_price_czk se nikdy nevrací do veřejného API. Ověřit to testy RLS a API.

# ZMĚNA DODATKU (Valentin, 11. 11. 2026, výslovný souhlas v chatu s Alanem)
Bod 4 se mění: kromě oficiálních API smí systém pro zobrazení reálných nabídek používat i scraping veřejných stránek tržišť a dodavatelů; právní riziko Valentin výslovně přijímá. Podmínky: nízká frekvence a cache, identifikovatelný User-Agent, žádné obcházení captchy, přihlášení, blokací ani technických ochran, žádné ořezávání ani odstraňování vodoznaků a copyrightu, scraper musí jít jedním přepínačem vypnout po zdrojích. Ostatní body dodatku platí beze změny (pravdivost, použitý/nový, dodací lhůta, AI transparentnost, limity nákupního agenta, skryté sloupce).
