import Execucao, { StatusExecucao } from "../../entity/Execucao";
import ExecucaoRepository, { FiltroExecucao } from "../ExecucaoRepository";

export default class ExecucaoRepositoryMemoria implements ExecucaoRepository {
  private readonly registros = new Map<string, Execucao>();

  async salvar(execucao: Execucao): Promise<void> {
    this.registros.set(execucao.id.getValue(), execucao);
  }

  async atualizar(execucao: Execucao): Promise<void> {
    this.registros.set(execucao.id.getValue(), execucao);
  }

  async obter(id: string): Promise<Execucao | null> {
    return this.registros.get(id) ?? null;
  }

  async obterPorOrdemServico(ordemServicoId: string): Promise<Execucao | null> {
    return (
      [...this.registros.values()].find(
        (execucao) => execucao.ordemServicoId === ordemServicoId,
      ) ?? null
    );
  }

  async obterPorSaga(sagaId: string): Promise<Execucao | null> {
    return (
      [...this.registros.values()].find(
        (execucao) => execucao.sagaId === sagaId,
      ) ?? null
    );
  }

  async listar(filtro: FiltroExecucao = {}): Promise<Execucao[]> {
    return [...this.registros.values()].filter((execucao) => {
      if (filtro.status && execucao.status !== filtro.status) return false;
      if (filtro.veiculoId && execucao.veiculoId !== filtro.veiculoId) {
        return false;
      }
      return true;
    });
  }

  async contarNaFila(): Promise<number> {
    return [...this.registros.values()].filter(
      (execucao) =>
        execucao.status === StatusExecucao.NA_FILA ||
        execucao.status === StatusExecucao.EM_ANDAMENTO,
    ).length;
  }

  limpar() {
    this.registros.clear();
  }
}
