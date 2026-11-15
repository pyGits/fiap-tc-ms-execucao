import assert from "assert";
import { Before, DataTable, Given, Then, When } from "@cucumber/cucumber";

import MensageriaGatewayMemoria from "../../../domain/gateway/Mock/MensageriaGatewayMemoria";
import { criarContainer, Container } from "../../../src/container";

type Mundo = {
  container: Container;
  mensageria: MensageriaGatewayMemoria;
  sagaId: string;
  ordemServicoId: string;
  execucaoId?: string;
};

let mundo: Mundo;

const ITENS_PADRAO = [
  {
    id: "srv-revisao",
    descricao: "Revisao completa",
    quantidade: 1,
    tipo: "SERVICO",
  },
];

const CAPACIDADE_FILA = Number(process.env.CAPACIDADE_FILA || 20);

Before(() => {
  const container = criarContainer();
  mundo = {
    container,
    mensageria: container.mensageria as MensageriaGatewayMemoria,
    sagaId: "",
    ordemServicoId: "",
  };
});

function ctx() {
  return { sagaId: mundo.sagaId, ordemServicoId: mundo.ordemServicoId };
}

async function execucaoDaSaga() {
  return mundo.container.execucaoRepository.obterPorSaga(mundo.sagaId);
}

// ---------------------------------------------------------------------------
// Contexto
// ---------------------------------------------------------------------------

Given(
  "um comando da Saga {string} para a ordem de servico {string}",
  (sagaId: string, ordemServicoId: string) => {
    mundo.sagaId = sagaId;
    mundo.ordemServicoId = ordemServicoId;
  },
);

Given("que a execucao da Saga ja foi enfileirada", async () => {
  const execucao = await mundo.container.enfileirarExecucao.execute({
    ...ctx(),
    clienteId: "cliente-1",
    veiculoId: "veiculo-1",
    itens: ITENS_PADRAO,
  });

  assert.ok(execucao, "A execucao deveria ter sido enfileirada");
  mundo.execucaoId = execucao.id.getValue();
  mundo.mensageria.limpar();
});

// A fila cheia e preenchida com servicos de OUTRAS ordens, como aconteceria na
// oficina real - nao com um atalho na capacidade configurada.
Given("que a oficina esta com a capacidade esgotada", async () => {
  for (let vaga = 1; vaga <= CAPACIDADE_FILA; vaga += 1) {
    await mundo.container.enfileirarExecucao.execute({
      sagaId: `saga-ocupando-${vaga}`,
      ordemServicoId: `os-ocupando-${vaga}`,
      clienteId: "cliente-outro",
      veiculoId: `veiculo-${vaga}`,
      itens: ITENS_PADRAO,
    });
  }

  assert.strictEqual(
    await mundo.container.execucaoRepository.contarNaFila(),
    CAPACIDADE_FILA,
  );
  mundo.mensageria.limpar();
});

Given("que o mecanico {string} iniciou o reparo", async (mecanico: string) => {
  await mundo.container.operarExecucao.iniciar(mundo.execucaoId!, mecanico);
  mundo.mensageria.limpar();
});

Given("que o mecanico finalizou o reparo", async () => {
  await mundo.container.operarExecucao.finalizar(mundo.execucaoId!);
  mundo.mensageria.limpar();
});

// ---------------------------------------------------------------------------
// Comandos recebidos do orquestrador
// ---------------------------------------------------------------------------

When(
  "o orquestrador envia o comando para enfileirar a execucao com os itens:",
  async (tabela: DataTable) => {
    const itens = tabela.hashes().map((linha) => ({
      id: linha.item,
      descricao: linha.descricao,
      quantidade: Number(linha.quantidade),
      tipo: linha.tipo,
    }));

    const execucao = await mundo.container.enfileirarExecucao.execute({
      ...ctx(),
      clienteId: "cliente-1",
      veiculoId: "veiculo-1",
      itens,
    });

    mundo.execucaoId = execucao?.id.getValue();
  },
);

When("o orquestrador envia o comando para enfileirar a execucao", async () => {
  const execucao = await mundo.container.enfileirarExecucao.execute({
    ...ctx(),
    clienteId: "cliente-1",
    veiculoId: "veiculo-1",
    itens: ITENS_PADRAO,
  });

  mundo.execucaoId = execucao?.id.getValue();
});

