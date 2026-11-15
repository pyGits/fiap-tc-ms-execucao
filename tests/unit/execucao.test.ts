import Execucao, { StatusExecucao } from "../../domain/entity/Execucao";
import ServicoExecutavel from "../../domain/entity/ServicoExecutavel";
import ErroDominio from "../../domain/ErroDominio";
import MensageriaGatewayMemoria from "../../domain/gateway/Mock/MensageriaGatewayMemoria";
import TelemetriaGatewayMemoria from "../../domain/gateway/Mock/TelemetriaGatewayMemoria";
import { criarContainer, Container } from "../../src/container";
import { TipoResposta } from "../../src/messaging/contracts";

const CTX = { sagaId: "saga-1", ordemServicoId: "os-1" };

const ITENS = [
  { id: "srv-revisao", descricao: "Revisao completa", quantidade: 1, tipo: "SERVICO" },
  { id: "pec-filtro-oleo", descricao: "Filtro de oleo", quantidade: 2, tipo: "PECA" },
];

type Cenario = {
  container: Container;
  mensageria: MensageriaGatewayMemoria;
  telemetria: TelemetriaGatewayMemoria;
};

function montar(): Cenario {
  const container = criarContainer();
  return {
    container,
    mensageria: container.mensageria as MensageriaGatewayMemoria,
    telemetria: container.telemetria as TelemetriaGatewayMemoria,
  };
}

async function enfileirar(cenario: Cenario, sagaId = "saga-1", osId = "os-1") {
  return cenario.container.enfileirarExecucao.execute({
    sagaId,
    ordemServicoId: osId,
    clienteId: "cliente-1",
    veiculoId: "veiculo-1",
    itens: ITENS,
  });
}

describe("ServicoExecutavel", () => {
  it("estima o tempo por tipo de item", () => {
    const servico = new ServicoExecutavel({
      referenciaId: "srv-revisao",
      descricao: "Revisao",
      tipo: "SERVICO",
      quantidade: 1,
    });
    const peca = new ServicoExecutavel({
      referenciaId: "pec-1",
      descricao: "Filtro",
      tipo: "peca",
      quantidade: 2,
    });
    const desconhecido = new ServicoExecutavel({
      referenciaId: "x",
      descricao: "Item",
      tipo: "OUTRO",
      quantidade: 1,
    });

    expect(servico.tempoEstimadoMinutos).toBe(60);
    // 15 minutos por peca x 2 unidades.
    expect(peca.tempoEstimadoMinutos).toBe(30);
    expect(desconhecido.tempoEstimadoMinutos).toBe(30);
  });

  it("aceita tempo estimado explicito e marca conclusao", () => {
    const servico = new ServicoExecutavel({
      referenciaId: "x",
      descricao: "Item",
      tipo: "SERVICO",
      quantidade: 1,
      tempoEstimadoMinutos: 15,
    });

    expect(servico.tempoEstimadoMinutos).toBe(15);
    expect(servico.concluido).toBe(false);

    servico.concluir();
    expect(servico.concluido).toBe(true);
  });

  it.each([
    ["descricao vazia", { descricao: "  ", quantidade: 1 }],
    ["quantidade zero", { descricao: "Item", quantidade: 0 }],
  ])("rejeita %s", (_caso, dados) => {
    expect(
      () =>
        new ServicoExecutavel({
          referenciaId: "x",
          tipo: "SERVICO",
          ...dados,
        }),
    ).toThrow(ErroDominio);
  });
});

