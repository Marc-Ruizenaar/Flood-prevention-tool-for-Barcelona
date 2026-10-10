# Evacuation routes and resources, Barcelona (researched 10 Oct 2026)

## The main finding

Barcelona publishes no evacuation routes for street flooding, and neither does
Catalonia. The city's plan is the PAEM for "risc d'insuficiència drenant",
nested under the regional INUNCAT plan. Both work by confinement: stay inside,
go up a floor, keep out of basements, garages and underpasses, and leave only
when 112 or Protecció Civil order it. Evacuation is a last resort, planned and
ordered by the plan director (the mayor), not something a resident picks from a
map. During the 3 to 4 October 2026 storm the city raised the PAEM to
emergency, stopped activity until Sunday 14:00, stopped the metro at midnight
and sent an ES-Alert. Nobody was told to evacuate; 160 people were moved out
of Parc de la Ciutadella and 82 people who lost housing were put up by CUESB
at Dos de Maig and CAE.

So the resident answer to "what can I do about it" is not a route. It is:

1. Stay in, go up, no basements or garages, no underpasses, no driving.
2. Know the low streets within a few hundred metres (the model gives these).
3. Know what shut nearby last time (metro accesses, parks, Ronda de Dalt).
4. Know who to call: 112, CUESB 900 703 030 (24 h, lost housing / shelter /
   vulnerable people), 010 (what is open).

The app now shows exactly that under "If it floods: where to go" in `/citizen`.
Data lives in `data/flood-resources.json`.

## By area of the simulated box (Urgell / Raval run)

Low streets are from the 3 Oct simulation (peak depth), not observations.

| Area | Low streets in the model | What shut nearby, 3 to 4 Oct |
|---|---|---|
| el Raval | La Rambla (4.2 m at the low point), Carrer de Sant Pau (3.5 m), Rambla del Raval (1.6 m), Reina Amàlia (1.4 m) | Liceu L3 platform out on 29 Sep; metro stopped citywide at midnight 3 Oct |
| Sant Antoni | Ronda de Sant Antoni (1.9 m) | none listed within the barrio |
| Antiga / Nova Esquerra de l'Eixample | Casanova (2.1 m), Comte d'Urgell (2.0 m) | Hospital Clínic L5, Rosselló access |
| el Poble-sec | Carrer de Lleida (1.4 m) | Poble-sec social services centre closed, served online until Tue 6 Oct |
| Hostafrancs / la Bordeta edge | Carretera de la Bordeta (1.6 m) | Florida L1 Mas Nou access, Hospital de Bellvitge L1 Riera Blanca access |
| el Gòtic (west edge) | La Rambla | Parc de la Ciutadella closed, 160 people moved out |

Outside the box, the metro accesses TMB still had shut on Sunday 4 Oct 11:05
were: Marina (Almogàvers), Glòries, Les Corts (Joan Güell), Zona Universitària
(Parc Cervantes), El Carmel (plaça Pastrana), El Coll | La Teixonera (Arenys),
La Salut L10 Nord (Marquès de Sant Mori). Ronda de Dalt was cut at Via Júlia
and at Santa Coloma, Llobregat direction. Priority recovery zones were the hill
barrios hit by landslides (Torre Baró and neighbours), already on the map as
observed impacts.

## Resources that exist city-wide

- 112, emergencies.
- CUESB, 900 703 030, Carrer de la Llacuna 25, 24 h social emergencies.
- 010, city information.
- ES-Alert to phones when INUNCAT reaches its top level.
- Meteocat warnings: https://www.meteo.cat/prediccio/smp
- TMB status: https://www.tmb.cat/ca/estat-servei
- Trànsit: https://sct.gencat.cat/ca/trànsit/incidencies/
- Protecció Civil advice sheet (already linked in the app):
  https://dsp.interior.gencat.cat/handle/20.500.14007/3307

No official list of shelter points or "punts d'acollida" was found for the
October storm; Dos de Maig and CAE were used ad hoc by CUESB. Do not show
shelters on the map until the city names them.

## Sources

- Metro accesses closed, TMB via Metròpoli, 4 Oct 2026:
  https://www.metropoliabierta.cat/mobilitat/20261004/accessos-metro-barcelona-tancats-temporal-pluges-desena-dentrades-afectades/1003742799680_0.html
- City recovery balance, La Ciutat, 5 Oct 2026:
  https://laciutat.cat/laciutatdebarcelona/barcelona-avanca-en-recuperacio-despres-pluges-mante-alerta-risc-inundacions_902161_102.html
- PAEM alert activated, Catalunya Press, 1 Oct 2026:
  https://www.catalunyapress.cat/article/barcelona/2026-10-01/6035061-barcelona-activa-alertes-per-possibles-inundacions-davant-risc-dinsuficincia-drenatge-ciutat
- City stops activity, Tot Barcelona, 3 Oct 2026:
  https://www.totbarcelona.cat/societat/barcelona-atura-tota-lactivitat-pel-temporal-de-pluges-torrencials-744113/
- Ronda de Dalt and metro cuts, Catalunya Press, 5 Oct 2026:
  https://www.catalunyapress.cat/article/societat/2026-10-05/6039708-caos-mobilitat-barcelona-pluges-provoquen-importants-talls-metro-i-ronda-dalt
- ES-Alert sent to Barcelona, betevé:
  https://beteve.cat/societat/dilluns-afectacions-mobilitat-pluges-torrencials/
- Confinement before evacuation, Diputació de Barcelona civil protection training (May 2026):
  https://info-cemical.diba.cat/documents/d/hua/formacio-pc-mpal-4-operativitat-20260525diba
- INUNCAT 2025 changes dossier, Generalitat:
  https://govern.cat/govern/docs/2025/12/23/12/22/Dossier%20canvis%20INUNCAT%202025.pdf
- Protecció Civil advice sheets: https://dsp.interior.gencat.cat/handle/20.500.14007/3307 and /3308
- CUESB number, Ciutat Vella directory: https://www.ravalnet.org/sites/default/files/4_Directori-CV.pdf
