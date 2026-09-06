<div align="center">

# Facilita Vet

**Você cuida das visitas. A gente facilita o caminho.**

Planejamento inteligente de visitas para propagandistas da área veterinária.
Transforma uma carteira de clínicas em planejamento mensal, agenda diária,
rotas otimizadas, navegação e roteiro automático no WhatsApp.

</div>

---

## O problema

> *"Tenho uma carteira grande de clínicas, preciso visitar determinadas clínicas
> todos os meses e quero que o sistema monte automaticamente o melhor roteiro
> possível, distribuindo minhas visitas pelos dias disponíveis e reduzindo ao
> máximo meu tempo de deslocamento."*

O Facilita Vet resolve isso pensando em **conjuntos de visitas**, não em
"as N clínicas mais próximas". Ele decide quais clínicas pertencem ao mesmo dia
antes de decidir a ordem — e é essa decisão que separa uma agenda que atravessa
a cidade cinco vezes de uma que passa o dia inteiro numa região.

Na carteira de demonstração (130 clínicas em bairros reais de São Paulo, 100
visitas em 21 dias úteis), o planejamento gerado percorre **~350 km** contra
**~1.330 km** de percorrer a mesma carteira na ordem da planilha — **73% menos
deslocamento**, com dias concentrados em uma ou duas regiões cada.

---

## Decisão de arquitetura

Uma escolha, com o motivo. Alternativas consideradas estão anotadas no código,
onde importam.

| Camada | Escolha | Por quê |
|---|---|---|
| Aplicação | **Next.js 15 (App Router) + React 19 + TypeScript** | Um único deploy serve UI, API e jobs. Server Components eliminam a camada de API para leitura — as telas consultam o banco direto, sem `useEffect` + `fetch`. |
| Banco | **PostgreSQL + Prisma** | O domínio é relacional (plano → rotas → paradas → visitas) e precisa de transação real ao regenerar um mês. Prisma dá tipos ponta a ponta a partir do schema. |
| Motor de rotas | **Módulo próprio, puro, isolado** (`src/lib/route-planner/`) | Sem Prisma, Next ou SDKs. Testável, executável em qualquer runtime, e substituível por OR-Tools sem tocar no resto. |
| Mapas | **Google Maps Platform atrás de uma interface**, com fallback geométrico | Geocoding + Routes API dão o dado real. A interface `MapsProvider` permite trocar por OSRM/Mapbox. Sem chave, o produto funciona com estimativa calibrada, sempre marcada como tal. |
| IA | **Claude atrás de uma interface**, fora do caminho crítico | Analisa e explica decisões já tomadas. Indisponibilidade não afeta o planejamento. |
| Mensageria | **WhatsApp Cloud API (oficial)** + outbox no banco | Automação de navegador está fora: é frágil e viola os termos. O outbox torna o envio idempotente e auditável. |
| Jobs | **Cron da plataforma → rotas HTTP protegidas** (`vercel.json`) | 100% nuvem. Nenhum computador precisa ficar ligado. |
| Auth | **Cookie assinado com HMAC-SHA256** | Um único método de login, zero dependência extra, superfície mínima. |

### Divisão de responsabilidades (regra inegociável)

```
Google Maps  →  FATOS do mundo      (onde fica, quanto anda, quanto demora)
Motor próprio →  DECISÕES            (quem vai, em que dia, em que ordem)
Claude        →  LEITURA CONTEXTUAL  (por que essa solução faz sentido)
```

O Claude **não** decide quantidade de visitas, categorias, datas, distância ou
sequência. Não há chamada de IA no caminho crítico do planejamento.

---

## O motor de planejamento

`src/lib/route-planner/` — módulo puro, 15 etapas, ~1.400 linhas comentadas.

### 1. Seleção — quem entra no mês

O ciclo comercial é **configuração ancorada**, nunca `if (mes === 1)`:

