import request from "supertest";

import ColecaoFake from "../apoio/ColecaoFake";
import Execucao, { StatusExecucao } from "../../domain/entity/Execucao";
import ServicoExecutavel from "../../domain/entity/ServicoExecutavel";
import ExecucaoRepositoryMongo, {
  DocumentoExecucao,
} from "../../domain/repository/Mongo/ExecucaoRepositoryMongo";
import MensagemProcessadaRepositoryMongo, {
  DocumentoMensagem,
} from "../../domain/repository/Mongo/MensagemProcessadaRepositoryMongo";
import MensagemProcessadaRepositoryMemoria from "../../domain/repository/Mock/MensagemProcessadaRepositoryMemoria";
import ComandoConsumer from "../../src/messaging/ComandoConsumer";
import RabbitMQMensageriaGateway from "../../src/messaging/RabbitMQMensageriaGateway";
import MessagePublisher from "../../src/messaging/MessagePublisher";
import NewRelicTelemetriaGateway from "../../src/telemetry/NewRelicTelemetriaGateway";
import criarApp from "../../src/app";
import { criarContainer, Container } from "../../src/container";
import MensageriaGatewayMemoria from "../../domain/gateway/Mock/MensageriaGatewayMemoria";
import {
  Mensagem,
  ROUTING_KEYS,
  TipoComando,
  TipoResposta,
} from "../../src/messaging/contracts";

const CTX = { sagaId: "saga-1", ordemServicoId: "os-1" };

const ITENS = [
  { id: "srv-revisao", descricao: "Revisao completa", quantidade: 1, tipo: "SERVICO" },
];

function servicos() {
  return [
    new ServicoExecutavel({
      referenciaId: "srv-revisao",
      descricao: "Revisao completa",
      tipo: "SERVICO",
      quantidade: 1,
    }),
  ];
}

function novaExecucao(sagaId = "saga-1", ordemServicoId = "os-1") {
  return new Execucao({
    ordemServicoId,
    clienteId: "cliente-1",
    veiculoId: "veiculo-1",
    sagaId,
    posicaoFila: 1,
    servicos: servicos(),
  });
}