describe("Execucao", () => {
  function nova() {
    return new Execucao({
      ordemServicoId: "os-1",
      clienteId: "cliente-1",
      veiculoId: "veiculo-1",
      sagaId: "saga-1",
      posicaoFila: 1,
      servicos: [
        new ServicoExecutavel({
          referenciaId: "srv-revisao",
          descricao: "Revisao",
          tipo: "SERVICO",
          quantidade: 1,
        }),
      ],
    });
  }

  it("nasce NA_FILA e soma o tempo estimado dos servicos", () => {
    const execucao = nova();

    expect(execucao.status).toBe(StatusExecucao.NA_FILA);
    expect(execucao.tempoEstimadoMinutos()).toBe(60);
    expect(execucao.duracaoMs()).toBeNull();
  });

  it("exige ordem de servico e ao menos um servico", () => {
    expect(
      () =>
        new Execucao({
          ordemServicoId: "",
          clienteId: "c",
          veiculoId: "v",
          sagaId: "s",
          servicos: [],
        }),
    ).toThrow(ErroDominio);

    expect(
      () =>
        new Execucao({
          ordemServicoId: "os-1",
          clienteId: "c",
          veiculoId: "v",
          sagaId: "s",
          servicos: [],
        }),
    ).toThrow(ErroDominio);
  });

  it("percorre o ciclo de vida da oficina", () => {
    const execucao = nova();

    execucao.iniciar("Joao da Silva");
    expect(execucao.status).toBe(StatusExecucao.EM_ANDAMENTO);
    expect(execucao.mecanicoResponsavel).toBe("Joao da Silva");

    execucao.finalizar("Troca concluida");
    expect(execucao.estaFinalizada()).toBe(true);
    expect(execucao.observacoes).toBe("Troca concluida");
    expect(execucao.duracaoMs()).toBeGreaterThanOrEqual(0);
  });

  it("recusa transicoes invalidas", () => {
    const execucao = nova();

    // Nao se finaliza o que nao comecou.
    expect(() => execucao.finalizar()).toThrow(ErroDominio);

    execucao.iniciar();
    execucao.finalizar();
    expect(() => execucao.iniciar()).toThrow(ErroDominio);
  });

  it("cancela enquanto esta na fila ou em andamento", () => {
    const naFila = nova();
    expect(naFila.cancelar("rollback")).toBe(true);
    expect(naFila.estaCancelada()).toBe(true);

    const emAndamento = nova();
    emAndamento.iniciar();
    expect(emAndamento.cancelar("rollback")).toBe(true);
  });

  it("cancelar e idempotente", () => {
    const execucao = nova();

    execucao.cancelar("primeiro motivo");
    execucao.cancelar("segundo motivo");

    expect(execucao.motivoCancelamento).toBe("primeiro motivo");
  });

  // Limite pratico da compensacao: um reparo concluido nao se desfaz.
  it("nao cancela uma execucao ja finalizada", () => {
    const execucao = nova();
    execucao.iniciar();
    execucao.finalizar();

    expect(execucao.cancelar("tarde demais")).toBe(false);
    expect(execucao.status).toBe(StatusExecucao.FINALIZADA);
  });
});