When(
  "o orquestrador envia o comando para enfileirar a execucao com falha simulada",
  async () => {
    const execucao = await mundo.container.enfileirarExecucao.execute({
      ...ctx(),
      clienteId: "cliente-1",
      veiculoId: "veiculo-1",
      itens: ITENS_PADRAO,
      simularFalha: true,
    });

    mundo.execucaoId = execucao?.id.getValue();
  },
);

When("o orquestrador reenvia o mesmo comando de enfileirar a execucao", async () => {
  await mundo.container.enfileirarExecucao.execute({
    ...ctx(),
    clienteId: "cliente-1",
    veiculoId: "veiculo-1",
    itens: ITENS_PADRAO,
  });
});

When(
  "o orquestrador envia a compensacao para cancelar a execucao por {string}",
  async (motivo: string) => {
    await mundo.container.cancelarExecucao.execute({ ...ctx(), motivo });
  },
);

When(
  "o orquestrador reenvia a compensacao para cancelar a execucao por {string}",
  async (motivo: string) => {
    await mundo.container.cancelarExecucao.execute({ ...ctx(), motivo });
  },
);

When(
  "o mecanico finaliza o reparo com a observacao {string}",
  async (observacoes: string) => {
    await mundo.container.operarExecucao.finalizar(
      mundo.execucaoId!,
      observacoes,
    );
  },
);

// ---------------------------------------------------------------------------
// Verificacoes
// ---------------------------------------------------------------------------

Then("a Execucao deve responder {string}", (tipo: string) => {
  assert.ok(
    mundo.mensageria.tipos().includes(tipo as never),
    `Resposta ${tipo} nao enviada. Enviadas: ${mundo.mensageria.tipos().join(", ")}`,
  );
});

Then("a execucao deve estar na posicao {int} da fila", async (posicao: number) => {
  const execucao = await execucaoDaSaga();
  assert.strictEqual(execucao?.posicaoFila, posicao);
});

Then(
  "o tempo estimado da execucao deve ser {int} minutos",
  async (minutos: number) => {
    const execucao = await execucaoDaSaga();
    assert.strictEqual(execucao?.tempoEstimadoMinutos(), minutos);
  },
);

Then("a execucao deve estar com o status {string}", async (status: string) => {
  const execucao = await execucaoDaSaga();
  assert.strictEqual(execucao?.status, status);
});

Then(
  "deve existir apenas {int} execucao na oficina",
  async (quantidade: number) => {
    const execucoes = await mundo.container.execucaoRepository.listar();
    assert.strictEqual(execucoes.length, quantidade);
  },
);

Then("nao deve existir execucao para a ordem de servico", async () => {
  const execucao = await mundo.container.execucaoRepository.obterPorOrdemServico(
    mundo.ordemServicoId,
  );
  assert.strictEqual(execucao, null);
});

Then("o motivo da recusa deve mencionar {string}", (trecho: string) => {
  const resposta = mundo.mensageria.ultima();
  assert.ok(
    String(resposta?.body.motivo).includes(trecho),
    `Motivo "${resposta?.body.motivo}" nao menciona "${trecho}"`,
  );
});

Then("o codigo da recusa deve ser {string}", (codigo: string) => {
  assert.strictEqual(mundo.mensageria.ultima()?.body.codigo, codigo);
});

Then("a compensacao deve ser confirmada como concluida", () => {
  assert.strictEqual(mundo.mensageria.ultima()?.body.compensado, true);
});

// O carro ja saiu consertado: a Saga sai de COMPENSANDO, mas o caso fica
// marcado como pendencia que exige tratamento manual.
Then("a compensacao deve ser sinalizada como impossivel", () => {
  assert.strictEqual(mundo.mensageria.ultima()?.body.compensado, false);
});

Then(
  "o motivo registrado na execucao deve ser {string}",
  async (motivo: string) => {
    const execucao = await execucaoDaSaga();
    assert.strictEqual(execucao?.motivoCancelamento, motivo);
  },
);

Then("a oficina deve ter {int} vaga ocupada", async (vagas: number) => {
  assert.strictEqual(
    await mundo.container.execucaoRepository.contarNaFila(),
    vagas,
  );
});

Then("todos os servicos da execucao devem estar concluidos", async () => {
  const execucao = await execucaoDaSaga();
  assert.ok(
    execucao?.servicos.every((servico) => servico.concluido),
    "Ha servicos nao concluidos na execucao finalizada",
  );
});