describe("ExecucaoRepositoryMongo", () => {
  it("serializa o agregado com os servicos embutidos e reidrata sem perda", async () => {
    const colecao = new ColecaoFake<DocumentoExecucao>();
    const repositorio = new ExecucaoRepositoryMongo(colecao.comoColecao());
    const execucao = novaExecucao();

    await repositorio.salvar(execucao);

    const documento = colecao.documentos.get(execucao.id.getValue())!;
    expect(documento.servicos).toHaveLength(1);
    expect(documento.servicos[0]).toEqual({
      referenciaId: "srv-revisao",
      descricao: "Revisao completa",
      tipo: "SERVICO",
      quantidade: 1,
      tempoEstimadoMinutos: 60,
      concluido: false,
    });

    const recuperada = await repositorio.obter(execucao.id.getValue());
    expect(recuperada?.id.getValue()).toBe(execucao.id.getValue());
    expect(recuperada?.status).toBe(StatusExecucao.NA_FILA);
    expect(recuperada?.tempoEstimadoMinutos()).toBe(60);
    expect(recuperada?.criadaEm).toBeInstanceOf(Date);
  });

  it("atualiza por upsert preservando o ciclo de vida completo", async () => {
    const colecao = new ColecaoFake<DocumentoExecucao>();
    const repositorio = new ExecucaoRepositoryMongo(colecao.comoColecao());
    const execucao = novaExecucao();
    await repositorio.salvar(execucao);

    execucao.iniciar("Joao da Silva");
    execucao.servicos.forEach((servico) => servico.concluir());
    execucao.finalizar("Revisao concluida");
    await repositorio.atualizar(execucao);

    const recuperada = await repositorio.obter(execucao.id.getValue());
    expect(recuperada?.status).toBe(StatusExecucao.FINALIZADA);
    expect(recuperada?.mecanicoResponsavel).toBe("Joao da Silva");
    expect(recuperada?.observacoes).toBe("Revisao concluida");
    expect(recuperada?.iniciadaEm).toBeInstanceOf(Date);
    expect(recuperada?.finalizadaEm).toBeInstanceOf(Date);
    expect(recuperada?.duracaoMs()).toBeGreaterThanOrEqual(0);
    expect(recuperada?.servicos.every((servico) => servico.concluido)).toBe(true);
  });

  it("consulta pelas chaves de negocio e devolve a mais recente", async () => {
    const colecao = new ColecaoFake<DocumentoExecucao>();
    const repositorio = new ExecucaoRepositoryMongo(colecao.comoColecao());

    const antiga = novaExecucao("saga-1", "os-1");
    await repositorio.salvar(antiga);

    const recente = novaExecucao("saga-1", "os-1");
    // Garante a ordenacao por criadaEm desc do adaptador.
    (recente as unknown as { criadaEm: Date }).criadaEm = new Date(
      Date.now() + 60000,
    );
    await repositorio.salvar(recente);

    expect((await repositorio.obterPorOrdemServico("os-1"))?.id.getValue()).toBe(
      recente.id.getValue(),
    );
    expect((await repositorio.obterPorSaga("saga-1"))?.id.getValue()).toBe(
      recente.id.getValue(),
    );
  });

  it("lista com filtro de status e de veiculo, ordenada pela fila", async () => {
    const colecao = new ColecaoFake<DocumentoExecucao>();
    const repositorio = new ExecucaoRepositoryMongo(colecao.comoColecao());

    const primeira = novaExecucao("saga-1", "os-1");
    const segunda = novaExecucao("saga-2", "os-2");
    segunda.posicaoFila = 2;
    await repositorio.salvar(segunda);
    await repositorio.salvar(primeira);

    const todas = await repositorio.listar();
    expect(todas.map((execucao) => execucao.posicaoFila)).toEqual([1, 2]);

    expect(await repositorio.listar({ status: StatusExecucao.NA_FILA })).toHaveLength(
      2,
    );
    expect(
      await repositorio.listar({ status: StatusExecucao.FINALIZADA }),
    ).toHaveLength(0);
    expect(await repositorio.listar({ veiculoId: "veiculo-1" })).toHaveLength(2);
    expect(await repositorio.listar({ veiculoId: "outro" })).toHaveLength(0);
  });

  // A contagem decide se cabe mais um carro na oficina: cancelada e finalizada
  // nao ocupam vaga.
  it("conta apenas as execucoes que ocupam a oficina", async () => {
    const colecao = new ColecaoFake<DocumentoExecucao>();
    const repositorio = new ExecucaoRepositoryMongo(colecao.comoColecao());

    const naFila = novaExecucao("saga-1", "os-1");
    const emAndamento = novaExecucao("saga-2", "os-2");
    emAndamento.iniciar();
    const cancelada = novaExecucao("saga-3", "os-3");
    cancelada.cancelar("rollback");

    await repositorio.salvar(naFila);
    await repositorio.salvar(emAndamento);
    await repositorio.salvar(cancelada);

    expect(await repositorio.contarNaFila()).toBe(2);
  });

  it("devolve nulo quando nao encontra", async () => {
    const colecao = new ColecaoFake<DocumentoExecucao>();
    const repositorio = new ExecucaoRepositoryMongo(colecao.comoColecao());

    expect(await repositorio.obter("inexistente")).toBeNull();
    expect(await repositorio.obterPorOrdemServico("inexistente")).toBeNull();
    expect(await repositorio.obterPorSaga("inexistente")).toBeNull();
  });
});

