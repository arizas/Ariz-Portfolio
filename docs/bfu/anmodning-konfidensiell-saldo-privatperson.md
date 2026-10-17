<!--
MAL for privatperson. For aksjeselskap: anmodning-konfidensiell-saldo-as.md.

Felt i [HAKEPARENTES] fylles inn før innsending. Personopplysninger skal ikke
committes; fyll dem inn i kopien som sendes, ikke i denne filen.

Bare faktum som gjengis i uttalelsen binder Skatteetaten. Alt under
«Den planlagte disposisjonen» må derfor stemme, og punktene merket
[BEKREFT] er ikke verifisert ennå.

Disposisjonen må ikke være satt i gang før uttalelsen foreligger.
Uttalelsen kan bli publisert i anonymisert form.

Sendes via innlogget melding på skatteetaten.no, eller til
Skatteetaten, Postboks 9200 Grønland, 0134 Oslo.
Gebyr til konto 7694 05 12251, merket med navn og fødselsnummer. Legg ved
kvittering. Lønnstakere, pensjonister og trygdede betaler et halvt
rettsgebyr. Andre privatpersoner, og den som også driver enkeltpersonforetak,
betaler to ganger rettsgebyret.
-->
<!--
Uttalelsen binder bare den som ber om den. Andre kan vise til en publisert
uttalelse, men kan ikke kreve å bli behandlet likt.
-->

# Anmodning om bindende forhåndsuttalelse

**Skatteforvaltningsloven § 6-1 første ledd**

| | |
|---|---|
| Navn | [NAVN] |
| Adresse | [ADRESSE] |
| Fødselsnummer | [FØDSELSNUMMER] |
| Telefon (dagtid) | [TELEFON] |
| Gebyr | [Et halvt / To ganger] rettsgebyr, betalt [DATO]. Kvittering vedlagt. |
| Planlagt gjennomføring | [MÅNED ÅR], og ikke før uttalelsen foreligger |

## 1 Innledning

Jeg ber om en bindende forhåndsuttalelse om hvorvidt det er realisasjon etter skatteloven § 9-2 (1) å flytte en kryptoeiendel fra min offentlige saldo i NEAR Intents til min konfidensielle saldo i NEAR Confidential Intents, og senere tilbake.

Jeg er [lønnstaker] og driver ikke virksomhet med kryptoeiendeler. Spørsmålet gjelder gevinst og tap utenfor virksomhet, jf. skatteloven § 5-1 (2) og § 6-2 (1).

Jeg har ingen tilknyttede personer, selskaper eller morselskap som nevnt i skatteforvaltningsforskriften § 6-1-4 (8). [BEKREFT]

## 2 Den planlagte disposisjonen

### 2.1 Hva jeg skal gjøre

Jeg har i dag [ANTALL] USDC på min offentlige konto i NEAR Intents. Eiendelen har id-en `nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`. [BEKREFT eiendel og beløp]

1. I [MÅNED ÅR] vil jeg flytte hele beholdningen fra den offentlige kontoen til min konfidensielle konto. Det gjøres i near.com ved å bytte fra «Main Account» til «Confidential Account».
2. Senere, på et tidspunkt jeg ikke har bestemt, vil jeg flytte samme antall tilbake til den offentlige kontoen.

Mellom de to stegene vil jeg ikke bytte, sende eller bruke eiendelen på noen annen måte. Begge stegene skjer fra min egen konto, signert med min egen nøkkel. Ingen andre handler på mine vegne.

### 2.2 NEAR Intents

NEAR Intents er en smartkontrakt på NEAR-blokkjeden, `intents.near`. Kontrakten fører saldoer i ulike eiendeler for hver NEAR-konto. Min konto er `[KONTO].near`. Saldoen er offentlig og kan leses av alle.

USDC-saldoen er en saldo i `intents.near` i eiendelen nevnt over. Det er den samme eiendelen jeg ville hatt i NEAR Intents uansett om jeg flytter den eller ikke. Flyttingen utsteder ikke noen ny eiendel.

### 2.3 NEAR Confidential Intents

Ifølge NEAR (intents.near.org/confidential) kjører Confidential Intents på et eget privat shard i NEAR-nettverket. Shardet drives av et sett uavhengige, tillatelsesbaserte validatorer og er koblet til NEAR-hovednettet med en bro basert på et betrodd kjøremiljø (TEE). Saldoen på shardet er ikke offentlig. Bare jeg kan lese den, ved å logge inn med min egen nøkkel.

Ved flytting inn til den konfidensielle kontoen:

