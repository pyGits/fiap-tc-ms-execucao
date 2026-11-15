import ErroDominio from "../../ErroDominio";
import Execucao, { StatusExecucao } from "../../entity/Execucao";
import MensageriaGateway from "../../gateway/MensageriaGateway";
import TelemetriaGateway from "../../gateway/TelemetriaGateway";
import ExecucaoRepository, {
  FiltroExecucao,
} from "../../repository/ExecucaoRepository";
import { TipoResposta } from "../../../src/messaging/contracts";

export type ExecucaoApresentada = {
  id: string;
  ordemServicoId: string;
  clienteId: string;
  veiculoId: string;
  sagaId: string;
  status: string;
  posicaoFila: number;
  tempoEstimadoMinutos: number;
  duracaoMs: number | null;
  mecanicoResponsavel?: string;
  observacoes?: string;
  motivoCancelamento?: string;
  servicos: Array<{
    referenciaId: string;
    descricao: string;
    tipo: string;
    quantidade: number;
    tempoEstimadoMinutos: number;
    concluido: boolean;
  }>;
  criadaEm: string;
  iniciadaEm?: string;
  finalizadaEm?: string;
};

// Operacao da oficina pelo mecanico: iniciar, finalizar e consultar.
//
// Estas acoes acontecem DEPOIS que a Saga terminou - o reparo leva horas ou
// dias, tempo que nenhuma transacao distribuida pode ficar esperando. A
// finalizacao e publicada como EVENTO (coreografia), e o OS Service reage a
// ele sem que este servico conheca o outro.
export default class OperarExecucaoUseCase {
  constructor(
    private readonly execucaoRepository: ExecucaoRepository,
    private readonly mensageria: MensageriaGateway,
    private readonly telemetria: TelemetriaGateway,
  ) {}

  async iniciar(id: string, mecanico?: string): Promise<ExecucaoApresentada> {
    const execucao = await this.exigir(id);
    execucao.iniciar(mecanico);
    await this.execucaoRepository.atualizar(execucao);
    return this.apresentar(execucao);
  }

  async finalizar(
    id: string,
    observacoes?: string,
  ): Promise<ExecucaoApresentada> {
    const execucao = await this.exigir(id);
    execucao.servicos.forEach((servico) => servico.concluir());
    execucao.finalizar(observacoes);
    await this.execucaoRepository.atualizar(execucao);

    this.telemetria.registrarFinalizacao({
      ordemServicoId: execucao.ordemServicoId,
      execucaoId: execucao.id.getValue(),
      duracaoMs: execucao.duracaoMs(),
      tempoEstimadoMinutos: execucao.tempoEstimadoMinutos(),
    });

    // Evento, nao comando: avisamos que o servico terminou sem instruir
    // ninguem a fazer nada. Quem se interessa (o OS Service) reage.
    await this.mensageria.responder(
      {
        sagaId: execucao.sagaId,
        ordemServicoId: execucao.ordemServicoId,
      },
      TipoResposta.EXECUCAO_FINALIZADA,
      {
        execucaoId: execucao.id.getValue(),
        finalizadaEm: (execucao.finalizadaEm ?? new Date()).toISOString(),
      },
    );

    return this.apresentar(execucao);
  }

  async obter(id: string): Promise<ExecucaoApresentada> {
    return this.apresentar(await this.exigir(id));
  }

  async porOrdemServico(ordemServicoId: string): Promise<ExecucaoApresentada> {
    const execucao =
      await this.execucaoRepository.obterPorOrdemServico(ordemServicoId);
    if (!execucao) {
      throw ErroDominio.naoEncontrado(
        "execucao.nao.encontrada",
        "Nao existe execucao para esta ordem de servico.",
      );
    }
    return this.apresentar(execucao);
  }

  async listar(status?: string): Promise<ExecucaoApresentada[]> {
    const filtro: FiltroExecucao = status
      ? { status: status.toUpperCase() as StatusExecucao }
      : {};
    const execucoes = await this.execucaoRepository.listar(filtro);
    return execucoes.map((execucao) => this.apresentar(execucao));
  }

  // Fila da oficina ordenada por posicao: a visao que o mecanico usa no dia.
  async fila(): Promise<{
    total: number;
    tempoEstimadoTotalMinutos: number;
    execucoes: ExecucaoApresentada[];
  }> {
    const execucoes = await this.execucaoRepository.listar({
      status: StatusExecucao.NA_FILA,
    });

    const ordenadas = [...execucoes].sort(
      (a, b) => a.posicaoFila - b.posicaoFila,
    );

    return {
      total: ordenadas.length,
      tempoEstimadoTotalMinutos: ordenadas.reduce(
        (total, execucao) => total + execucao.tempoEstimadoMinutos(),
        0,
      ),
      execucoes: ordenadas.map((execucao) => this.apresentar(execucao)),
    };
  }

  private async exigir(id: string): Promise<Execucao> {
    const execucao = await this.execucaoRepository.obter(id);
    if (!execucao) {
      throw ErroDominio.naoEncontrado(
        "execucao.nao.encontrada",
        "Execucao nao encontrada.",
      );
    }
    return execucao;
  }

  private apresentar(execucao: Execucao): ExecucaoApresentada {
    return {
      id: execucao.id.getValue(),
      ordemServicoId: execucao.ordemServicoId,
      clienteId: execucao.clienteId,
      veiculoId: execucao.veiculoId,
      sagaId: execucao.sagaId,
      status: execucao.status,
      posicaoFila: execucao.posicaoFila,
      tempoEstimadoMinutos: execucao.tempoEstimadoMinutos(),
      duracaoMs: execucao.duracaoMs(),
      mecanicoResponsavel: execucao.mecanicoResponsavel,
      observacoes: execucao.observacoes,
      motivoCancelamento: execucao.motivoCancelamento,
      servicos: execucao.servicos.map((servico) => ({
        referenciaId: servico.referenciaId,
        descricao: servico.descricao,
        tipo: servico.tipo,
        quantidade: servico.quantidade,
        tempoEstimadoMinutos: servico.tempoEstimadoMinutos,
        concluido: servico.concluido,
      })),
      criadaEm: execucao.criadaEm.toISOString(),
      iniciadaEm: execucao.iniciadaEm?.toISOString(),
      finalizadaEm: execucao.finalizadaEm?.toISOString(),
    };
  }
}