describe("EnfileirarExecucaoUseCase (passo 5 da Saga)", () => {
  it("aceita o servico, define a posicao na fila e responde a Saga", async () => {
    const cenario = montar();

    const execucao = await enfileirar(cenario);

    expect(execucao?.posicaoFila).toBe(1);
    // 60 minutos do servico + 30 minutos das duas pecas.
    expect(execucao?.tempoEstimadoMinutos()).toBe(90);
    expect(cenario.mensageria.tipos()).toEqual([
      TipoResposta.EXECUCAO_ENFILEIRADA,
    ]);
    expect(cenario.mensageria.ultima()?.body).toEqual({
      execucaoId: execucao?.id.getValue(),
      posicaoFila: 1,
    });
    expect(cenario.telemetria.enfileiramentos).toHaveLength(1);
  });

  it("incrementa a posicao conforme a fila cresce", async () => {
    const cenario = montar();

    await enfileirar(cenario, "saga-1", "os-1");
    const segunda = await enfileirar(cenario, "saga-2", "os-2");

    expect(segunda?.posicaoFila).toBe(2);
  });

  it("e idempotente por Saga", async () => {
    const cenario = montar();

    const primeira = await enfileirar(cenario);
    const segunda = await enfileirar(cenario);

    expect(segunda?.id.getValue()).toBe(primeira?.id.getValue());
    expect(await cenario.container.execucaoRepository.listar()).toHaveLength(1);
  });

  it("responde EXECUCAO_FALHOU quando a fila esta cheia", async () => {
    const capacidadeOriginal = process.env.CAPACIDADE_FILA;
    process.env.CAPACIDADE_FILA = "1";

    // O caso de uso le a capacidade no momento do import do modulo.
    jest.resetModules();
    const { default: EnfileirarExecucaoUseCase } = await import(
      "../../domain/usecase/Execucao/EnfileirarExecucaoUseCase"
    );

    const cenario = montar();
    const caso = new EnfileirarExecucaoUseCase(
      cenario.container.execucaoRepository,
      cenario.container.mensageria,
      cenario.container.telemetria,
    );

    await caso.execute({
      sagaId: "saga-1",
      ordemServicoId: "os-1",
      clienteId: "c",
      veiculoId: "v",
      itens: ITENS,
    });

    const resultado = await caso.execute({
      sagaId: "saga-2",
      ordemServicoId: "os-2",
      clienteId: "c",
      veiculoId: "v",
      itens: ITENS,
    });

    expect(resultado).toBeNull();
    expect(cenario.mensageria.tipos()).toContain(TipoResposta.EXECUCAO_FALHOU);
    expect(String(cenario.mensageria.ultima()?.body.motivo)).toContain(
      "Fila da oficina cheia",
    );

    if (capacidadeOriginal === undefined) delete process.env.CAPACIDADE_FILA;
    else process.env.CAPACIDADE_FILA = capacidadeOriginal;
  });

  it("responde EXECUCAO_FALHOU quando os itens sao invalidos", async () => {
    const cenario = montar();

    const resultado = await cenario.container.enfileirarExecucao.execute({
      ...CTX,
      clienteId: "c",
      veiculoId: "v",
      itens: [{ ...ITENS[0], quantidade: 0 }],
    });

    expect(resultado).toBeNull();
    expect(cenario.mensageria.tipos()).toEqual([TipoResposta.EXECUCAO_FALHOU]);
  });

  // Gatilho da demonstracao de rollback exigida na Fase 4.
  it("simularFalha forca a recusa controlada do enfileiramento", async () => {
    const cenario = montar();

    const resultado = await cenario.container.enfileirarExecucao.execute({
      ...CTX,
      clienteId: "c",
      veiculoId: "v",
      itens: ITENS,
      simularFalha: true,
    });

    expect(resultado).toBeNull();
    expect(cenario.mensageria.ultima()?.body.codigo).toBe(
      "execucao.falha.simulada",
    );
    expect(await cenario.container.execucaoRepository.listar()).toHaveLength(0);
  });

  it("enfileira de novo quando a execucao anterior foi cancelada", async () => {
    const cenario = montar();
    const primeira = await enfileirar(cenario);

    await cenario.container.cancelarExecucao.execute({
      ...CTX,
      motivo: "rollback anterior",
    });

    const segunda = await enfileirar(cenario);
    expect(segunda?.id.getValue()).not.toBe(primeira?.id.getValue());
  });
});