```ts
{
  rules: {
    CAT1: { frequency: 'monthly',     targetCount: 80 },
    CAT2: { frequency: 'alternating', targetCount: 20 },
    CAT3: { frequency: 'alternating', targetCount: 20 },
  },
  alternatingOrder: ['CAT2', 'CAT3'],
  anchorMonth: 1, anchorYear: 2026,
}
```

A categoria alternada do mês vem de aritmética de meses absolutos a partir da
âncora. Funciona começando em qualquer mês, atravessa a virada de ano e lida com
meses anteriores à âncora. O administrador muda tudo isso pela tela de
Configurações — sem migração e sem deploy.

### 2. Distribuição pelos dias

100 visitas em 17 dias **não** vira `6,6,6,6,...` até acabar. A distribuição de
Bresenham espalha os dias mais cheios pelo mês inteiro, e a soma fecha exata:

```
100 / 17  →  15 dias com 6 + 2 dias com 5  =  100 ✓
```

Um ajuste por densidade geográfica desloca no máximo **±1 visita** por dia, para
que a região densa receba uma a mais e a esparsa uma a menos. Sem esse limite o
algoritmo degenera em "um dia com 9 e vários com 4" — que fecha a conta mas
quebra a regra de agenda equilibrada.

### 3. Clustering capacitado — o diferencial

O passo que decide **quais clínicas pertencem ao mesmo dia**.

- **k-means++** para inicializar centroides bem espalhados;
- **atribuição por arrependimento** (*regret*): quem mais perde se não ficar no
  seu melhor cluster escolhe primeiro, respeitando a capacidade do dia;
- iteração até estabilizar, com múltiplos *restarts*.

O passo do arrependimento é o que impede o resultado degenerado. Sem ele, o
cluster mais atraente lota e as últimas clínicas são empurradas para qualquer
lugar — produzindo um dia ótimo e vários péssimos.

As coordenadas são projetadas para um plano métrico local antes do clustering:
agrupar em graus de lat/lng "estica" os grupos no eixo leste-oeste.

### 4. Sequenciamento

TSP aberto com origem fixa e destino opcional:
**multi-start nearest neighbour → 2-opt → or-opt**. Para 5–10 paradas isso acha
o ótimo na prática, em microssegundos. A interface `SequenceProblem` é o ponto de
troca para um solver dedicado quando o volume justificar.

### 5. Score

Custo ponderado com pesos **em configuração**, nunca espalhados pelo código:

```
custo = minutos·w.duration + km·w.distance + inversões·w.backtracking
      + kmDesvio·w.detour + kmRaio·w.concentration + |Δmeta|·w.balance
```

O score exibido (0–100) normaliza o custo **por parada** — sem isso, um dia com
8 visitas sempre "pontuaria pior" que um com 4, o que não diz nada sobre
qualidade. *Backtracking* é medido por inversões de azimute acima de 110°:
exatamente o que o profissional sente como "voltei por onde vim".

### 6. Comparação e honestidade estatística

Seis soluções candidatas são geradas e comparadas. A economia exibida vem da
comparação com uma **linha de base calculada** — a carteira percorrida na ordem
da planilha, que é o cenário real de quem usa Excel. Quando a comparação não pode
ser feita, o produto **não mostra número de economia**. Nada é inventado.

### Controle de custo

A matriz de deslocamento é pedida **por dia** (~81 elementos), nunca para a
carteira inteira (10.000 elementos). O clustering usa estimativa geométrica,
porque matriz real não mudaria materialmente a decisão de agrupamento.
Coordenadas têm cache permanente; matrizes têm TTL.

---

## Rodando localmente

### Pré-requisitos

- Node.js 20+
- PostgreSQL 16 (ou Docker)

### Passo a passo

```bash
# 1. Dependências
npm install

# 2. Banco (Docker) — ou aponte DATABASE_URL para um Postgres existente
docker compose up -d

# 3. Ambiente
cp .env.example .env
# Gere um AUTH_SECRET: openssl rand -base64 48

# 4. Schema + dados de demonstração + mês planejado
npm run db:setup

# 5. Subir
npm run dev
```