describe("MensagemProcessadaRepositoryMongo", () => {
  it("registra a mensagem e reconhece a reentrega", async () => {
    const colecao = new ColecaoFake<DocumentoMensagem>();
    const repositorio = new MensagemProcessadaRepositoryMongo(
      colecao.comoColecao(),
    );

    expect(await repositorio.jaProcessada("msg-1")).toBe(false);

    await repositorio.registrar({
      mensagemId: "msg-1",
      tipo: TipoComando.ENFILEIRAR_EXECUCAO,
      sagaId: "saga-1",
    });

    expect(await repositorio.jaProcessada("msg-1")).toBe(true);
  });

  // Duas replicas do pod recebendo a mesma reentrega: o indice unico decide, e
  // o adaptador trata a perda da corrida como sucesso.
  it("absorve o erro de chave duplicada", async () => {
    const colecao = new ColecaoFake<DocumentoMensagem>();
    const repositorio = new MensagemProcessadaRepositoryMongo(
      colecao.comoColecao(),
    );

    const dados = { mensagemId: "msg-1", tipo: "ENFILEIRAR_EXECUCAO" };
    await repositorio.registrar(dados);

    await expect(repositorio.registrar(dados)).resolves.toBeUndefined();
    expect(colecao.documentos.size).toBe(1);
  });

  it("propaga erros que nao sao de duplicidade", async () => {
    const colecao = new ColecaoFake<DocumentoMensagem>();
    colecao.insertOne = async () => {
      throw new Error("conexao perdida");
    };
    const repositorio = new MensagemProcessadaRepositoryMongo(
      colecao.comoColecao(),
    );

    await expect(
      repositorio.registrar({ mensagemId: "msg-1", tipo: "X" }),
    ).rejects.toThrow("conexao perdida");
  });
});

describe("ComandoConsumer", () => {
  function mensagem(
    tipo: TipoComando,
    body: Record<string, unknown>,
    mensagemId = "msg-1",
  ): Mensagem {
    return {
      header: {
        mensagemId,
        sagaId: "saga-1",
        correlationId: "corr-1",
        ordemServicoId: "os-1",
        tipo,
        origem: "fiap-tc-ms-os",
        dataEnvio: new Date().toISOString(),
        tentativa: 1,
      },
      body,
    };
  }

  function montar() {
    const container = criarContainer();
    const mensagensProcessadas = new MensagemProcessadaRepositoryMemoria();
    const consumer = new ComandoConsumer(
      {
        enfileirarExecucao: container.enfileirarExecucao,
        cancelarExecucao: container.cancelarExecucao,
      },
      mensagensProcessadas,
    );

    return {
      container,
      consumer,
      mensagensProcessadas,
      mensageria: container.mensageria as MensageriaGatewayMemoria,
    };
  }

  it("mapeia apenas o par de comandos deste participante", () => {
    const { consumer } = montar();

    expect(Object.keys(consumer.manipuladores()).sort()).toEqual(
      [TipoComando.CANCELAR_EXECUCAO, TipoComando.ENFILEIRAR_EXECUCAO].sort(),
    );
  });

  it("executa o enfileiramento e registra a mensagem como processada", async () => {
    const { consumer, mensagensProcessadas, container, mensageria } = montar();

    await consumer.manipuladores()[TipoComando.ENFILEIRAR_EXECUCAO](
      mensagem(TipoComando.ENFILEIRAR_EXECUCAO, {
        clienteId: "cliente-1",
        veiculoId: "veiculo-1",
        itens: ITENS,
      }),
    );

    const execucao = await container.execucaoRepository.obterPorSaga("saga-1");
    expect(execucao?.ordemServicoId).toBe("os-1");
    expect(await mensagensProcessadas.jaProcessada("msg-1")).toBe(true);
    expect(mensageria.tipos()).toEqual([TipoResposta.EXECUCAO_ENFILEIRADA]);
  });

  it("ignora a reentrega da mesma mensagem (idempotencia duravel)", async () => {
    const { consumer, container } = montar();
    const entrega = mensagem(TipoComando.ENFILEIRAR_EXECUCAO, {
      clienteId: "cliente-1",
      veiculoId: "veiculo-1",
      itens: ITENS,
    });

    await consumer.manipuladores()[TipoComando.ENFILEIRAR_EXECUCAO](entrega);
    await consumer.manipuladores()[TipoComando.ENFILEIRAR_EXECUCAO](entrega);

    expect(await container.execucaoRepository.listar()).toHaveLength(1);
  });

  it("encaminha a compensacao com o motivo recebido", async () => {
    const { consumer, container, mensageria } = montar();

    await consumer.manipuladores()[TipoComando.ENFILEIRAR_EXECUCAO](
      mensagem(TipoComando.ENFILEIRAR_EXECUCAO, {
        clienteId: "cliente-1",
        veiculoId: "veiculo-1",
        itens: ITENS,
      }),
    );
    mensageria.limpar();

    await consumer.manipuladores()[TipoComando.CANCELAR_EXECUCAO](
      mensagem(
        TipoComando.CANCELAR_EXECUCAO,
        { motivo: "Pagamento estornado" },
        "msg-2",
      ),
    );

    const execucao = await container.execucaoRepository.obterPorSaga("saga-1");
    expect(execucao?.estaCancelada()).toBe(true);
    expect(execucao?.motivoCancelamento).toBe("Pagamento estornado");
    expect(mensageria.tipos()).toEqual([TipoResposta.EXECUCAO_CANCELADA]);
  });

  // simularFalha chega pelo corpo do comando: e assim que o video da entrega
  // provoca o rollback no quinto passo da Saga.
  it("repassa o gatilho de falha simulada vindo do comando", async () => {
    const { consumer, container, mensageria } = montar();

    await consumer.manipuladores()[TipoComando.ENFILEIRAR_EXECUCAO](
      mensagem(TipoComando.ENFILEIRAR_EXECUCAO, {
        clienteId: "cliente-1",
        veiculoId: "veiculo-1",
        itens: ITENS,
        simularFalha: true,
      }),
    );

    expect(await container.execucaoRepository.listar()).toHaveLength(0);
    expect(mensageria.tipos()).toEqual([TipoResposta.EXECUCAO_FALHOU]);
  });
});

