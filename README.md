# fiap-tc-ms-execucao — Execução e Produção

Microsserviço **participante da Saga** da oficina mecânica. Responde pelo
último passo do fluxo e pela sua compensação, e depois conduz o trabalho do
mecânico:

| Passo da Saga | Comando recebido | Compensação |
| --- | --- | --- |
| 5 — enfileirar execução | `ENFILEIRAR_EXECUCAO` | `CANCELAR_EXECUCAO` |

Faz parte do Tech Challenge da **Fase 4** da Pós-Tech SOAT (FIAP):

| Serviço | Repositório | Papel na Saga | Banco | Porta local |
| --- | --- | --- | --- | --- |
| Ordem de Serviço | [fiap-tc-ms-os](https://github.com/pyGits/fiap-tc-ms-os) | Orquestrador | MySQL (SQL) | 3000 |
| Orçamento e Pagamento | [fiap-tc-ms-billing](https://github.com/pyGits/fiap-tc-ms-billing) | Participante | MongoDB (NoSQL) | 3001 |
| **Execução e Produção** | [fiap-tc-ms-execucao](https://github.com/pyGits/fiap-tc-ms-execucao) | **Participante** | MongoDB (NoSQL) | 3002 |

A estratégia da Saga e a justificativa da orquestração estão documentadas no
[README do OS Service](https://github.com/pyGits/fiap-tc-ms-os#a-saga).

---

## Onde a Saga termina e a oficina começa

Este serviço marca a fronteira entre o que uma transação distribuída pode
coordenar e o que não pode.

O passo 5 da Saga é **aceitar o serviço e colocá-lo na fila** — uma operação de
milissegundos. O reparo em si leva horas ou dias, tempo que nenhuma transação
distribuída pode ficar esperando. Por isso:

- `ENFILEIRAR_EXECUCAO` encerra a Saga: o carro entrou na fila, o fluxo está
  consistente.
- Iniciar e finalizar o reparo são operações **posteriores**, feitas pelo
  mecânico via REST, já fora da Saga.
- A finalização publica o **evento** `EXECUCAO_FINALIZADA`. O OS Service reage a
  esse fato e move a ordem de serviço para `FINALIZADA` — sem que este serviço
  conheça o outro. É o único trecho **coreografado** do fluxo, e por um motivo:
  anunciar um fato consumado não precisa de orquestrador.

### Fila cheia é recusa de negócio, não erro técnico

A oficina tem capacidade finita (`CAPACIDADE_FILA`, padrão 20). Quando a fila
está cheia, o serviço responde `EXECUCAO_FALHOU` e a Saga compensa: estorna o
pagamento e cancela o orçamento, nessa ordem.

Essa regra existe por si — uma oficina não aceita trabalho infinito — e tem um
efeito colateral útil: dá à Saga um caminho de falha **realista** no último
passo, o que torna a demonstração do rollback honesta, sem depender só de um
gatilho artificial.

### O limite da compensação

Se o reparo **já foi concluído**, `CANCELAR_EXECUCAO` responde
`compensado: false`. A Saga sai de `COMPENSANDO` — ela não pode ficar presa —
mas o caso vira **pendência manual**, com evento próprio na telemetria
(`ExecucaoCancelada` com `compensado: false`).

Um carro consertado não volta ao estado anterior porque uma mensagem pediu. Esse
é exatamente o efeito colateral que a ordenação dos passos da Saga tenta evitar:
cobrar (passo 4) **antes** de enfileirar a execução (passo 5) coloca o que é
difícil de desfazer depois do que é fácil de estornar.

---

## O que este serviço faz — e o que deliberadamente não faz

**Execuções não são criadas por HTTP.** Elas nascem do comando
`ENFILEIRAR_EXECUCAO` publicado na fila `saga.execucao.comandos`. As rotas REST
consultam a fila e registram o trabalho do mecânico:

| Rota | Para quê |
| --- | --- |
| `GET /execucoes/fila` | tela de trabalho do mecânico: o que está na fila, na ordem, com o tempo total estimado |
| `GET /execucoes` | lista com filtro por status |
| `GET /execucoes/ordem-servico/{id}` | consulta pela chave de negócio que atravessa os três serviços |
| `POST /execucoes/{id}/inicio` | mecânico inicia o reparo |
| `POST /execucoes/{id}/finalizacao` | mecânico conclui o reparo e publica `EXECUCAO_FINALIZADA` |

---

## Por que MongoDB

Além de atender ao requisito de persistência poliglota da fase, a execução é o
agregado cujo **esquema muda com mais frequência**: checklists, fotos do reparo,
apontamentos do mecânico, laudos. Um banco de documentos absorve essa evolução
sem uma migration por campo novo.

A execução também é um agregado fechado — lida e gravada por inteiro, com a
lista de serviços embutida.

Os índices são criados **em código** no bootstrap (`src/mongo.ts`). O índice
**único** em `mensagens_processadas.mensagemId` é o que torna a idempotência à
prova de corrida entre duas réplicas do pod: enfileirar duas vezes a mesma OS
ocuparia duas vagas da oficina.

---

## Arquitetura

**Clean Architecture**: a regra de negócio não conhece Express, MongoDB nem
RabbitMQ.

```
domain/
  entity/            Execucao (máquina de estados), ServicoExecutavel
  repository/        Portas + adaptadores Mongo e Memória
  gateway/           Portas de mensageria e telemetria + dublês
  usecase/           Enfileirar, Cancelar (compensação), Operar
src/
  routes/            Adaptador de entrada síncrono (consultas + operação)
  messaging/         Adaptador de entrada assíncrono (ComandoConsumer)
  mongo.ts           Conexão e índices do banco PRÓPRIO
  middleware/        Auth (Cognito), correlationId, tratamento de erro
  telemetry/         New Relic
```

Ciclo de vida da execução:

```
   NA_FILA ──iniciar()──> EM_ANDAMENTO ──finalizar()──> FINALIZADA
      │                        │
      └──cancelar()────────────┴──> CANCELADA        (FINALIZADA não cancela)
```

### Nenhum serviço acessa o banco de outro

Cumprido por **isolamento de credencial**: o Secret deste serviço no Kubernetes
contém apenas a `MONGO_URI` do banco dele.

---

## Como rodar localmente

O compose deste repositório depende da rede `oficina-net` e do RabbitMQ criados
pelo compose do OS Service — **suba aquele primeiro**:

```bash
cd fiap-tc-ms-os         && docker compose up -d --build
cd ../fiap-tc-ms-execucao && docker compose up -d --build
```

| Endereço | O quê |
| --- | --- |
| http://localhost:3002/api-docs | Swagger deste serviço |
| http://localhost:15672 | Painel do RabbitMQ (`guest` / `guest`) |

No compose local, `CAPACIDADE_FILA=3`: encher a fila e ver a Saga compensar fica
a quatro requisições de distância.

### Sem Docker

```bash
npm ci
cp .env.example .env     # ajuste MONGO_URI e RABBITMQ_URL
npm run dev
```

---

## Testes e cobertura

```bash
npm test               # unitários
npm run test:coverage  # unitários + cobertura (falha abaixo de 80%)
npm run test:bdd       # cenários Gherkin (Cucumber)
npm run test:all       # tudo
```

**Resultado desta entrega — 80 testes em 5 suítes:**

| Métrica | Cobertura |
| --- | --- |
| Statements | **95,37%** |
| Branches | **85,36%** |
| Functions | **92,41%** |
| Lines | **95,85%** |

O patamar de 80% nas quatro métricas está em `coverageThreshold`
(`jest.config.js`): o Jest encerra com erro se a cobertura cair, e o pipeline
falha com ele.

Destaques do que é testado:

- **Máquina de estados** da execução: o ciclo completo, as transições inválidas
  e o cancelamento idempotente que preserva o motivo original.
- **O limite da compensação**: cancelar um reparo já finalizado devolve
  `compensado: false` e **não** altera o status — a verificação de que o
  serviço não finge ter desfeito o que não desfez.
- **Capacidade da oficina**: fila cheia responde `EXECUCAO_FALHOU` com o motivo,
  e a vaga volta a ficar disponível depois da compensação.
- **Idempotência**: a mesma Saga não entra duas vezes na fila; uma execução
  cancelada permite reenfileiramento (é uma Saga nova).
- **Adaptador Mongo**: serialização e reidratação do agregado com os serviços
  embutidos, contagem que considera apenas o que ocupa a oficina, erro de chave
  duplicada absorvido e erro de conexão propagado.
- **Consumidor**: reentrega, incremento de tentativa, *dead letter*, duplicata
  descartada, payload inválido rejeitado sem reenfileirar.
- **Telemetria**: o desvio entre o tempo estimado e o tempo real de oficina — a
  métrica que a gestão usa para calibrar prazos prometidos ao cliente.
- **Autenticação**: 401 genérico (sem revelar o motivo) e 503 quando o Cognito
  não está configurado — nunca liberar a rota.

### BDD

`tests/bdd/features/execucao_oficina.feature`, 9 cenários em Gherkin português:

```gherkin
Cenario: Reparo concluido nao pode ser desfeito pela compensacao
  Dado que a execucao da Saga ja foi enfileirada
  E que o mecanico "Joao da Silva" iniciou o reparo
  E que o mecanico finalizou o reparo
  Quando o orquestrador envia a compensacao para cancelar a execucao por "Rollback tardio"
  Entao a Execucao deve responder "EXECUCAO_CANCELADA"
  E a compensacao deve ser sinalizada como impossivel
  E a execucao deve estar com o status "FINALIZADA"
```

---

## Como demonstrar o rollback por aqui

Duas formas, as duas reais:

1. **Encher a fila.** Com `CAPACIDADE_FILA=3`, abra quatro ordens de serviço no
   OS Service e aprove todas: a quarta recebe `EXECUCAO_FALHOU` e a Saga
   compensa (pagamento estornado, orçamento cancelado).
2. **Gatilho controlado.** `POST /ordens-servico` com
   `"simularFalhaExecucao": true` no OS Service faz este serviço recusar o
   enfileiramento com o código `execucao.falha.simulada`.

Depois, nas rotas de evidência: `GET /execucoes?status=CANCELADA` mostra o
motivo registrado, e `GET /execucoes/fila` mostra a vaga devolvida.

---

## CI/CD e Kubernetes

Pipeline **independente** deste repositório (`.github/workflows/`):

**`ci.yml`** — *status check* obrigatório da branch protegida `main`: typecheck,
build, `test:coverage` com gate de 80%, `test:bdd`, renderização dos overlays
do Kustomize, build da imagem e job de **SonarQube com Quality Gate**.

**`deploy.yml`** — merge em `develop` → homologação (`fiap-hml`); merge em
`main` → produção (`fiap-prd`). A imagem vai para o **Amazon ECR** com a tag do
SHA, o Secret é montado a partir do **AWS Systems Manager Parameter Store** e o
job aguarda o `rollout status` no **EKS**.

```
k8s/base/            configmap, deployment, service, hpa
k8s/overlays/hml/    namespace fiap-hml, 1 réplica, LOG_LEVEL=debug
k8s/overlays/prd/    namespace fiap-prd, 2 réplicas, HPA 2–10
```

```bash
npm run k8s:render:hml
npm run k8s:render:prd
```

Este serviço **não tem** `initContainer` de migrations: os índices do MongoDB
são criados no bootstrap da aplicação.

---

## Observabilidade

- **New Relic APM** com *distributed tracing*: o `correlationId` que entra pela
  fila é o mesmo da requisição HTTP que originou a Saga no OS Service.
- **Eventos de negócio**: `SagaComandoRecebido`, `ExecucaoEnfileirada`,
  `ExecucaoFinalizada` (com o desvio entre prazo estimado e real),
  `ExecucaoCancelada`, `IntegracaoFalha`.
- **Logs estruturados** (pino) com `correlationId` e `sagaId`.
- Sem `NEW_RELIC_LICENSE_KEY` o agente não é carregado e a telemetria cai para
  log.

O alerta que mais importa: `ExecucaoCancelada` com `compensado: false` — a
compensação impossível, que exige intervenção humana.

---

## Documentação da API

- **Swagger UI**: `/api-docs`
- **OpenAPI (JSON)**: `/api-docs.json`
- **Postman**: [`postman/fiap-tc-ms-execucao.postman_collection.json`](postman/)

---

## Variáveis de ambiente

Ver [`.env.example`](.env.example). As sensíveis (`MONGO_URI`, `RABBITMQ_URL`,
licença do New Relic, IDs do Cognito) vêm do Secret do Kubernetes em homologação
e produção — nunca de arquivo versionado.