Abra <http://localhost:3000> e entre com:

```
demo@facilitavet.app / facilitavet
```

O sistema abre **com conteúdo**: 130 clínicas, dois meses planejados, calendário
preenchido, mapa com rotas, histórico com visitas realizadas e indicadores reais.

### Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de produção (gera o Prisma Client antes) |
| `npm start` | Servidor de produção |
| `npm test` | Suíte de testes |
| `npm run typecheck` | Verificação de tipos |
| `npm run db:migrate` | Cria e aplica uma migração |
| `npm run db:deploy` | Aplica migrações existentes (produção) |
| `npm run db:seed` | Popula a carteira de demonstração |
| `npm run demo:plan` | Gera o mês planejado da demo no banco |
| `npm run db:setup` | `db:deploy` + `db:seed` + `demo:plan` |
| `npm run db:studio` | Prisma Studio |
| `npm run demo:route` | **Gera uma rota de demonstração no terminal**, sem banco e sem UI |

### Rota de demonstração no terminal

Inspeciona o motor isoladamente — útil para calibrar pesos ou avaliar o
algoritmo sem subir a aplicação:

```bash
npm run demo:route
npm run demo:route -- --month 10 --year 2026 --target 100 --days 17
```

Saída: categorias do mês, distribuição das visitas, distância e tempo, score,
comparação com a linha de base, as candidatas avaliadas e a agenda dia a dia.

---

## Variáveis de ambiente

**Obrigatórias**

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | Conexão PostgreSQL |
| `AUTH_SECRET` | 32+ caracteres aleatórios. `openssl rand -base64 48` |
| `APP_URL` | URL pública — usada nos links do WhatsApp |

**Opcionais** — o produto funciona sem todas elas, com degradação explícita:

| Variável | Sem ela |
|---|---|
| `GOOGLE_MAPS_API_KEY` | Distâncias viram estimativa geométrica calibrada (sempre marcada na interface); geocodificação fica indisponível |
| `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` | O mapa usa a renderização vetorial própria em vez de tiles do Google |
| `ANTHROPIC_API_KEY` | Sem textos de análise; o planejamento é idêntico |
| `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_ACCESS_TOKEN` | Mensagens são geradas e ficam no outbox, mas não são enviadas |
| `CRON_SECRET` | Rotas de cron ficam abertas (aceitável só em desenvolvimento) |

> **Segurança:** nenhuma chave sensível chega ao navegador. A única variável
> pública é `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`, que por natureza é pública e
> deve ser protegida por **restrição de referenciador HTTP** no console do
> Google. A chave de servidor nunca é exposta.

---

## Configurando o Google Maps

