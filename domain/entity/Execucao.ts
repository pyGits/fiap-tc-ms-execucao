import ErroDominio from "../ErroDominio";
import ID from "../vo/ID";
import ServicoExecutavel from "./ServicoExecutavel";

// Ciclo de vida da execucao na oficina.
//
// Este contexto delimitado nao sabe nada sobre orcamento, pagamento ou
// cliente: para ele uma execucao e "uma lista de servicos a fazer em um
// veiculo, em uma posicao de fila". Esse recorte estreito e o que permite ao
// servico escalar e ser mantido de forma independente.
export enum StatusExecucao {
  NA_FILA = "NA_FILA",
  EM_ANDAMENTO = "EM_ANDAMENTO",
  FINALIZADA = "FINALIZADA",
  // Estado produzido pela transacao compensatoria CANCELAR_EXECUCAO.
  CANCELADA = "CANCELADA",
}

const TRANSICOES_VALIDAS: Record<StatusExecucao, StatusExecucao[]> = {
  [StatusExecucao.NA_FILA]: [
    StatusExecucao.EM_ANDAMENTO,
    StatusExecucao.CANCELADA,
  ],
  [StatusExecucao.EM_ANDAMENTO]: [
    StatusExecucao.FINALIZADA,
    StatusExecucao.CANCELADA,
  ],
  [StatusExecucao.FINALIZADA]: [],
  [StatusExecucao.CANCELADA]: [],
};

export default class Execucao {
  readonly id: ID;
  readonly ordemServicoId: string;
  readonly clienteId: string;
  readonly veiculoId: string;
  readonly sagaId: string;

  servicos: ServicoExecutavel[];
  status: StatusExecucao;
  // Posicao na fila da oficina no momento em que a execucao foi aceita.
  posicaoFila: number;
  mecanicoResponsavel?: string;
  observacoes?: string;
  motivoCancelamento?: string;
  criadaEm: Date;
  iniciadaEm?: Date;
  finalizadaEm?: Date;
  atualizadaEm: Date;

  constructor(dados: {
    id?: ID;
    ordemServicoId: string;
    clienteId: string;
    veiculoId: string;
    sagaId: string;
    servicos: ServicoExecutavel[];
    posicaoFila?: number;
    status?: StatusExecucao;
    mecanicoResponsavel?: string;
    observacoes?: string;
    motivoCancelamento?: string;
    criadaEm?: Date;
    iniciadaEm?: Date;
    finalizadaEm?: Date;
    atualizadaEm?: Date;
  }) {
    if (!dados.ordemServicoId) {
      throw new ErroDominio(
        "execucao.os.obrigatoria",
        "Execucao precisa referenciar uma ordem de servico.",
      );
    }
    if (!dados.servicos || dados.servicos.length === 0) {
      throw new ErroDominio(
        "execucao.servicos.obrigatorios",
        "Execucao precisa de ao menos um servico a executar.",
      );
    }

    this.id = dados.id ?? new ID();
    this.ordemServicoId = dados.ordemServicoId;
    this.clienteId = dados.clienteId;
    this.veiculoId = dados.veiculoId;
    this.sagaId = dados.sagaId;
    this.servicos = dados.servicos;
    this.status = dados.status ?? StatusExecucao.NA_FILA;
    this.posicaoFila = dados.posicaoFila ?? 0;
    this.mecanicoResponsavel = dados.mecanicoResponsavel;
    this.observacoes = dados.observacoes;
    this.motivoCancelamento = dados.motivoCancelamento;
    this.criadaEm = dados.criadaEm ?? new Date();
    this.iniciadaEm = dados.iniciadaEm;
    this.finalizadaEm = dados.finalizadaEm;
    this.atualizadaEm = dados.atualizadaEm ?? new Date();
  }

  private mudarStatus(novo: StatusExecucao) {
    if (!TRANSICOES_VALIDAS[this.status].includes(novo)) {
      throw new ErroDominio(
        "execucao.transicao.invalida",
        `Transicao invalida: ${this.status} -> ${novo}.`,
        409,
      );
    }
    this.status = novo;
    this.atualizadaEm = new Date();
  }

  iniciar(mecanico?: string) {
    this.mudarStatus(StatusExecucao.EM_ANDAMENTO);
    this.iniciadaEm = new Date();
    this.mecanicoResponsavel = mecanico;
  }

  finalizar(observacoes?: string) {
    this.mudarStatus(StatusExecucao.FINALIZADA);
    this.finalizadaEm = new Date();
    if (observacoes) this.observacoes = observacoes;
  }

  // TRANSACAO COMPENSATORIA de ENFILEIRAR_EXECUCAO.
  //
  // Idempotente, e deliberadamente permissiva: cancelar uma execucao que ja
  // esta cancelada e no-op. Uma compensacao que falha deixa a Saga presa em
  // COMPENSANDO, por isso ela nunca lanca erro por "estado inesperado".
  cancelar(motivo: string): boolean {
    if (this.status === StatusExecucao.CANCELADA) return true;

    // Servico ja concluido nao pode ser desfeito - o carro foi consertado.
    // Este e o limite pratico da compensacao: a Saga registra que o rollback
    // nao foi possivel aqui e o caso vira tratamento manual.
    if (this.status === StatusExecucao.FINALIZADA) return false;

    this.status = StatusExecucao.CANCELADA;
    this.motivoCancelamento = motivo;
    this.atualizadaEm = new Date();
    return true;
  }

  estaCancelada(): boolean {
    return this.status === StatusExecucao.CANCELADA;
  }

  estaFinalizada(): boolean {
    return this.status === StatusExecucao.FINALIZADA;
  }

  // Tempo total de oficina - metrica de negocio do servico de Execucao.
  duracaoMs(): number | null {
    if (!this.iniciadaEm || !this.finalizadaEm) return null;
    return this.finalizadaEm.getTime() - this.iniciadaEm.getTime();
  }

  tempoEstimadoMinutos(): number {
    return this.servicos.reduce(
      (total, servico) => total + servico.tempoEstimadoMinutos,
      0,
    );
  }
}