describe("CancelarExecucaoUseCase (compensacao)", () => {
  it("cancela a execucao e confirma a compensacao", async () => {
    const cenario = montar();
    const execucao = await enfileirar(cenario);
    cenario.mensageria.limpar();

    await cenario.container.cancelarExecucao.execute({
      ...CTX,
      motivo: "Pagamento estornado",
    });

    const atualizada = await cenario.container.execucaoRepository.obter(
      execucao!.id.getValue(),
    );
    expect(atualizada?.estaCancelada()).toBe(true);
    expect(cenario.mensageria.ultima()?.tipo).toBe(
      TipoResposta.EXECUCAO_CANCELADA,
    );
    expect(cenario.mensageria.ultima()?.body.compensado).toBe(true);
  });

  it("responde sem erro quando nao existe execucao a cancelar", async () => {
    const cenario = montar();

    await cenario.container.cancelarExecucao.execute({
      ...CTX,
      motivo: "nada a desfazer",
    });

    expect(cenario.mensageria.ultima()?.tipo).toBe(
      TipoResposta.EXECUCAO_CANCELADA,
    );
    expect(cenario.mensageria.ultima()?.body.compensado).toBe(true);
  });

  // O reparo ja foi feito: a compensacao e impossivel e o caso vira pendencia
  // manual - mas a Saga precisa sair de COMPENSANDO de todo jeito.
  it("sinaliza compensado=false quando o reparo ja foi concluido", async () => {
    const cenario = montar();
    const execucao = await enfileirar(cenario);
    await cenario.container.operarExecucao.iniciar(execucao!.id.getValue());
    await cenario.container.operarExecucao.finalizar(execucao!.id.getValue());
    cenario.mensageria.limpar();

    await cenario.container.cancelarExecucao.execute({
      ...CTX,
      motivo: "Rollback tardio",
    });

    expect(cenario.mensageria.ultima()?.body.compensado).toBe(false);
    expect(cenario.telemetria.cancelamentos[0].compensado).toBe(false);

    const atualizada = await cenario.container.execucaoRepository.obter(
      execucao!.id.getValue(),
    );
    expect(atualizada?.status).toBe(StatusExecucao.FINALIZADA);
  });
});

describe("OperarExecucaoUseCase", () => {
  it("inicia, finaliza e publica o evento EXECUCAO_FINALIZADA", async () => {
    const cenario = montar();
    const execucao = await enfileirar(cenario);
    cenario.mensageria.limpar();

    const iniciada = await cenario.container.operarExecucao.iniciar(
      execucao!.id.getValue(),
      "Joao da Silva",
    );
    expect(iniciada.status).toBe(StatusExecucao.EM_ANDAMENTO);
    expect(iniciada.mecanicoResponsavel).toBe("Joao da Silva");

    const finalizada = await cenario.container.operarExecucao.finalizar(
      execucao!.id.getValue(),
      "Revisao concluida",
    );

    expect(finalizada.status).toBe(StatusExecucao.FINALIZADA);
    expect(finalizada.servicos.every((servico) => servico.concluido)).toBe(true);
    // Evento, nao comando: este servico nao sabe quem vai reagir.
    expect(cenario.mensageria.ultima()?.tipo).toBe(
      TipoResposta.EXECUCAO_FINALIZADA,
    );
    expect(cenario.telemetria.finalizacoes).toHaveLength(1);
  });

  it("consulta por id e por ordem de servico", async () => {
    const cenario = montar();
    const execucao = await enfileirar(cenario);

    expect(
      (await cenario.container.operarExecucao.obter(execucao!.id.getValue())).id,
    ).toBe(execucao!.id.getValue());
    expect(
      (await cenario.container.operarExecucao.porOrdemServico("os-1")).id,
    ).toBe(execucao!.id.getValue());
  });

  it("lista com filtro por status", async () => {
    const cenario = montar();
    await enfileirar(cenario);

    expect(await cenario.container.operarExecucao.listar("NA_FILA")).toHaveLength(
      1,
    );
    expect(
      await cenario.container.operarExecucao.listar("finalizada"),
    ).toHaveLength(0);
    expect(await cenario.container.operarExecucao.listar()).toHaveLength(1);
  });

  it("mostra a fila ordenada por posicao com o tempo total estimado", async () => {
    const cenario = montar();
    await enfileirar(cenario, "saga-1", "os-1");
    await enfileirar(cenario, "saga-2", "os-2");

    const fila = await cenario.container.operarExecucao.fila();

    expect(fila.total).toBe(2);
    expect(fila.execucoes.map((item) => item.posicaoFila)).toEqual([1, 2]);
    expect(fila.tempoEstimadoTotalMinutos).toBe(180);
  });

  it("404 para execucao inexistente", async () => {
    const cenario = montar();

    await expect(cenario.container.operarExecucao.obter("x")).rejects.toThrow(
      ErroDominio,
    );
    await expect(
      cenario.container.operarExecucao.porOrdemServico("x"),
    ).rejects.toThrow(ErroDominio);
  });
});