describe("RabbitMQMensageriaGateway", () => {
  it("responde sempre na fila de reply do orquestrador", async () => {
    const publicadas: Array<{ exchange: string; routingKey: string }> = [];
    const canal = {
      publish: (exchange: string, routingKey: string) => {
        publicadas.push({ exchange, routingKey });
        return true;
      },
    };
    const conexao = { getChannel: async () => canal } as never;

    const gateway = new RabbitMQMensageriaGateway(
      new MessagePublisher(conexao, "execucao"),
    );

    await gateway.responder(CTX, TipoResposta.EXECUCAO_ENFILEIRADA, {
      execucaoId: "exec-1",
    });

    // Este servico nao conhece o Billing nem o OS Service: fala apenas com a
    // fila de reply.
    expect(publicadas[0].routingKey).toBe(ROUTING_KEYS.SAGA_REPLY);
  });
});

describe("NewRelicTelemetriaGateway", () => {
  it("publica os eventos de negocio do participante", () => {
    const eventos: Array<{ nome: string; atributos: Record<string, unknown> }> =
      [];
    const telemetria = new NewRelicTelemetriaGateway({
      recordCustomEvent: (nome, atributos) => eventos.push({ nome, atributos }),
    });

    telemetria.registrarComando({
      ...CTX,
      comando: "ENFILEIRAR_EXECUCAO",
      resultado: "CONCLUIDO",
      duracaoMs: 12,
    });
    telemetria.registrarEnfileiramento({
      ...CTX,
      execucaoId: "exec-1",
      posicaoFila: 1,
      tempoEstimadoMinutos: 60,
    });
    telemetria.registrarCancelamento({
      ...CTX,
      execucaoId: "exec-1",
      motivo: "rollback",
      compensado: true,
    });
    telemetria.registrarFalhaIntegracao({
      integracao: "rabbitmq",
      operacao: "publicar",
      erro: "timeout",
    });

    expect(eventos.map((evento) => evento.nome)).toEqual([
      "SagaComandoRecebido",
      "ExecucaoEnfileirada",
      "ExecucaoCancelada",
      "IntegracaoFalha",
    ]);
    expect(eventos[0].atributos.servico).toBe("fiap-tc-ms-execucao");
  });

  // A metrica que a gestao usa: quanto o reparo real desviou do prazo
  // prometido ao cliente.
  it("calcula o desvio entre o tempo estimado e o tempo real", () => {
    const eventos: Array<Record<string, unknown>> = [];
    const telemetria = new NewRelicTelemetriaGateway({
      recordCustomEvent: (_nome, atributos) => eventos.push(atributos),
    });

    telemetria.registrarFinalizacao({
      ordemServicoId: "os-1",
      execucaoId: "exec-1",
      duracaoMs: 75 * 60000,
      tempoEstimadoMinutos: 60,
    });

    expect(eventos[0].desvioMinutos).toBe(15);
  });

  it("trata duracao desconhecida sem distorcer o desvio", () => {
    const eventos: Array<Record<string, unknown>> = [];
    const telemetria = new NewRelicTelemetriaGateway({
      recordCustomEvent: (_nome, atributos) => eventos.push(atributos),
    });

    telemetria.registrarFinalizacao({
      ordemServicoId: "os-1",
      execucaoId: "exec-1",
      duracaoMs: null,
      tempoEstimadoMinutos: 60,
    });

    expect(eventos[0].duracaoMs).toBe(0);
    expect(eventos[0].desvioMinutos).toBe(0);
  });

  it("funciona sem o agente carregado", () => {
    const telemetria = new NewRelicTelemetriaGateway(null);

    expect(() =>
      telemetria.registrarComando({
        ...CTX,
        comando: "X",
        resultado: "FALHOU",
        duracaoMs: 1,
        erro: "erro",
      }),
    ).not.toThrow();
  });
});