- registrerer 1Click-tjenesten flyttingen med samme eiendel på begge sider (`originAsset` = `destinationAsset`) og samme beløp inn og ut (`amountIn` = `amountOut`);
- reduseres min offentlige saldo med beløpet, og min konfidensielle saldo økes med nøyaktig samme beløp;
- betales [INGEN GEBYR / GEBYR PÅ X] [BEKREFT];
- havner de underliggende tokenene i `intents.near` på [KONTO SOM HOLDER DEM] [BEKREFT ved å slå opp transaksjonen for en tidligere flytting i en NEAR-utforsker].

Flytting tilbake skjer på samme måte i motsatt retning.

Mens eiendelen står på den konfidensielle kontoen, kan jeg [BEKREFT hver av disse]:

- flytte den tilbake til den offentlige kontoen når jeg vil;
- ta den ut til en annen blokkjede;
- sende den til andres konfidensielle konto;
- bytte den til andre eiendeler.

Det jeg eier, er det samme antall av den samme eiendelen, og prisen følger eiendelen. Jeg bærer hele den økonomiske risikoen hele tiden.

## 3 Spørsmålene

1. Er det realisasjon etter skatteloven § 9-2 (1) å flytte USDC fra min offentlige konto i NEAR Intents til min konfidensielle konto, slik det er beskrevet i punkt 2?
2. Er det realisasjon å flytte samme USDC tilbake?

## 4 Rettslig vurdering og min konklusjon

### 4.1 Rettslig utgangspunkt

Realisasjon omfatter «overføring av eiendomsrett mot vederlag og opphør av eiendomsrett», jf. skatteloven § 9-2 (1). I SKNS1-2025-83 (11. desember 2025) la Skatteklagenemnda avgjørende vekt på om byttet «kvalitativt sett har endret eiendomsrettens karakter», jf. Rt. 2014 s. 822 (Bonheur). Den dommen bygger på kontinuitetsprinsippet i Rt. 2002 s. 798 (Nordea): har rettighetene etter transaksjonen samme karakter som før?

Skatte-ABC V-13-3.4.3 sier at overføring fra en blokkjede til en annen *normalt* innebærer at den opprinnelige tokenen er erstattet med en annen. Cross chain bridging og wrapping er nevnt som eksempler.

### 4.2 Hvorfor dette etter mitt syn ikke er realisasjon

**Samme eiendel.** I cbBTC-saken ble BTC byttet til en ny token med en annen utsteder, cbBTC fra Coinbase. Skattyteren fikk bare en opsjon på å bytte tilbake. Her utstedes ingen ny token. Eiendelen har samme id før og etter, og beløpet er nøyaktig det samme. Det jeg har etter flyttingen er ikke et krav på å få eiendelen tilbake. Det er eiendelen selv, ført på en annen saldo.

**Samme protokoll og samme eier.** Begge saldoene er en del av NEAR Intents. Begge disponeres med min egen nøkkel. Ingen tredjepart får råderett over eiendelen. Situasjonen ligner mer på å flytte penger mellom to kontoer i samme bank enn på bytte.

**Samme blokkjede.** Et shard er en del av NEAR-blokkjeden, ikke en egen blokkjede. NEAR er bygget som én kjede delt i flere shards. Overføringen er derfor ikke en «overføring fra en blokkjede til en annen» i Skatte-ABCs forstand. Det skjer heller ingen wrapping, siden eiendelen ikke pakkes inn i en ny token.

**Råderetten blir ikke unyttbar.** Skattekontoret viste i cbBTC-saken til at verdipapirutlån var realisasjon fordi eierbeføyelsene ble «unyttbare» for utlåneren. Her kan jeg bruke eiendelen fullt ut mens den står på den konfidensielle kontoen. Jeg kan flytte den, bytte den og ta den ut. [Forutsetter at punkt 2.3 bekreftes.]

**Kontinuitet.** Rettighetene jeg har etter flyttingen er av samme karakter som før: samme antall av samme eiendel, i samme protokoll, med samme risiko og samme råderett. Det eneste som endres er hvem som kan *se* saldoen.

### 4.3 Min konklusjon

Ingen av flyttingene er realisasjon etter skatteloven § 9-2 (1). Inngangsverdien på USDC-beholdningen videreføres uendret.

## 5 Vedlegg

1. Kvittering for betalt gebyr
2. [Eksempel: en tidligere flytting til konfidensiell konto, med 1Click-historikk og transaksjons-id, som illustrasjon av mekanismen]
3. [Skjermbilde av near.com som viser valget mellom «Main Account» og «Confidential Account»]

[STED, DATO]

[NAVN]