1. No [Google Cloud Console](https://console.cloud.google.com/), crie um projeto
   e ative o faturamento.
2. Ative as APIs: **Geocoding API** e **Routes API**.
3. Crie uma **chave de servidor**:
   - *Restrições de aplicativo*: nenhuma (ou por IP, se seu deploy tiver IP fixo);
   - *Restrições de API*: apenas Geocoding API e Routes API.
   - Coloque em `GOOGLE_MAPS_API_KEY`.
4. *(Opcional)* Crie uma **chave de navegador** para os tiles do mapa:
   - Ative também a **Maps JavaScript API**;
   - *Restrições de aplicativo*: referenciadores HTTP → `https://seu-dominio.com/*`;
   - Coloque em `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`.

**Custo.** `MAPS_MATRIX_ELEMENT_BUDGET` (padrão 4000) limita elementos de matriz
por execução. Um mês de 21 dias com ~5 paradas gasta ~1.000 elementos, e o cache
absorve as regenerações. `MAPS_PROVIDER=offline` desliga o Google por completo.

## Configurando o Claude

1. Gere uma chave em <https://console.anthropic.com/>.
2. `ANTHROPIC_API_KEY=sk-ant-...` e, se quiser, `CLAUDE_MODEL` (padrão
   `claude-sonnet-5`).
3. `CLAUDE_ENABLED=false` desliga sem remover a chave.

A chave fica **apenas no servidor**. O prompt do sistema proíbe explicitamente
inventar números: o Claude recebe as métricas já calculadas e apenas as
interpreta.

## Configurando o WhatsApp

1. Em <https://developers.facebook.com/>, crie um app do tipo **Business** e
   adicione o produto **WhatsApp**.
2. Anote o **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`.
3. Gere um **token de acesso permanente** (usuário de sistema) →
   `WHATSAPP_ACCESS_TOKEN`.
4. **Templates.** Fora da janela de 24 h, a Meta só permite mensagens a partir de
   template aprovado. O roteiro diário é uma notificação proativa, então em
   produção ele precisa de um: aprove um template com um parâmetro de corpo e
   informe `WHATSAPP_TEMPLATE_NAME`. Sem template, o envio usa texto livre — o
   que funciona em ambiente de teste e dentro da janela de conversa.
5. *(Opcional)* `WHATSAPP_VERIFY_TOKEN` e `WHATSAPP_APP_SECRET` para webhooks.

Sem credenciais, o provider de log assume: as mensagens são geradas e ficam
visíveis em **Configurações → WhatsApp → Últimas mensagens**, marcadas como não
enviadas. Toda a mecânica de agendamento é exercitada sem credencial de produção.

---

## Deploy

### Vercel (recomendado)

```bash
vercel link
vercel env add DATABASE_URL      # Neon, Supabase, RDS...
vercel env add AUTH_SECRET
vercel env add APP_URL
vercel env add CRON_SECRET
# ... demais chaves conforme a necessidade

vercel --prod
```

Depois do primeiro deploy, aplique as migrações:

```bash
DATABASE_URL="<url de produção>" npm run db:deploy
```

O `vercel.json` já registra os jobs:

| Rota | Agenda (UTC) | Função |
|---|---|---|
| `/api/cron/prepare-daily-routes` | `55 10 * * 1-5` | 07:55 em Brasília — monta e enfileira o roteiro do dia |
| `/api/cron/dispatch-messages` | `*/5 * * * *` | Envia o que estiver vencido no outbox |

> As agendas do cron são em **UTC**. `55 10` corresponde a 07:55 em UTC−3.
> Ajuste se seu fuso for outro.

### Outras plataformas

Qualquer runtime Node com Postgres serve (Railway, Fly.io, Render, Docker).
Só é preciso chamar as duas rotas de cron periodicamente com o header
`Authorization: Bearer $CRON_SECRET`.

---

## Por que o envio é em duas etapas

```
07:55  preparar  →  verifica feriado, dia bloqueado e existência de roteiro
                    monta a mensagem com o estado ATUAL do dia
                    grava no outbox com dedupeKey
08:00  despachar →  envia o que venceu
```

A separação resolve dois problemas de uma vez. A mensagem reflete alterações
manuais feitas até o último momento (§43), e o envio é **reentrante**: se o job
rodar duas vezes, `dedupeKey` e a transição `QUEUED → SENDING` garantem que a
mensagem sai uma única vez.

O roteiro **nunca** é enviado em: fim de semana, feriado nacional/estadual/
municipal, dia bloqueado manualmente, dia sem roteiro, dia com todas as visitas
canceladas, ou quando o WhatsApp está desligado nas configurações. Cada caso tem
teste de integração contra o banco.

---

## Testes

```bash
npm test
```

78 testes. Os que cobrem regras de produto:

| Área | O que trava |
|---|---|
| Ciclo de categorias | Cat 1 mensal; Cat 2/Cat 3 alternadas; nunca as duas no mesmo mês; virada de ano; meses anteriores à âncora; âncora configurável |
| Exclusividade | Detecta a mesma clínica cadastrada em duas categorias |
| Distribuição | 100/17 usa só 5 e 6, soma exata 100; espalhada pelo mês |
| Viabilidade | 80 visitas em 17 dias com máx. 4/dia é recusado **com a alternativa calculada** |
| Rota | Todas as obrigatórias aparecem; nenhuma duas vezes; dias concentrados (raio < 6 km); horários crescentes; almoço respeitado |
| Determinismo | Mesma entrada + mesma semente = mesmo plano |
| Linha de base | O plano bate a ordem da planilha com folga (> 50%) |
| Edição manual | Reordenar recalcula distância, tempo e score de verdade |
| Adequação | Alternativas de troca respeitam as categorias do mês |
| Geocoding | Falha é tratada e visível, nunca silenciosa |
| Fallback | Claude, Google e WhatsApp fora do ar **ao mesmo tempo** e o sistema segue |
| WhatsApp (integração) | Feriado, fim de semana, dia bloqueado, dia sem roteiro, idempotência, atualização do texto antes do envio |

Os testes de integração usam o Postgres real e são pulados automaticamente
quando o banco não está acessível.

---

## Estrutura

```
src/
├── app/
│   ├── (app)/              # Telas autenticadas
│   │   ├── dashboard/      # "O que faço hoje?" + "Como está meu mês?"
│   │   ├── planejamento/   # Regras do mês, dias úteis, geração
│   │   ├── agenda/         # Calendário mensal + roteiro do dia
│   │   ├── mapa/           # Visualização geográfica com camadas
│   │   ├── carteira/       # Clínicas + assistente de importação
│   │   ├── historico/      # Visitas realizadas + histórico por clínica
│   │   └── configuracoes/  # Perfil, jornada, REGRAS COMERCIAIS, WhatsApp
│   ├── api/                # Rotas HTTP (inclui /api/cron/*)
│   └── login/
├── components/
│   ├── ui/                 # Design system
│   ├── map/                # Mapa vetorial próprio + variante Google
│   ├── layout/  brand/  route/
└── lib/
    ├── route-planner/      # ⭐ MOTOR — puro, sem dependências de framework
    ├── providers/          # maps/ · claude/ · whatsapp/  (interfaces + fallbacks)
    ├── services/           # Ponte entre motor e banco
    ├── auth/  demo/  db.ts  env.ts  logger.ts
prisma/     # schema + seed
scripts/    # demo-route.ts (terminal) · demo-plan.ts (banco)
tests/
```

---

## Observabilidade

Logs estruturados em JSON, uma linha por evento, com `executionId`
correlacionando todas as etapas de uma geração de rota, chamada de API ou
disparo de mensagem. Campos cujo nome sugere segredo (`key`, `token`, `secret`,
`password`, `authorization`, `credential`) são **redigidos automaticamente**.

A tabela `PlanRun` guarda cada execução do planejamento: estratégia vencedora,
duração, provider de mapas, elementos de matriz consumidos, acertos de cache,
se o Claude foi usado e os avisos gerados.

---

## Evolução prevista

A arquitetura já acomoda, sem reescrita:

- **CRM comercial** — `Clinic.metadata` e `Visit.metadata` são pontos de extensão
  para produtos apresentados, oportunidades, pedidos e follow-up.
- **Multi-tenant** — toda entidade de negócio já carrega `organizationId`.
- **Solver dedicado** — `SequenceProblem` e `TravelMatrixResolver` isolam o
  algoritmo; OR-Tools entra sem tocar na aplicação.
- **Outro provedor de mapas** — implementar `MapsProvider`.
- **WhatsApp conversacional** — o outbox e os providers já separam composição de
  envio; falta só o webhook de entrada.
- **Inteligência adicional** — janelas de atendimento, prioridade comercial,
  trânsito histórico e potencial de venda entram como novos termos no score, que
  já é ponderado e configurável.

---

<div align="center">
<sub>Facilita Vet — você cuida das visitas, a gente facilita o caminho.</sub>
</div>