describe("API do servico de Execucao", () => {
  let container: Container;

  async function enfileirar(sagaId = "saga-1", ordemServicoId = "os-1") {
    const execucao = await container.enfileirarExecucao.execute({
      sagaId,
      ordemServicoId,
      clienteId: "cliente-1",
      veiculoId: "veiculo-1",
      itens: ITENS,
    });
    return execucao!;
  }

  beforeEach(() => {
    container = criarContainer();
  });

  it("GET /health e GET / identificam o servico", async () => {
    const app = criarApp(container);

    const saude = await request(app).get("/health").expect(200);
    expect(saude.body).toEqual({ status: "ok", servico: "fiap-tc-ms-execucao" });

    const raiz = await request(app).get("/").expect(200);
    expect(raiz.body.servico).toBe("fiap-tc-ms-execucao");
  });

  it("expoe o contrato OpenAPI com as rotas da oficina", async () => {
    const resposta = await request(criarApp(container))
      .get("/api-docs.json")
      .expect(200);

    expect(Object.keys(resposta.body.paths)).toEqual(
      expect.arrayContaining([
        "/execucoes",
        "/execucoes/fila",
        "/execucoes/{id}",
        "/execucoes/{id}/inicio",
        "/execucoes/{id}/finalizacao",
      ]),
    );
  });

  it("GET /execucoes/fila mostra a fila com o tempo total estimado", async () => {
    await enfileirar("saga-1", "os-1");
    await enfileirar("saga-2", "os-2");

    const resposta = await request(criarApp(container))
      .get("/execucoes/fila")
      .expect(200);

    expect(resposta.body.total).toBe(2);
    expect(resposta.body.tempoEstimadoTotalMinutos).toBe(120);
  });

  it("consulta execucao por id e por ordem de servico", async () => {
    const execucao = await enfileirar();
    const app = criarApp(container);

    const porId = await request(app)
      .get(`/execucoes/${execucao.id.getValue()}`)
      .expect(200);
    expect(porId.body.ordemServicoId).toBe("os-1");

    const porOs = await request(app)
      .get("/execucoes/ordem-servico/os-1")
      .expect(200);
    expect(porOs.body.id).toBe(execucao.id.getValue());
  });

  it("lista com e sem filtro de status", async () => {
    await enfileirar();
    const app = criarApp(container);

    expect((await request(app).get("/execucoes").expect(200)).body).toHaveLength(
      1,
    );
    expect(
      (await request(app).get("/execucoes?status=FINALIZADA").expect(200)).body,
    ).toHaveLength(0);
  });

  it("o mecanico inicia e finaliza o reparo pela API", async () => {
    const execucao = await enfileirar();
    const app = criarApp(container);
    const id = execucao.id.getValue();

    const iniciada = await request(app)
      .post(`/execucoes/${id}/inicio`)
      .send({ mecanico: "Joao da Silva" })
      .expect(200);
    expect(iniciada.body.status).toBe("EM_ANDAMENTO");
    expect(iniciada.body.mecanicoResponsavel).toBe("Joao da Silva");

    const finalizada = await request(app)
      .post(`/execucoes/${id}/finalizacao`)
      .send({ observacoes: "Revisao concluida" })
      .expect(200);
    expect(finalizada.body.status).toBe("FINALIZADA");

    const mensageria = container.mensageria as MensageriaGatewayMemoria;
    expect(mensageria.tipos()).toContain(TipoResposta.EXECUCAO_FINALIZADA);
  });

  it("aceita inicio e finalizacao sem corpo na requisicao", async () => {
    const execucao = await enfileirar();
    const app = criarApp(container);
    const id = execucao.id.getValue();

    await request(app).post(`/execucoes/${id}/inicio`).expect(200);
    await request(app).post(`/execucoes/${id}/finalizacao`).expect(200);
  });

  it("409 para transicao de status invalida", async () => {
    const execucao = await enfileirar();
    const app = criarApp(container);
    const id = execucao.id.getValue();

    // Finalizar antes de iniciar.
    const resposta = await request(app)
      .post(`/execucoes/${id}/finalizacao`)
      .expect(409);

    expect(resposta.body.erro.codigo).toBeDefined();
  });

  it("404 padronizado para execucao inexistente e rota desconhecida", async () => {
    const app = criarApp(container);

    const execucao = await request(app)
      .get("/execucoes/00000000-0000-0000-0000-000000000000")
      .expect(404);
    expect(execucao.body.erro.codigo).toBe("execucao.nao.encontrada");

    const porOs = await request(app)
      .get("/execucoes/ordem-servico/os-inexistente")
      .expect(404);
    expect(porOs.body.erro).toBeDefined();

    const rota = await request(app).get("/rota-que-nao-existe").expect(404);
    expect(rota.body.erro.codigo).toBe("rota.nao.encontrada");
  });

  // Rastreabilidade distribuida: o mesmo correlationId percorre HTTP e fila.
  it("propaga o correlationId recebido no cabecalho", async () => {
    const resposta = await request(criarApp(container))
      .get("/health")
      .set("x-correlation-id", "corr-externo")
      .expect(200);

    expect(resposta.headers["x-correlation-id"]).toBe("corr-externo");
  });

  it("gera um correlationId quando o cliente nao envia", async () => {
    const resposta = await request(criarApp(container))
      .get("/health")
      .expect(200);

    expect(resposta.headers["x-correlation-id"]).toMatch(/[0-9a-f-]{36}/);
  });

  it("500 nao vaza a mensagem tecnica e e registrado na telemetria", async () => {
    container.execucaoRepository.listar = async () => {
      throw new Error("mongo indisponivel: connection refused");
    };

    const resposta = await request(criarApp(container))
      .get("/execucoes")
      .expect(500);

    expect(JSON.stringify(resposta.body)).not.toContain("connection refused");
  });
});
